'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFederatedSearch } from '@/hooks/use-federated-search'
import { searchTypeLabel, type SearchSourceType } from '@/services/search/types'
import { buildSidebarSections } from '@/lib/sidebar-nav'
import { useConfig } from '@/components/config/config-provider'
import { useAuthStore } from '@/stores/auth-store'
import { SEARCH_PLACEHOLDER } from '@/components/home/omnisearch-input'

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { domains, features } = useConfig()
  const currentUser = useAuthStore((s) => s.currentUser)
  const [raw, setRaw] = useState('')
  const debouncedQuery = useDebouncedValue(raw, 200)
  // Stay idle while closed: CommandPalette keeps rendering (and its hooks keep
  // firing) while mounted but hidden behind a closed CommandDialog, so the
  // query itself has to gate on `open`, not just the dialog's own DOM output.
  const query = open ? debouncedQuery : ''
  const { data: results = [] } = useFederatedSearch(query)

  const navSections = useMemo(() => {
    if (!currentUser) return []
    return buildSidebarSections({
      domains,
      canAccessAdmin: currentUser.isAdmin,
      canViewInstanceAdmin: currentUser.hasPermission('super_admin'),
      features,
    })
  }, [domains, features, currentUser])

  const needle = raw.trim().toLowerCase()
  const filteredNavSections = navSections
    .map((section) => ({
      ...section,
      items: needle
        ? section.items.filter((item) => item.label.toLowerCase().includes(needle))
        : section.items,
    }))
    .filter((section) => section.items.length > 0)

  const grouped = new Map<SearchSourceType, typeof results>()
  for (const item of results) {
    const bucket = grouped.get(item.type) ?? []
    bucket.push(item)
    grouped.set(item.type, bucket)
  }

  function go(href: string) {
    onOpenChange(false)
    setRaw('')
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* Server federation owns matching, so disable cmdk's local filter. */}
      <Command shouldFilter={false}>
        <CommandInput
          value={raw}
          onValueChange={setRaw}
          placeholder={SEARCH_PLACEHOLDER}
        />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {filteredNavSections.map((section) => (
            // cmdk's Group typing is `heading?: React.ReactNode` (undefined, not
            // null) for "no heading"; passing the literal null from the primary
            // section's `label` crashes cmdk's internal value resolution, so it
            // is coalesced to undefined here.
            <CommandGroup key={section.id} heading={section.label ?? undefined}>
              {section.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`nav:${item.href}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {[...grouped.entries()].map(([type, items]) => (
            <CommandGroup key={type} heading={searchTypeLabel(type) ?? type}>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => go(item.href)}
                >
                  <span className="truncate">{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
