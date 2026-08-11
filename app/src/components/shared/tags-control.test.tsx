import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagsControl } from './tags-control'

describe('TagsControl', () => {
  // The chips were inert text. A tag that cannot be followed is a label, not a
  // tag, and every surface showing one already sits next to the content it
  // would filter.
  it('links a read-only chip to everything sharing the tag', () => {
    render(<TagsControl tags={['rail-history']} />)

    const chip = screen.getByRole('link', { name: 'Search for everything tagged rail-history' })
    expect(chip).toHaveAttribute('href', '/search?tag=rail-history')
  })

  // The rows these chips sit in are themselves links, so a chip click that
  // bubbles navigates to the row's destination instead of to the search.
  it('does not let a chip click reach the row around it', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()

    render(

      <div onClick={onRowClick}>
        <TagsControl tags={['rail']} />
      </div>
    )

    await user.click(screen.getByRole('link', { name: /tagged rail/ }))

    expect(onRowClick).not.toHaveBeenCalled()
  })

  // While editing, the chip carries a remove button. A chip that both navigates
  // away and deletes on click is a trap, so it stays inert there.
  it('keeps an editable chip inert so it cannot fight the remove button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<TagsControl tags={['rail']} editable onChange={onChange} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove tag rail' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  // Button supplies focus-visible styling; a raw <button> here had none, so a
  // keyboard user could not see which control they were on.
  it('gives the remove and add-tag buttons a visible focus ring', () => {
    render(<TagsControl tags={['rail']} editable onChange={() => {}} />)

    const removeButton = screen.getByRole('button', { name: 'Remove tag rail' })
    const addButton = screen.getByRole('button', { name: 'Add Tag' })

    expect(removeButton.className).toMatch(/focus-visible:/)
    expect(addButton.className).toMatch(/focus-visible:/)
  })
})

// `domain:*` tags drive domain hubs. Rendered read-only they are noise nobody
// can act on; rendered editable they hand a person an X that deletes a hub.
describe('TagsControl and reserved tags', () => {
  it('hides a reserved tag from the read-only chip list', () => {
    render(<TagsControl tags={['domain:transit', 'rail']} />)

    expect(screen.getByRole('link', { name: /tagged rail/ })).toBeInTheDocument()
    expect(screen.queryByText('domain:transit')).not.toBeInTheDocument()
  })

  it('hides a reserved tag from the editable chip list, remove button and all', () => {
    render(<TagsControl tags={['domain:transit', 'rail']} editable onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'Remove tag rail' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove tag domain:transit' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('domain:transit')).not.toBeInTheDocument()
  })

  // Hidden, not dropped. onChange hands back the full array, so a reserved tag
  // missing from it would delete a hub on the next save.
  it('keeps the hidden reserved tag in the array it hands back', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<TagsControl tags={['domain:transit', 'rail']} editable onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Remove tag rail' }))

    expect(onChange).toHaveBeenCalledWith(['domain:transit'])
  })
})

describe('TagsControl adding a tag', () => {
  async function startAdding(props: Partial<Parameters<typeof TagsControl>[0]> = {}) {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagsControl tags={[]} editable onChange={onChange} {...props} />)
    await user.click(screen.getByRole('button', { name: 'Add Tag' }))
    return { user, onChange }
  }

  it('hands back the normalized value, not what was typed', async () => {
    const { user, onChange } = await startAdding()
    await user.keyboard('  Rail   Ridership  {Enter}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['rail ridership'])
  })

  // Free text stays free text even with a vocabulary on screen: nothing here
  // matches, so this is a new tag and spec decision 3 applies to it.
  it('normalizes text typed fresh while suggestions are available', async () => {
    const { user, onChange } = await startAdding({ suggestions: [{ name: 'metro', count: 9 }] })
    await user.keyboard('Rail{Enter}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['rail'])
  })

  // The defect this suite exists for. Matching downstream is exact and case
  // sensitive, so normalizing a picked tag stored `rail` beside the `Rail` the
  // person clicked, and the original chip stopped finding this object.
  it('stores a picked vocabulary tag exactly as the vocabulary spells it', async () => {
    const { user, onChange } = await startAdding({
      suggestions: [{ name: 'Rail', count: 4 }],
    })
    await user.keyboard('rai{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['Rail'])
  })

  it('keeps the vocabulary spelling when the pointer does the picking', async () => {
    const { user, onChange } = await startAdding({
      suggestions: [{ name: 'Air Quality', count: 2 }],
    })
    await user.keyboard('air')
    await user.click(screen.getByRole('option', { name: /Air Quality/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['Air Quality'])
  })

  // "It came from the listbox" cannot be the test for storing verbatim: the
  // create row is activated the same way and is text nobody has stored yet.
  it('normalizes the create-new row even though it is picked from the list', async () => {
    const { user, onChange } = await startAdding({
      suggestions: [{ name: 'rail', count: 4 }],
    })
    await user.keyboard('  Ferry  {ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['ferry'])
  })

  it('appends to the tags already there rather than replacing them', async () => {
    const { user, onChange } = await startAdding({ tags: ['metro'] })
    await user.keyboard('rail{Enter}')

    expect(onChange).toHaveBeenCalledWith(['metro', 'rail'])
  })

  // A no-op, not a second chip reading the same as the first.
  it('does nothing when the normalized value is already on the object', async () => {
    const { user, onChange } = await startAdding({ tags: ['rail'] })
    await user.keyboard('  RAIL {Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  // De-duplication compares normalized on both sides, so the legacy `Rail`
  // already on the object answers for a typed `rail`. Comparing exactly would
  // append the second spelling, which is the same split from the other end.
  it('is a no-op when the object carries the tag under another casing', async () => {
    const { user, onChange } = await startAdding({
      tags: ['Rail'],
      suggestions: [{ name: 'Rail', count: 4 }],
    })
    await user.keyboard('rail')

    // Not offered either: picking it again could only produce a duplicate.
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does nothing when the value is only whitespace', async () => {
    const { user, onChange } = await startAdding()
    await user.keyboard('   {Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('refuses a typed reserved tag inline instead of writing it', async () => {
    const { user, onChange } = await startAdding()
    await user.keyboard('domain:rail{Enter}')

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes the input on Escape without writing', async () => {
    const { user, onChange } = await startAdding()
    await user.keyboard('rail{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add Tag' })).toBeInTheDocument()
  })

  it('does not suggest a tag the object already carries', async () => {
    const { user } = await startAdding({
      tags: ['rail'],
      suggestions: [
        { name: 'rail', count: 4 },
        { name: 'ridership', count: 2 },
      ],
    })
    await user.keyboard('r')

    const names = screen.queryAllByRole('option').map((o) => o.textContent)
    expect(names).toContain('ridership2')
    expect(names.some((n) => n?.startsWith('rail'))).toBe(false)
  })

  it('offers no add affordance at all when it is not editable', () => {
    render(<TagsControl tags={['rail']} suggestions={[{ name: 'metro', count: 1 }]} />)

    expect(screen.queryByRole('button', { name: 'Add Tag' })).not.toBeInTheDocument()
  })
})
