import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import NewDataSourcePage from '@/app/data-sources/new/page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

beforeEach(() => {
  push.mockClear()
})

afterEach(() => resetStores())

async function openForm() {
  const user = userEvent.setup()
  renderWithProviders(<NewDataSourcePage />)
  await user.click(await screen.findByRole('button', { name: /PostgreSQL/ }))
  return user
}

describe('submitting the new data source form', () => {
  it('keeps the submit button enabled while the name is empty', async () => {
    await openForm()

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('flags an empty name on the field, links the message and focuses it', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Give the data source a name.')
    expect(name).toHaveFocus()
    expect(push).not.toHaveBeenCalled()
  })

  it('clears the name error when the name is edited', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'W')

    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Give the data source a name.')).toBeNull()
  })

  it('submits when Enter is pressed in the name field', async () => {
    const user = await openForm()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Warehouse{Enter}')

    await waitFor(() => expect(push).toHaveBeenCalled())
  })
})
