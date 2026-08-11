import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { renderWithProviders, resetStores } from '@/test/utils'
import { EditWithAiButton } from './edit-with-ai-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function config(enabled: boolean): ClientConfig {
  return { ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled } }
}

function renderButton(enabled: boolean) {
  return renderWithProviders(
    <ConfigProvider value={config(enabled)}>
      <EditWithAiButton dashboardId={7} />
    </ConfigProvider>
  )
}

beforeEach(() => {
  resetStores()
})

describe('EditWithAiButton', () => {
  it('renders no affordance at all when AI is off', () => {
    // Not a disabled button and not a tooltip. Every AI entry point in this
    // product is absent when AI is off, and the e2e specs sweep the page for
    // one, so a new door has to obey the same rule as the old ones.
    const { container } = renderButton(false)

    expect(container).toBeEmptyDOMElement()
  })

  it('opens a conversation about this dashboard and closes it again', async () => {
    const user = userEvent.setup()
    renderButton(true)

    await user.click(screen.getByRole('button', { name: 'Edit with AI' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
