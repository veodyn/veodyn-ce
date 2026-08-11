import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { Toaster } from '@/components/ui/sonner'
import { ApiKeyPanel } from './api-key-panel'

afterEach(() => {
  resetStores()
})

const KEY = 'abcd1234secret'
// Mock mode is what the suite runs in, so regeneration goes through the mock
// store rather than the proxy. Id 1 is the Admin fixture, which has to exist
// for the store to have something to update.
const MOCK_USER_ID = 1

function keyOf(id: number): string | undefined {
  return useMockDataStore.getState().users.find((u) => u.id === id)?.api_key
}

describe('ApiKeyPanel', () => {
  it('masks the key until revealed', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ApiKeyPanel userId="7" apiKey={KEY} canRegenerate onRegenerated={() => {}} />
    )
    expect(screen.queryByText(KEY)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show api key/i }))
    expect(screen.getByText(KEY)).toBeInTheDocument()
  })

  it('hides the regenerate button when canRegenerate is false', () => {
    renderWithProviders(
      <ApiKeyPanel userId="7" apiKey={KEY} canRegenerate={false} onRegenerated={() => {}} />
    )
    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument()
  })

  it('names the key display "API Key" so the label is not floating text', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ApiKeyPanel userId="7" apiKey={KEY} canRegenerate onRegenerated={() => {}} />
    )
    // The label has to resolve to the thing it names: a <label> with no
    // association renders the same words and reaches no element at all.
    const field = screen.getByLabelText('API Key')
    await user.click(within(field).getByRole('button', { name: /show api key/i }))
    expect(within(field).getByText(KEY)).toBeInTheDocument()
  })

  it('asks in an in-app dialog, not a native confirm, and cancelling regenerates nothing', async () => {
    const user = userEvent.setup()
    const onRegenerated = vi.fn()
    const keyBefore = keyOf(MOCK_USER_ID)
    // Spied but never stubbed: a native confirm() would return undefined here,
    // which the old code read as "cancelled", so this test would pass without
    // the assertion below even though the blocking modal was still there.
    const confirmSpy = vi.spyOn(window, 'confirm')

    renderWithProviders(
      <ApiKeyPanel
        userId={String(MOCK_USER_ID)}
        apiKey={KEY}
        canRegenerate
        onRegenerated={onRegenerated}
      />
    )
    await user.click(screen.getByRole('button', { name: /^regenerate$/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/regenerate api key\?/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onRegenerated).not.toHaveBeenCalled()
    expect(keyOf(MOCK_USER_ID)).toBe(keyBefore)

    confirmSpy.mockRestore()
  })

  it('regenerates once the dialog is confirmed', async () => {
    const user = userEvent.setup()
    const onRegenerated = vi.fn()
    const keyBefore = keyOf(MOCK_USER_ID)

    renderWithProviders(
      <ApiKeyPanel
        userId={String(MOCK_USER_ID)}
        apiKey={KEY}
        canRegenerate
        onRegenerated={onRegenerated}
      />
    )
    await user.click(screen.getByRole('button', { name: /^regenerate$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^regenerate$/i }))

    await waitFor(() => expect(onRegenerated).toHaveBeenCalled())
    const issued = onRegenerated.mock.calls[0][0].api_key
    expect(issued).not.toBe(keyBefore)
    // The new key is persisted, not just handed to the callback: a regenerate
    // that only reported a key without storing it would leave the next read
    // showing the old one.
    expect(keyOf(MOCK_USER_ID)).toBe(issued)
    // The dialog is the confirmation step, not a panel that stays open behind
    // the result.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports a copied key the way the invite link reports a copied link', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ApiKeyPanel userId="7" apiKey={KEY} canRegenerate onRegenerated={() => {}} />
        <Toaster />
      </>
    )

    await user.click(screen.getByRole('button', { name: /copy api key/i }))

    expect(await navigator.clipboard.readText()).toBe(KEY)
    // Toaster is not mounted by renderWithProviders, so this test mounts it
    // itself to assert on what actually reaches the screen. The invite-link
    // copy in admin-user-detail-security.tsx raises a success toast for the
    // same gesture; a silent copy here is the inconsistency, not a style.
    // Scoped to sonner's own data-type="success" attribute rather than a bare
    // text query: the text reaching the DOM proves the message was shown, not
    // that it arrived as a confirmation rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        /copied/i
      )
    )
  })
})
