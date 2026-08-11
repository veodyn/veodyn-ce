// Moving to PRO used to be a one-way commit: the builder froze itself, said so
// in a "Locked to PRO" notice, and the Visual tab went dead for the rest of the
// query's life. It is a handoff now. What these cases pin is that leaving costs
// nothing (no freeze, no notice, the picks still editable) and that the picks
// survive an unmount and come back.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  buttonNames,
  composedSql,
  publishedSql,
  restoreDatasets,
  seedDatasets,
} from './visual-builder-test-fixtures'
import { VisualBuilder } from './visual-builder'
import { type VisualDraft, emptyVisualDraft } from './visual-builder-model'

const LOCK_WORDS = /locked to pro|read-only|one way|one-way/i

describe('VisualBuilder mode switching', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder() {
    const onCompile = vi.fn()
    const onSwitchToPro = vi.fn()
    const onCompiledSqlChange = vi.fn()
    renderWithProviders(
      <VisualBuilder
        datasetId="trips-daily"
        onCompile={onCompile}
        onSwitchToPro={onSwitchToPro}
        onCompiledSqlChange={onCompiledSqlChange}
      />
    )
    return { onCompile, onSwitchToPro, onCompiledSqlChange }
  }

  it('switches on the first click, with nothing standing in between', async () => {
    const user = userEvent.setup()
    const { onSwitchToPro } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    await user.click(screen.getByRole('button', { name: 'Open in SQL Editor' }))

    expect(onSwitchToPro).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Open this query in PRO\?/i)).not.toBeInTheDocument()
  })

  it('hands the compiled SQL to PRO and freezes nothing on the way out', async () => {
    const user = userEvent.setup()
    const { onCompile, onSwitchToPro } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    const sql = await composedSql(user, onCompile)

    await user.click(screen.getByRole('button', { name: 'Open in SQL Editor' }))

    expect(onSwitchToPro).toHaveBeenCalledWith(sql)
    // Every control the lock used to disable stays live, because the analyst
    // may well be back in a moment.
    expect(screen.getByRole('button', { name: 'line' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'service_date' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add measure' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add sort' })).toBeEnabled()
    expect(screen.getByLabelText('Row limit')).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Table' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  it('says nothing about a lock, and keeps offering the way out', async () => {
    const user = userEvent.setup()
    renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Open in SQL Editor' }))

    expect(screen.queryByText(LOCK_WORDS)).not.toBeInTheDocument()
    // The button is still there: leaving twice is allowed, because coming back
    // is allowed.
    expect(buttonNames()).toContain('Open in SQL Editor')
  })

  it('keeps editing and re-running after a trip to PRO', async () => {
    const user = userEvent.setup()
    const { onCompile, onSwitchToPro, onCompiledSqlChange } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    await user.click(screen.getByRole('button', { name: 'Open in SQL Editor' }))
    const handedOff = onSwitchToPro.mock.calls.at(-1)?.[0]
    expect(handedOff).toContain('SELECT line')

    // Back in the builder: a new pick lands, the composition follows it, and Run
    // still compiles.
    await user.click(screen.getByRole('button', { name: 'service_date' }))
    expect(publishedSql(onCompiledSqlChange)).not.toBe(handedOff)
    expect(screen.getByRole('button', { name: 'service_date' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onCompile).toHaveBeenCalledOnce()
    expect(onSwitchToPro).toHaveBeenCalledOnce()
  })
})

describe('VisualBuilder draft, lifted', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  // The page keeps the picks so the builder can unmount when PRO is on screen.
  // Without that, every look at the SQL reset the spec to empty.
  function DraftHarness({ onCompiledSqlChange }: { onCompiledSqlChange: (sql: string | null) => void }) {
    const [draft, setDraft] = useState<VisualDraft>(emptyVisualDraft)
    const [showBuilder, setShowBuilder] = useState(true)

    return (
      <div>
        <button type="button" onClick={() => setShowBuilder((shown) => !shown)}>
          Toggle mode
        </button>
        {showBuilder ? (
          <VisualBuilder
            datasetId="trips-daily"
            onCompile={() => {}}
            onSwitchToPro={() => {}}
            onCompiledSqlChange={onCompiledSqlChange}
            draft={draft}
            onDraftChange={setDraft}
          />
        ) : (
          <div>PRO editor</div>
        )}
      </div>
    )
  }

  it('restores the picks when the builder comes back', async () => {
    const user = userEvent.setup()
    const onCompiledSqlChange = vi.fn()
    renderWithProviders(<DraftHarness onCompiledSqlChange={onCompiledSqlChange} />)

    await user.click(await screen.findByRole('button', { name: 'line' }))
    await user.click(screen.getByRole('button', { name: 'service_date' }))
    const composed = publishedSql(onCompiledSqlChange)
    expect(composed).toContain('line')

    await user.click(screen.getByRole('button', { name: 'Toggle mode' }))
    expect(screen.getByText('PRO editor')).toBeInTheDocument()
    expect(screen.queryByText('Visual builder')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle mode' }))

    expect(await screen.findByRole('button', { name: 'line' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'service_date' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(publishedSql(onCompiledSqlChange)).toBe(composed)
  })
})
