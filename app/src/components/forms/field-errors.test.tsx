import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldError, useFieldErrors } from './field-errors'

function Harness() {
  const { errors, fail, clear, fieldProps } = useFieldErrors()
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        fail({ first: 'First is required', second: 'Second is required' })
      }}
    >
      <input id="first" aria-label="First" onChange={() => clear('first')} {...fieldProps('first')} />
      <FieldError fieldId="first" message={errors.first} />
      <input id="second" aria-label="Second" {...fieldProps('second')} />
      <FieldError fieldId="second" message={errors.second} />
      <button type="submit">Go</button>
    </form>
  )
}

describe('useFieldErrors', () => {
  it('marks every failing field, links the message and focuses the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Go' }))

    const first = screen.getByRole('textbox', { name: 'First' })
    expect(first).toHaveAttribute('aria-invalid', 'true')
    expect(first).toHaveAccessibleDescription('First is required')
    expect(first).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('clears one field on edit and leaves the other', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    await user.type(screen.getByRole('textbox', { name: 'First' }), 'x')

    expect(screen.getByRole('textbox', { name: 'First' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('First is required')).toBeNull()
    expect(screen.getByText('Second is required')).toBeInTheDocument()
  })
})
