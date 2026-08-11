import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import * as vizService from '@/services/redash/visualizations'
import { mockQueries } from '@/lib/mock-data'
import { EmbedDialog } from './embed-dialog'
import { QueryEditorDialogs } from './query-editor-dialogs'

// The dialog refuses to mint without a backend, because a token minted in mock
// mode would resolve to nothing. Real mode is the interesting configuration, so
// it is the one these tests run in.
vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

function signIn(permissions: string[]) {
  useAuthStore.setState({
    currentUser: buildCurrentUser({ id: 3, name: 'Publisher', email: 'p@example.com', permissions }),
  })
}

beforeEach(() => signIn(['publish_visualization', 'view_query']))
afterEach(() => {
  resetStores()
  vi.restoreAllMocks()
})

describe('EmbedDialog: no token yet', () => {
  it('offers to create a link, with no URL to copy until one exists', () => {
    renderWithProviders(<EmbedDialog open onClose={() => {}} visualizationId={9} isSafe />)

    expect(screen.getByRole('button', { name: /create embed link/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/link expires/i)).toHaveValue('')
    expect(screen.queryByLabelText(/public url/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
  })

  it('mints a token and shows the real public URL and iframe snippet', async () => {
    const user = userEvent.setup()
    const share = vi
      .spyOn(vizService, 'shareVisualization')
      .mockResolvedValue({ public_url: 'https://redash.example/public/x', api_key: 'tok-abc' })

    renderWithProviders(<EmbedDialog open onClose={() => {}} visualizationId={9} isSafe />)
    await user.click(screen.getByRole('button', { name: /create embed link/i }))

    const url = `${window.location.origin}/embed/public/tok-abc`
    expect(await screen.findByDisplayValue(url)).toBeInTheDocument()
    expect(
      screen.getByDisplayValue(
        `<iframe src="${url}" width="720" height="391" frameborder="0"></iframe>`
      )
    ).toBeInTheDocument()
    expect(share).toHaveBeenCalledWith(9, null)
  })

  it('sends the expiry the publisher typed, as an instant rather than wall clock', async () => {
    const user = userEvent.setup()
    const share = vi
      .spyOn(vizService, 'shareVisualization')
      .mockResolvedValue({ public_url: '', api_key: 'tok-abc' })

    renderWithProviders(<EmbedDialog open onClose={() => {}} visualizationId={9} isSafe />)
    // fireEvent rather than user.type: a datetime-local input is a segmented
    // control, and typing into it character by character produces intermediate
    // values the browser rejects. The value a real picker commits is what this
    // test is about.
    fireEvent.change(screen.getByLabelText(/link expires/i), {
      target: { value: '2026-09-01T10:30' },
    })
    await user.click(screen.getByRole('button', { name: /create embed link/i }))

    expect(await screen.findAllByDisplayValue(/embed\/public\/tok-abc/)).toHaveLength(2)
    expect(share).toHaveBeenCalledWith(9, new Date('2026-09-01T10:30').toISOString())
  })

  it('reports a failed mint instead of showing a link that does not exist', async () => {
    const user = userEvent.setup()
    vi.spyOn(vizService, 'shareVisualization').mockRejectedValue(
      new Error('Public URLs are disabled for this organization.')
    )

    renderWithProviders(<EmbedDialog open onClose={() => {}} visualizationId={9} isSafe />)
    await user.click(screen.getByRole('button', { name: /create embed link/i }))

    expect(
      await screen.findByText(/public urls are disabled for this organization/i)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/public url/i)).not.toBeInTheDocument()
  })
})

describe('EmbedDialog: a token already exists', () => {
  it('shows the token URL with no credential in it', () => {
    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe shareToken="tok-xyz" />
    )

    const fields = screen.getAllByDisplayValue(/embed\/public\/tok-xyz/) as HTMLInputElement[]
    // Both the URL field and the iframe snippet, which is the one that actually
    // gets pasted into another site.
    expect(fields).toHaveLength(2)
    for (const field of fields) {
      expect(field.value).not.toContain('api_key')
      expect(field.value).not.toContain('@')
    }
  })

  it('offers the existing link instead of a second mint', () => {
    // The whole point of reading the token back. While the dialog could not see
    // one, it offered Create on every open and each click minted another live
    // token that revoking never reached.
    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe shareToken="tok-xyz" />
    )

    expect(screen.queryByRole('button', { name: /create embed link/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/link expires/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke embed link/i })).toBeInTheDocument()
  })

  it('associates the width and height fields with their labels', () => {
    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe shareToken="tok-xyz" />
    )

    expect(screen.getByLabelText(/^width$/i)).toHaveValue(720)
    expect(screen.getByLabelText(/^height$/i)).toHaveValue(391)
  })

  it('revokes the link and stops offering it', async () => {
    const user = userEvent.setup()
    const unshare = vi.spyOn(vizService, 'unshareVisualization').mockResolvedValue()

    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe shareToken="tok-xyz" />
    )
    await user.click(screen.getByRole('button', { name: /revoke embed link/i }))

    expect(await screen.findByRole('button', { name: /create embed link/i })).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/tok-xyz/)).not.toBeInTheDocument()
    expect(unshare).toHaveBeenCalledWith(9)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <EmbedDialog open onClose={onClose} visualizationId={9} isSafe shareToken="tok-xyz" />
    )
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('EmbedDialog: the user cannot publish', () => {
  it('explains why rather than drawing a control that cannot work', () => {
    signIn(['view_query'])

    renderWithProviders(<EmbedDialog open onClose={() => {}} visualizationId={9} isSafe />)

    expect(screen.getByText(/do not have permission to publish/i)).toBeInTheDocument()
    expect(screen.getByText(/publish_visualization/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create embed link/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/link expires/i)).not.toBeInTheDocument()
  })

  it('shows an existing link but no way to revoke it', () => {
    signIn(['view_query'])

    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe shareToken="tok-xyz" />
    )

    expect(screen.getAllByDisplayValue(/embed\/public\/tok-xyz/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
  })
})

describe('EmbedDialog: the token the query already carries', () => {
  it('reaches the dialog from the visualization on the query', () => {
    // The wiring, not the dialog: Redash sends visualization.api_key to an
    // admin or the query's owner, and this is the path that carries it in.
    const source = mockQueries[0]
    const query = {
      ...source,
      is_safe: true,
      visualizations: [{ ...source.visualizations[0], api_key: 'tok-from-query' }],
    }
    const share = vi.spyOn(vizService, 'shareVisualization')

    renderWithProviders(
      <QueryEditorDialogs
        query={query}
        open="embed"
        onClose={() => {}}
        onSaveSchedule={() => {}}
      />
    )

    expect(screen.getAllByDisplayValue(/embed\/public\/tok-from-query/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /create embed link/i })).not.toBeInTheDocument()
    expect(share).not.toHaveBeenCalled()
  })
})

describe('EmbedDialog: an unsafe query', () => {
  it('refuses outright and offers nothing to publish', () => {
    renderWithProviders(
      <EmbedDialog open onClose={() => {}} visualizationId={9} isSafe={false} />
    )

    expect(screen.getByText(/cannot be embedded for security reasons/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create embed link/i })).not.toBeInTheDocument()
  })
})
