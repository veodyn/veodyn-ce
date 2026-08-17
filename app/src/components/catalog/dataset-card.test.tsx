import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DatasetCard } from './dataset-card'
import type { Dataset } from '@/types/catalog'

afterEach(() => resetStores())

const dataset: Dataset = {
  id: 'rail-network-daily-ridership',
  name: 'Rail Network Daily Ridership',
  description: 'Daily vehicle counts and average speed by rail line.',
  domain: 'operations',
  schema: [{ name: 'date', type: 'date' }],
  freshness: { lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh' },
  coverage: { start: '2020-06-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
  rowCount: 1_204_880,
  sources: ['Rail SCADA'],
  tags: ['rail', 'ridership'],
  sampleQueryId: null,
  origin: 'capture',
  writable: false,
}

function titleLink() {
  return screen.getByRole('link', { name: 'Rail Network Daily Ridership' })
}

describe('DatasetCard', () => {
  it('renders the dataset name in font-display', () => {
    renderWithProviders(<DatasetCard dataset={dataset} />)
    const name = screen.getByRole('heading', { name: 'Rail Network Daily Ridership' })
    expect(name).toHaveClass('font-display')
  })

  it('renders a FreshnessBadge', () => {
    renderWithProviders(<DatasetCard dataset={dataset} />)
    expect(screen.getByText(/fresh/i)).toBeInTheDocument()
  })

  it('renders the row count with tabular-nums', () => {
    renderWithProviders(<DatasetCard dataset={dataset} />)
    const rowCount = screen.getByText(/1,204,880/)
    expect(rowCount).toHaveClass('tabular-nums')
  })

  it('links to /data/dataset/<id>', () => {
    renderWithProviders(<DatasetCard dataset={dataset} />)
    expect(titleLink()).toHaveAttribute('href', '/data/dataset/rail-network-daily-ridership')
  })

  // The whole card stays one click target, but it is no longer one big anchor:
  // a tag chip is a link too, and nesting anchors is invalid, which is why this
  // was the only browse surface in the product showing no tags at all. The
  // title's link is stretched over the card instead. jsdom lays nothing out, so
  // what is pinned is the pair that produces the behaviour: a positioned card
  // and an overlay pinned to its bounds.
  it('keeps the whole card clickable without wrapping it in an anchor', () => {
    const { container } = renderWithProviders(<DatasetCard dataset={dataset} />)
    const card = container.firstElementChild
    expect(card?.tagName).not.toBe('A')
    expect(card?.className).toMatch(/relative/)
    expect(titleLink().className).toMatch(/after:absolute/)
    expect(titleLink().className).toMatch(/after:inset-0/)
  })

  it('offers each tag as a way into everything sharing it', () => {
    renderWithProviders(<DatasetCard dataset={dataset} />)

    expect(screen.getByRole('link', { name: 'Search for everything tagged rail' })).toHaveAttribute(
      'href',
      '/search?tag=rail'
    )
    expect(
      screen.getByRole('link', { name: 'Search for everything tagged ridership' })
    ).toBeInTheDocument()
  })

  it('leaves the footer off a dataset with nothing to show there', () => {
    renderWithProviders(<DatasetCard dataset={{ ...dataset, tags: [] }} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('does not chip a domain tag, which the domain filter already covers', () => {
    renderWithProviders(<DatasetCard dataset={{ ...dataset, tags: ['domain:operations'] }} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
