import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { AnyProposal } from '@/types/ai-create'
import { ProposalPanel } from './proposal-panel'

vi.mock('@/features/generated-registry', () => ({
  FEATURES: {
    stub: {
      id: 'stub',
      enabled: (config: { messages: { enabled: boolean } }) => config.messages.enabled,
      nav: [],
      routes: [],
      proposals: [
        {
          kind: 'gizmo',
          parse: (raw: unknown) => raw as { kind: string },
          render: async () => {
            const { Button } = await import('@/components/ui/button')
            return {
              default: ({ proposal }: { proposal: { kind: string } }) => (
                <Button>Create {proposal.kind}</Button>
              ),
            }
          },
          manual: { href: '/gizmos/new', label: 'Write the gizmo yourself' },
        },
      ],
    },
  },
}))

const GIZMO: AnyProposal = { kind: 'gizmo', name: 'Ridership next quarter' }

function panel(enabled: boolean) {
  resetStores()
  return renderWithProviders(
    <ProposalPanel proposal={GIZMO} onCreated={vi.fn()} onBusyChange={vi.fn()} />,
    { config: { messages: { enabled } } }
  )
}

describe('a proposal for a feature the config has switched off', () => {
  it('is drawn while the switch is on', async () => {
    panel(true)

    expect(await screen.findByRole('button', { name: 'Create gizmo' })).toBeVisible()
  })

  it('is not drawn at all while the switch is off, because its writes are refused', async () => {
    const { container } = panel(false)

    await expect(
      screen.findByRole('button', { name: 'Create gizmo' }, { timeout: 200 })
    ).rejects.toThrow()
    expect(container).toBeEmptyDOMElement()
  })
})
