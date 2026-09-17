import { screen } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

export const A_STATIC_REFERENCE = 'https://example.com/static.zip'

export async function pickAStaticReference(
  user: ReturnType<typeof userEvent.setup>,
  reference: string = A_STATIC_REFERENCE
) {
  const escape = screen.queryByRole('button', { name: /enter a different reference/i })
  if (escape !== null) await user.click(escape)
  const field = screen.queryByLabelText('Static GTFS reference')
  if (field instanceof HTMLInputElement) await user.type(field, reference)
}
