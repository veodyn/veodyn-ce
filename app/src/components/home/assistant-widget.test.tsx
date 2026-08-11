import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { AssistantWidget } from './assistant-widget'

function renderWidget(widgetUrl: string | null) {
  const config = toClientConfig({
    ...NEUTRAL_CONFIG,
    assistant: { ...NEUTRAL_CONFIG.assistant, widget_url: widgetUrl },
  })
  return render(
    <ConfigProvider value={config}>
      <AssistantWidget />
    </ConfigProvider>
  )
}

const TRIGGER = { name: /Research Veodyn data with AI/i }

describe('AssistantWidget (config-driven overlay)', () => {
  it('renders nothing when no assistant is configured (widget_url null)', () => {
    const { container } = renderWidget(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the trigger when an assistant widget_url is configured', () => {
    renderWidget('https://chat.example.com')
    // The trigger button loads the external widget only on click, so no script
    // is injected by simply rendering; assert the config-driven trigger chrome.
    expect(screen.getByRole('button', TRIGGER)).toBeInTheDocument()
    expect(screen.getByText(/Research Veodyn data with AI/)).toBeInTheDocument()
  })

  it('exposes the panel as a dialog, seals the page behind it, and closes on Escape', async () => {
    const user = userEvent.setup()
    renderWidget('https://chat.example.com')

    await user.click(screen.getByRole('button', TRIGGER))

    // Announced as a dialog at all: the hand-rolled panel was a bare div.
    await screen.findByRole('dialog')

    // The luka_embed.js loader effect is keyed on chatOpen. If chatOpen were
    // never flipped (e.g. because open state was handed entirely to an
    // uncontrolled SheetTrigger), the dialog would still open and close
    // correctly and this accessibility test would not catch it, but the
    // assistant would never load.
    expect(document.querySelector('script[src*="luka_embed.js"]')).toBeInTheDocument()

    // Modality, as Base UI actually implements it. With the panel open the rest
    // of the page is aria-hidden, so the trigger that opened it is no longer
    // reachable by role. This is the assertion `modal={false}` flips.
    expect(screen.queryByRole('button', TRIGGER)).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The loader's cleanup removes the injected script when the panel closes.
    expect(document.querySelector('script[src*="luka_embed.js"]')).not.toBeInTheDocument()

    // Focus return: the point of a slide-over is that dismissing it puts the
    // keyboard back where it was, not at the top of the document.
    expect(screen.getByRole('button', TRIGGER)).toHaveFocus()
  })
})
