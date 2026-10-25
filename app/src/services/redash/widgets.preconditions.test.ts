import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as dashboardsService from './dashboards'
import { deleteWidget, updateWidget } from './widgets'

const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string, options?: unknown) => del(path, options),
    get: vi.fn(),
  },
  ApiError: class extends Error {},
}))

const OPTIONS = { position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } }

beforeEach(() => {
  post.mockReset().mockResolvedValue({ id: 1, name: 'n', widgets: [] })
  del.mockReset().mockResolvedValue(undefined)
})

describe('widget and dashboard preconditions', () => {
  it('sends expected_updated_at with a widget update only when given', async () => {
    await updateWidget(8, { text: 't', options: OPTIONS }, 'stamp')
    expect(post).toHaveBeenLastCalledWith('widgets/8', {
      text: 't',
      width: 1,
      options: OPTIONS,
      expected_updated_at: 'stamp',
    })
    await updateWidget(8, { text: 't', options: OPTIONS })
    expect(post.mock.calls.at(-1)?.[1]).not.toHaveProperty('expected_updated_at')
  })

  it('sends expected_updated_at as a query parameter with a widget delete only when given', async () => {
    await deleteWidget(8, 'stamp')
    expect(del).toHaveBeenLastCalledWith('widgets/8', { params: { expected_updated_at: 'stamp' } })
    await deleteWidget(8)
    expect(del).toHaveBeenLastCalledWith('widgets/8', undefined)
  })

  it('sends expected_updated_at with a dashboard update only when given', async () => {
    await dashboardsService.update(3, { name: 'x' }, 'stamp')
    expect(post).toHaveBeenLastCalledWith('dashboards/3', { name: 'x', expected_updated_at: 'stamp' })
    await dashboardsService.update(3, { name: 'x' })
    expect(post).toHaveBeenLastCalledWith('dashboards/3', { name: 'x' })
  })
})
