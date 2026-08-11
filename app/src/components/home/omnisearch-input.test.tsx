import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OmnisearchInput } from '@/components/home/omnisearch-input'

describe('OmnisearchInput', () => {
  it('surfaces the typed query on submit (plan 03 federation seam)', async () => {
    const onSubmit = vi.fn()
    render(<OmnisearchInput onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Omnisearch'), 'ridership')
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('ridership')
  })
})
