import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { WidgetControls } from './widget-controls'

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

vi.mock('@/hooks/use-catalog', () => ({ useCatalog: () => ({ data: [] }) }))
vi.mock('@/hooks/use-captures', () => ({ useCaptures: () => ({ data: [] }) }))
vi.mock('@/hooks/use-query-sql', () => ({ useQuerySqlById: () => new Map() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const ON = { config: { ai: { enabled: true } } }
const ASK = { subject: { kind: 'widget', dashboardId: 4, widgetId: 21 } as const, label: 'Trend' }

function render(props: { isPublic?: boolean; isEditing?: boolean; ask?: typeof ASK; chat?: boolean }) {
  return renderWithProviders(
    <WidgetControls
      now={0}
      retrievedAt={undefined}
      onRefresh={() => {}}
      refreshing={false}
      onExpand={() => {}}
      onAnnotate={() => {}}
      canEdit={false}
      onEdit={() => {}}
      queryId={7}
      isPublic={props.isPublic ?? false}
      isEditing={props.isEditing ?? false}
      ask={props.ask}
    />,
    props.chat === false ? { config: { ai: { enabled: false } } } : ON
  )
}

const ask = () => screen.queryByRole('button', { name: 'Ask about Trend in chat' })

describe('widget Ask about this', () => {
  it('shows on a signed-in dashboard in view mode', () => {
    render({ ask: ASK })
    expect(ask()).toBeInTheDocument()
  })

  it('is absent on a public or embed page', () => {
    render({ ask: ASK, isPublic: true })
    expect(ask()).not.toBeInTheDocument()
  })

  it('is absent while the dashboard is being edited', () => {
    render({ ask: ASK, isEditing: true })
    expect(ask()).not.toBeInTheDocument()
  })

  it('is absent when AI is off', () => {
    render({ ask: ASK, chat: false })
    expect(ask()).not.toBeInTheDocument()
  })

  it('is absent without a subject', () => {
    render({})
    expect(ask()).not.toBeInTheDocument()
  })
})
