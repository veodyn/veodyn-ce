import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditInPlace } from '@/components/shared/edit-in-place'

it('enters edit mode from the keyboard alone', async () => {
  const user = userEvent.setup()
  render(<EditInPlace value="Report name" onSave={() => {}} />)

  await user.tab()
  expect(screen.getByRole('button', { name: /Report name/ })).toHaveFocus()

  await user.keyboard('{Enter}')
  expect(screen.getByRole('textbox')).toHaveFocus()
})
