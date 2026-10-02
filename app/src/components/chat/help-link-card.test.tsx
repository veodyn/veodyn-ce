import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import type { HelpLinkView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { HelpLinkCard } from './help-link-card'

const DOCS_URL = 'https://veodyn.onriits.net/docs'

const PARAMETERS: HelpLinkView = {
  callId: 'h1',
  page: 'features/queries',
  pageTitle: 'Queries',
  anchor: 'parameters',
  sectionTitle: 'Parameters',
  reason: 'How to add a date filter',
}

const SCHEDULES: HelpLinkView = {
  callId: 'h2',
  page: 'features/schedules',
  pageTitle: 'Schedules',
  anchor: null,
  sectionTitle: null,
  reason: 'Refreshing it on a timer',
}

function withDocs(docsUrl: string | null) {
  return toClientConfig({ ...NEUTRAL_CONFIG, brand: { ...NEUTRAL_CONFIG.brand, docs_url: docsUrl } })
}

function render(links: HelpLinkView[], docsUrl: string | null = DOCS_URL) {
  return renderWithProviders(<HelpLinkCard links={links} />, { config: withDocs(docsUrl) })
}

describe('HelpLinkCard', () => {
  it('links a section of the docs site in a new tab', () => {
    render([PARAMETERS])
    const link = screen.getByRole('link', { name: 'Queries › Parameters' })
    expect(link).toHaveAttribute('href', `${DOCS_URL}/features/queries/#parameters`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText('How to add a date filter')).toBeInTheDocument()
    expect(screen.getByText('Documentation')).toBeInTheDocument()
  })

  it('links a whole page by its title alone', () => {
    render([SCHEDULES])
    expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute(
      'href',
      `${DOCS_URL}/features/schedules/`
    )
  })

  it('shows one card with a row for each consecutive link', () => {
    render([PARAMETERS, SCHEDULES])
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getAllByText('Documentation')).toHaveLength(1)
  })

  it('shows the same text without a link when the deployment has no docs site', () => {
    render([PARAMETERS], null)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Queries › Parameters')).toBeInTheDocument()
    expect(screen.getByText('How to add a date filter')).toBeInTheDocument()
  })
})
