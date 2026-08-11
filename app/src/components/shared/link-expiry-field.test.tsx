import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LinkExpiryField, toExpiresAt } from './link-expiry-field'

describe('toExpiresAt', () => {
  it('treats an empty field as no expiry', () => {
    expect(toExpiresAt('')).toBeNull()
    expect(toExpiresAt('   ')).toBeNull()
  })

  it('converts wall-clock input to an instant', () => {
    expect(toExpiresAt('2026-09-01T10:30')).toBe(new Date('2026-09-01T10:30').toISOString())
  })

  it('returns null rather than an Invalid Date for input Date cannot read', () => {
    expect(toExpiresAt('not a date')).toBeNull()
  })
})

describe('LinkExpiryField', () => {
  it('starts empty and says what empty means', () => {
    render(<LinkExpiryField value="" onChange={() => {}} />)

    const input = screen.getByLabelText(/link expires/i)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByText(/leave empty for a link that does not expire/i)).toBeInTheDocument()
  })

  it('describes the field to a screen reader, not just to a sighted user', () => {
    render(<LinkExpiryField value="" onChange={() => {}} />)

    const input = screen.getByLabelText(/link expires/i)
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      /leave empty for a link that does not expire/i
    )
  })

  it('reports what the person picked', () => {
    const onChange = vi.fn()
    render(<LinkExpiryField value="" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText(/link expires/i), {
      target: { value: '2026-09-01T10:30' },
    })

    expect(onChange).toHaveBeenCalledWith('2026-09-01T10:30')
  })
})
