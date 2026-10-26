import { beforeEach, describe, expect, it, vi } from 'vitest'

const { permanentRedirect } = vi.hoisted(() => ({
  permanentRedirect: vi.fn((target: string): never => {
    throw new Error(`redirect:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({ permanentRedirect }))

import DataCatalogRedirect from './page'

describe('/data-catalog redirect route', () => {
  beforeEach(() => {
    permanentRedirect.mockClear()
  })

  it('sends the bare path permanently to /data', async () => {
    await expect(DataCatalogRedirect({ params: Promise.resolve({}) })).rejects.toThrow('redirect:/data')
    expect(permanentRedirect).toHaveBeenCalledWith('/data')
  })

  it('sends a subpath permanently to the matching /data path', async () => {
    await expect(
      DataCatalogRedirect({ params: Promise.resolve({ rest: ['dataset', '42'] }) })
    ).rejects.toThrow('redirect:/data/dataset/42')
    expect(permanentRedirect).toHaveBeenCalledWith('/data/dataset/42')
  })
})
