import { describe, expect, it } from 'vitest'
import nextConfig from './next.config'

describe('next.config response headers', () => {
  it('lets any origin fetch map geometry', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const geo = rules.find((rule) => rule.source === '/geo/:path*')

    expect(geo?.headers).toEqual(expect.arrayContaining([{ key: 'Access-Control-Allow-Origin', value: '*' }]))
  })

  it('lets any origin load the marker icons a plugin draws on a map', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const icons = rules.find((rule) => rule.source === '/icons/:path*')

    expect(icons?.headers).toEqual(expect.arrayContaining([{ key: 'Access-Control-Allow-Origin', value: '*' }]))
  })

  it('keeps every other path closed to cross-origin reads', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const openRules = rules.filter((rule) => rule.headers.some((h) => h.key === 'Access-Control-Allow-Origin'))

    expect(openRules.map((rule) => rule.source)).toEqual(['/geo/:path*', '/icons/:path*'])
  })
})
