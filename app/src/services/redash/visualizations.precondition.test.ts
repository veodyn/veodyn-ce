import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteVisualization, updateVisualization } from './visualizations'

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

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ id: 3 })
  del.mockResolvedValue(undefined)
})

describe('visualization write preconditions', () => {
  it('sends expected_updated_at in the update body when given', async () => {
    await updateVisualization(3, { name: 'x' }, 'stamp')
    expect(post).toHaveBeenCalledWith('visualizations/3', { name: 'x', expected_updated_at: 'stamp' })
  })

  it('sends the update body unchanged when no precondition is given', async () => {
    await updateVisualization(3, { name: 'x' })
    expect(post).toHaveBeenCalledWith('visualizations/3', { name: 'x' })
  })

  it('sends expected_updated_at as a query parameter on delete when given', async () => {
    await deleteVisualization(3, 'stamp')
    expect(del).toHaveBeenCalledWith('visualizations/3', { params: { expected_updated_at: 'stamp' } })
  })

  it('sends a bare delete when no precondition is given', async () => {
    await deleteVisualization(3)
    expect(del).toHaveBeenCalledWith('visualizations/3', undefined)
  })
})
