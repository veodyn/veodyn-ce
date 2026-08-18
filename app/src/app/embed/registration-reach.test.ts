import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Whether a plugin visualization draws in an embed is decided by module graph.
// Registration is a side effect of importing '@/plugins', that import lives in
// src/app/providers.tsx, and the embed page reaches it only because the ROOT
// layout wraps every route in <Providers>. Nothing in src/app/embed mentions
// any of that, so the coupling is invisible where it would break.
//
// The realistic break is a nested layout declaring its own <html>, which
// replaces the root layout for that segment: the embed page would keep working
// for core types and silently lose every plugin one, on that route only.

const APP = join(__dirname, '..')

describe('the embed route reaches plugin registration', () => {
  it('registers plugins from providers.tsx', () => {
    const providers = readFileSync(join(APP, 'providers.tsx'), 'utf8')
    expect(providers).toMatch(/import\s+'@\/plugins'/)
  })

  it('wraps every route in Providers from the root layout', () => {
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/<Providers/)
    expect(layout).toMatch(/from\s+'\.\/providers'/)
  })

  // A layout below the root that renders <html> takes over the document and
  // detaches its segment from the root layout, and with it from registration.
  it('has no embed layout that replaces the root document', () => {
    const embedDir = join(APP, 'embed')

    function layoutsIn(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return layoutsIn(path)
        return entry.name === 'layout.tsx' ? [path] : []
      })
    }

    const layouts = layoutsIn(embedDir)
    expect(layouts.length).toBeGreaterThan(0)

    for (const path of layouts) {
      expect([path, /<html/.test(readFileSync(path, 'utf8'))]).toEqual([path, false])
    }
  })
})
