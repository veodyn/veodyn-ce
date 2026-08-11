import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { WordCloudEditor } from './word-cloud-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'tweet', friendly_name: 'Tweet', type: 'string' },
  { name: 'hits', friendly_name: 'Hits', type: 'integer' },
]

// Keeps the editor's options controlled so a selection is reflected before the
// next interaction, like the real edit dialog does.
function ControlledWordCloudEditor({
  initial = {},
  onChange,
}: {
  initial?: Record<string, unknown>
  onChange: (options: Record<string, unknown>) => void
}) {
  const [options, setOptions] = useState<Record<string, unknown>>(initial)
  return (
    <WordCloudEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

describe('WordCloudEditor', () => {
  it('shows the options it was given', () => {
    renderWithProviders(
      <WordCloudEditor
        options={{ column: 'tweet', frequenciesColumn: 'hits', wordLengthLimit: { min: 3 } }}
        columns={columns}
        onChange={vi.fn()}
      />
    )

    // Both triggers read their own key, so a swapped or ignored key shows the
    // placeholder text here instead of the column name.
    const [columnTrigger, frequenciesTrigger] = screen.getAllByRole('combobox')
    expect(columnTrigger).toHaveTextContent('tweet')
    expect(frequenciesTrigger).toHaveTextContent('hits')

    expect(screen.getByLabelText('Min characters')).toHaveValue(3)
    expect(screen.getByLabelText('Max characters')).toHaveValue(null)
  })

  // The option names are Redash's own (RedashWordCloudOptions), so a word cloud
  // saved in Redash renders here and one saved here renders there.
  it('writes the picked text column as `column`', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledWordCloudEditor onChange={onChange} />)

    const [columnTrigger] = screen.getAllByRole('combobox')
    await user.click(columnTrigger)
    await user.click(await screen.findByRole('option', { name: 'tweet' }))

    expect(onChange).toHaveBeenLastCalledWith({ column: 'tweet' })
  })

  it('removes frequenciesColumn entirely when it is cleared, rather than writing an empty string', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledWordCloudEditor initial={{ column: 'tweet' }} onChange={onChange} />)

    const [, frequenciesTrigger] = screen.getAllByRole('combobox')
    await user.click(frequenciesTrigger)
    await user.click(await screen.findByRole('option', { name: 'hits' }))
    expect(onChange).toHaveBeenLastCalledWith({ column: 'tweet', frequenciesColumn: 'hits' })

    await user.click(frequenciesTrigger)
    await user.click(await screen.findByRole('option', { name: 'None (count words in the text)' }))

    // toStrictEqual, not toEqual: toEqual treats `frequenciesColumn: undefined`
    // as absent, and this is exactly the difference the model cares about, since
    // buildWordCloudModel switches counting mode on the key being truthy.
    expect(onChange).toHaveBeenLastCalledWith({ column: 'tweet' })
    const cleared = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(cleared).toStrictEqual({ column: 'tweet' })
    expect(Object.keys(cleared)).toEqual(['column'])
  })

  it('nests a word length bound under wordLengthLimit and drops the object when the bound is emptied', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledWordCloudEditor onChange={onChange} />)

    const minCharacters = screen.getByLabelText('Min characters')
    await user.type(minCharacters, '3')
    expect(onChange).toHaveBeenLastCalledWith({ wordLengthLimit: { min: 3 } })

    // Emptying the only bound must not leave `{ min: 0 }` behind: Number('') is
    // 0, and 0 would filter nothing while still looking like a real setting.
    await user.clear(minCharacters)
    const cleared = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(cleared).toStrictEqual({})
  })
})
