import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { CreateKind } from '@/types/ai-create'
import { CreateWithAiButton } from './create-with-ai-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function config(enabled: boolean): ClientConfig {
  return { ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled } }
}

function renderButton(enabled: boolean, kind: CreateKind = 'query') {
  return renderWithProviders(
    <ConfigProvider value={config(enabled)}>
      <CreateWithAiButton kind={kind} />
    </ConfigProvider>
  )
}

beforeEach(() => {
  resetStores()
})

describe('CreateWithAiButton', () => {
  it('renders no affordance at all when AI is off', () => {
    const { container } = renderButton(false)
    // Not a disabled button and not a tooltip: AI off means the door is not
    // there (spec section 2).
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the chat for its own kind and closes it again', async () => {
    const user = userEvent.setup()
    renderButton(true, 'kpi')

    const opener = screen.getByRole('button', { name: 'Create with AI' })
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(opener)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Create a KPI with AI')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    // Closing unmounts the dialog, which is how the conversation is discarded:
    // there is no persistence and nothing to resume.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens each kind on its own title', async () => {
    const user = userEvent.setup()
    renderButton(true, 'snippet')

    await user.click(screen.getByRole('button', { name: 'Create with AI' }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(
      'Create a snippet with AI'
    )
  })
})
