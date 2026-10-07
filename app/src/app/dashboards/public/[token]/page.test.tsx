import { Suspense, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { redashApi } from '@/services/api-client'
import PublicDashboardPage from './page'

const TOKEN = 'public-share-token'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('@/hooks/use-dashboards', () => ({
  usePublicDashboard: () => ({
    data: { name: 'Corridor travel times', widgets: [] },
    isLoading: false,
  }),
}))

const keysSeenByWidgets: Array<string | null> = []

vi.mock('@/components/dashboard/dashboard-grid', () => ({
  DashboardGrid: () => {
    useEffect(() => {
      keysSeenByWidgets.push(redashApi.getApiKey())
    }, [])
    return <div>widgets</div>
  },
}))

afterEach(() => {
  keysSeenByWidgets.length = 0
  redashApi.setApiKey(null)
})

async function renderPage() {
  const params = Promise.resolve({ token: TOKEN })
  let view: ReturnType<typeof render> | undefined
  await act(async () => {
    view = render(
      <Suspense fallback={null}>
        <PublicDashboardPage params={params} />
      </Suspense>
    )
  })
  return view as ReturnType<typeof render>
}

describe('a public dashboard', () => {
  it('authorises its widgets with the share token before their first request', async () => {
    await renderPage()

    expect(await screen.findByText('widgets')).toBeInTheDocument()
    expect(keysSeenByWidgets).toEqual([TOKEN])
  })

  it('stops sending the share token once the reader leaves the page', async () => {
    const view = await renderPage()
    await screen.findByText('widgets')
    expect(redashApi.getApiKey()).toBe(TOKEN)

    view.unmount()

    expect(redashApi.getApiKey()).toBeNull()
  })
})
