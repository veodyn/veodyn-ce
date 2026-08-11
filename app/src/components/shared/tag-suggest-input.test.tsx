import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagSuggestInput } from './tag-suggest-input'

const VOCABULARY = [
  { name: 'rail', count: 12 },
  { name: 'ridership', count: 7 },
  { name: 'bike-share', count: 4 },
  { name: 'domain:transit', count: 3 },
]

function setup(props: Partial<Parameters<typeof TagSuggestInput>[0]> = {}) {
  const onSubmit = vi.fn()
  const onDismiss = vi.fn()
  const user = userEvent.setup()
  render(
    <TagSuggestInput
      suggestions={VOCABULARY}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
      {...props}
    />
  )
  return { user, onSubmit, onDismiss, input: screen.getByRole('combobox') }
}

function optionNames() {
  return screen.queryAllByRole('option').map((o) => o.textContent)
}

describe('TagSuggestInput suggestions', () => {
  it('narrows the list to what the typed text matches', async () => {
    const { user, input } = setup()
    await user.type(input, 'ri')

    expect(optionNames()).toEqual(['ridership7', 'Create "ri"'])
  })

  // Reserved tags are hub membership, not labels. Offering one would invite a
  // write the backend answers 422 to.
  it('never offers a reserved tag', async () => {
    const { user, input } = setup()
    await user.type(input, 'domai')

    expect(optionNames().some((n) => n?.includes('domain:transit'))).toBe(false)
  })

  it('does not offer a tag the object already carries', async () => {
    const { user, input } = setup({ existing: ['rail'] })
    await user.type(input, 'r')

    // Everything else matching "r" is still offered; only `rail` is gone.
    expect(optionNames()).toEqual(['ridership7', 'bike-share4', 'Create "r"'])
  })

  // Compared normalized, so a legacy `Rail` in the vocabulary is recognised as
  // the `rail` the object already carries rather than offered as a second tag.
  it('does not offer a vocabulary tag the object carries under another casing', async () => {
    const { user, input } = setup({
      existing: ['rail'],
      suggestions: [{ name: 'Rail', count: 12 }],
    })
    await user.type(input, 'rai')

    expect(optionNames()).toEqual(['Create "rai"'])
  })

  it('offers a create affordance when nothing in the vocabulary matches', async () => {
    const { user, input } = setup()
    await user.type(input, 'ferry')

    expect(screen.getByRole('option', { name: /create "ferry"/i })).toBeInTheDocument()
  })

  // Otherwise the person is asked to choose between two rows that read the same.
  it('does not offer create when the typed value already is a known tag', async () => {
    const { user, input } = setup()
    await user.type(input, 'rail')

    expect(screen.queryByRole('option', { name: /create/i })).not.toBeInTheDocument()
    expect(optionNames()).toEqual(['rail12'])
  })
})

describe('TagSuggestInput keyboard operability', () => {
  it('moves down the list and submits the highlighted tag on Enter', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('r{ArrowDown}{ArrowDown}{Enter}')

    // rail, ridership, bike-share all contain "r"; the second one is picked.
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ source: 'vocabulary', value: 'ridership' })
  })

  // Typed text that exactly matches one entry, so no create row joins the list
  // and the last option is unambiguously the third suggestion.
  it('wraps to the last option when arrowing up from the top', async () => {
    const { user, onSubmit } = setup({
      suggestions: [
        { name: 'ra', count: 1 },
        { name: 'rail', count: 2 },
        { name: 'ramp', count: 3 },
      ],
    })
    await user.keyboard('ra{ArrowUp}{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ source: 'vocabulary', value: 'ramp' })
  })

  it('points aria-activedescendant at the highlighted option', async () => {
    const { user, input } = setup()
    await user.keyboard('r{ArrowDown}')

    const [first] = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('submits the typed value when no option is highlighted', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('ferry{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ source: 'typed', value: 'ferry' })
  })

  // This control picks a candidate, it does not decide what gets stored. Owning
  // normalization here would make the owner's rule untestable, because the
  // owner would never see a raw value. What it does own is the provenance: the
  // owner cannot tell a pick from free text after the fact.
  it('hands back the vocabulary spelling of a picked tag, unnormalized', async () => {
    const { user, onSubmit } = setup({ suggestions: [{ name: 'Rail', count: 2 }] })
    await user.keyboard('rai{ArrowDown}{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ source: 'vocabulary', value: 'Rail' })
  })

  it('hands back exactly what was typed for a new tag', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('  Ferry  {Enter}')

    expect(onSubmit).toHaveBeenCalledWith({ source: 'typed', value: '  Ferry  ' })
  })

  // The create row is activated from the same listbox as a real suggestion, but
  // it is text nobody has stored yet. Calling it a vocabulary pick because of
  // where it was activated would defeat normalization from the other side.
  it('marks the create row as typed even though it comes from the listbox', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('  Ferry  {ArrowDown}{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ source: 'typed', value: '  Ferry  ' })
  })

  it('dismisses on Escape without submitting anything', async () => {
    const { user, onSubmit, onDismiss } = setup()
    await user.keyboard('rail{Escape}')

    expect(onDismiss).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the option the pointer picks', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('bike')
    await user.click(screen.getByRole('option', { name: /bike-share/ }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ source: 'vocabulary', value: 'bike-share' })
  })

  it('marks a create row picked with the pointer as typed too', async () => {
    const { user, onSubmit } = setup()
    await user.keyboard('Ferry')
    await user.click(screen.getByRole('option', { name: /create "ferry"/i }))

    expect(onSubmit).toHaveBeenCalledWith({ source: 'typed', value: 'Ferry' })
  })
})

describe('TagSuggestInput reserved prefix', () => {
  it('refuses a typed reserved value inline and offers nothing', async () => {
    const { user, input, onSubmit } = setup()
    await user.type(input, 'domain:rail')

    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent(/domain:/)
    expect(input).toHaveAttribute('aria-describedby', message.id)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses it however it was cased, since it normalizes to the same tag', async () => {
    const { user, input, onSubmit } = setup()
    await user.type(input, ' Domain:Rail')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears the refusal once the value is no longer reserved', async () => {
    const { user, input } = setup()
    await user.type(input, 'domain:rail')
    await user.clear(input)
    await user.type(input, 'rail')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
