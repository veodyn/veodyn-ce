import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Sparkles } from 'lucide-react'
import { buildSidebarSections, type SidebarModelInput } from '@/lib/sidebar-nav'

const INPUT: SidebarModelInput = {
  domains: [],
  canAccessAdmin: false,
  canViewInstanceAdmin: false,
  features: { query_snippets: false, query_drafts: false },
}

function hrefs(input: SidebarModelInput): string[] {
  return buildSidebarSections(input, () => []).flatMap((section) => section.items.map((item) => item.href))
}

describe('the chat row', () => {
  it('is absent unless chat is on', () => {
    expect(hrefs(INPUT)).not.toContain('/chat')
    expect(hrefs({ ...INPUT, aiChat: false })).not.toContain('/chat')
  })

  it('sits right under Home as Chat when chat is on, and its page exists', () => {
    const primary = hrefs({ ...INPUT, aiChat: true })
    expect(primary.slice(0, 3)).toEqual(['/', '/chat', '/search'])
    const row = buildSidebarSections({ ...INPUT, aiChat: true }, () => [])[0].items[1]
    expect(row).toMatchObject({ label: 'Chat', href: '/chat', icon: Sparkles })
    expect(existsSync(join(process.cwd(), 'src', 'app', 'chat', 'page.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'src', 'app', 'chat', '[id]', 'page.tsx'))).toBe(true)
  })
})
