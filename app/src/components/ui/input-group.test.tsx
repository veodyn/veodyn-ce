// The composer in the Create-with-AI dialog is one bordered box 84px tall, and
// only the top 36px of it is the text field. The rest is this addon, holding
// the send button. Clicking it did not focus the field, and took the caret away
// if you had one: measured in Chrome, `document.activeElement` went from the
// textarea to DIV[data-slot=dialog-content]. Every chat UI treats the whole
// composer box as the input; this one treated more than half of it as dead
// space that also cleared focus.
//
// The addon has always tried to prevent exactly that. It just looked for an
// `input`, and a textarea is not one.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from './input-group'

describe('InputGroupAddon click target', () => {
  it('focuses the textarea behind it, not the nearest focusable ancestor', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupTextarea aria-label="Message" />
        <InputGroupAddon align="block-end" data-testid="addon">
          <button type="submit">Send</button>
        </InputGroupAddon>
      </InputGroup>
    )

    const field = screen.getByLabelText('Message')
    await user.click(field)
    expect(field).toHaveFocus()

    // The click a user makes when they mean "put the caret back": inside the
    // border, below the text, left of the send button.
    await user.click(screen.getByTestId('addon'))

    expect(field).toHaveFocus()
  })

  it('still focuses an input-backed group, which is what already worked', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupInput aria-label="Search" />
        <InputGroupAddon data-testid="addon">
          <span>icon</span>
        </InputGroupAddon>
      </InputGroup>
    )

    await user.click(screen.getByTestId('addon'))

    expect(screen.getByLabelText('Search')).toHaveFocus()
  })

  it('focuses a control that carries no input-group slot', async () => {
    // command.tsx puts cmdk's own input inside an InputGroup, and it carries no
    // data-slot of ours. Keying the lookup purely on the slot would have made
    // the command palette's search icon stop focusing its field, trading this
    // bug for a quieter one.
    const user = userEvent.setup()
    render(
      <InputGroup>
        <input aria-label="Unslotted" />
        <InputGroupAddon data-testid="addon">
          <span>icon</span>
        </InputGroupAddon>
      </InputGroup>
    )

    await user.click(screen.getByTestId('addon'))

    expect(screen.getByLabelText('Unslotted')).toHaveFocus()
  })

  it('leaves a click on the button alone, so submitting does not steal the caret', async () => {
    const user = userEvent.setup()
    render(
      <InputGroup>
        <InputGroupTextarea aria-label="Message" />
        <InputGroupAddon align="block-end">
          <button type="submit">Send</button>
        </InputGroupAddon>
      </InputGroup>
    )

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByLabelText('Message')).not.toHaveFocus()
  })
})
