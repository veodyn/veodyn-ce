// What the chat is like the moment it opens, before anyone has said anything.
//
// Separate file from create-chat-dialog.test.tsx, which is at the file-size
// limit and is about the conversation rather than the opening of it. That the
// backdrop still blurs for every OTHER dialog is dialog.test.tsx's job: without
// that pair, deleting the blur app-wide would pass this file and the opt-out
// made here would be indistinguishable from nobody blurring anything.
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { CreateChatDialog } from './create-chat-dialog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('opening the AI chat', () => {
  it('puts the cursor in the composer', async () => {
    renderWithProviders(<CreateChatDialog kind="query" onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message the AI' })).toHaveFocus()
    )
  })

  it('leaves the page behind readable rather than blurring it', () => {
    // An edit turn is a conversation ABOUT the dashboard underneath, so blurring
    // it hides the thing the reader is being asked questions about.
    renderWithProviders(
      <CreateChatDialog kind="dashboard" onClose={vi.fn()} targetDashboardId={1} />
    )

    const backdrop = document.querySelector('[data-slot=dialog-overlay]')
    expect(backdrop).not.toBeNull()
    expect(backdrop?.className).not.toContain('backdrop-blur')
  })
})
