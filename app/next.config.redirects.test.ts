import { describe, expect, it } from 'vitest'
import nextConfig from './next.config'

describe('next.config redirects', () => {
  it('sends /data-catalog and everything under it permanently to the matching /data path', async () => {
    const redirects = await nextConfig.redirects?.()
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: '/data-catalog', destination: '/data', permanent: true },
        { source: '/data-catalog/:path*', destination: '/data/:path*', permanent: true },
      ])
    )
  })
})
