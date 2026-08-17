// Reads the clipboard back through `navigator.clipboard.readText()`, which
// `userEvent.setup()` installs, rather than asserting a `writeText` spy was
// called: api-key-panel.test.tsx already establishes that shape, and it tests
// what landed on the clipboard instead of what the component asked for.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopySchemaJson } from './copy-schema-json'

const SCHEMA = [
  { name: 'captured_at', type: "DateTime64(3, 'UTC')", description: 'The capture timestamp' },
  { name: 'station_id', type: 'Nullable(String)' },
]

describe('CopySchemaJson', () => {
  it('copies the schema as JSON, one entry per column in order', async () => {
    const user = userEvent.setup()
    render(<CopySchemaJson schema={SCHEMA} />)

    await user.click(screen.getByRole('button'))

    expect(JSON.parse(await navigator.clipboard.readText())).toEqual([
      { name: 'captured_at', type: "DateTime64(3, 'UTC')", description: 'The capture timestamp' },
      { name: 'station_id', type: 'Nullable(String)' },
    ])
  })

  it('omits description entirely for a column that has none', async () => {
    // Rather than emitting null or "": a consumer reads a missing key as "no
    // description" without having to tell three spellings of one thing apart.
    const user = userEvent.setup()
    render(<CopySchemaJson schema={SCHEMA} />)

    await user.click(screen.getByRole('button'))

    const copied = JSON.parse(await navigator.clipboard.readText())
    expect('description' in copied[1]).toBe(false)
  })

  it('copies valid JSON for an empty schema rather than nothing', async () => {
    const user = userEvent.setup()
    render(<CopySchemaJson schema={[]} />)

    await user.click(screen.getByRole('button'))

    expect(await navigator.clipboard.readText()).toBe('[]')
  })

  it('says it copied, in the control the reader is already pointing at', async () => {
    const user = userEvent.setup()
    render(<CopySchemaJson schema={SCHEMA} />)
    const button = screen.getByRole('button')

    expect(button).toHaveAccessibleName('Copy schema as JSON')

    await user.click(button)

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
