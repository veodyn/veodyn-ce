'use client'

import { useState, useEffect } from 'react'
import { UserPlus } from 'lucide-react'
import { redashApi } from '@/services/api-client'
import { Button } from '@/components/ui/button'
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { UserAvatar } from '@/components/shared/user-avatar'

// ---------------------------------------------------------------------------
// Members tab: the group's member list plus an admin-only user search to add
// new members. Extracted from group-detail.tsx to keep that file under the
// file-size seam; owns the search/typeahead state locally and reports
// add/remove actions back to the parent, which owns the member list itself.
//
// The input and the result list sit under one Command root: cmdk needs both in
// the same tree to drive arrow-key and Enter navigation across them, even
// though the list itself renders into the popover's portal.
//
// The input is the popover's ANCHOR, not its trigger. It used to be the
// trigger via `render`, which broke the keyboard path outright: a trigger
// claims Enter and Space to toggle itself, so Enter never reached cmdk and a
// keyboard-only admin could highlight a result but never add it. Clicking
// worked, which is why it went unnoticed. Nothing here needs trigger
// behaviour anyway, because `open` is derived from whether the search returned
// rows, so anchoring gives the same positioning with none of the key stealing.
// ---------------------------------------------------------------------------

interface RedashGroupMember {
  id: number
  name: string
  email: string
  profile_image_url: string | null
}

interface RedashUserSearchResult {
  count: number
  results: Array<{ id: number; name: string; email: string }>
}

interface GroupMembersProps {
  members: RedashGroupMember[]
  isAdmin: boolean
  isBuiltin: boolean
  currentUserId: number | undefined
  onAddMember: (userId: number) => void | Promise<void>
  onRemoveMember: (userId: number) => void
}

export function GroupMembers({
  members,
  isAdmin,
  isBuiltin,
  currentUserId,
  onAddMember,
  onRemoveMember,
}: GroupMembersProps) {
  const [memberSearch, setMemberSearch] = useState('')
  const [searchResults, setSearchResults] = useState<
    Array<{ id: number; name: string; email: string }>
  >([])
  const [resultsQuery, setResultsQuery] = useState('')
  // State-backed rather than a plain ref: the positioner reads the anchor
  // during its own render, and a ref assigned by a child would still be null
  // on the pass that first opens the popup.
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!memberSearch.trim()) return
    const query = memberSearch.trim()
    const timer = setTimeout(async () => {
      try {
        const data = await redashApi.get<RedashUserSearchResult>('users', {
          params: { q: memberSearch, page_size: 10 },
        })
        const memberIds = new Set(members.map((m) => m.id))
        setSearchResults(data.results.filter((u) => !memberIds.has(u.id)))
        setResultsQuery(query)
      } catch {
        // ignore
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [memberSearch, members])

  // Search results are only meaningful while there is a query, and only once
  // they belong to the current query text: gating on resultsQuery (set
  // alongside setSearchResults in the fetch success path) avoids flashing
  // stale results from a prior query while the new debounced fetch is still
  // in flight, without an eager state write in the effect body.
  const visibleResults = resultsQuery === memberSearch.trim() ? searchResults : []

  const handleAdd = async (userId: number) => {
    try {
      await onAddMember(userId)
      setMemberSearch('')
      setSearchResults([])
    } catch {
      // Add failed (parent already surfaced the error). Leave the search text
      // and results in place so the admin can retry without re-typing.
    }
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
        <Popover open={visibleResults.length > 0}>
          <Command
            shouldFilter={false}
            className="w-full max-w-sm overflow-visible rounded-none! border-none bg-transparent p-0!"
          >
            <div ref={setAnchor}>
              <CommandInput
                value={memberSearch}
                onValueChange={setMemberSearch}
                placeholder="Search users to add..."
              />
            </div>
            <PopoverContent
              anchor={anchor}
              align="start"
              sideOffset={4}
              className="w-72 p-1"
              initialFocus={false}
            >
              <CommandList>
                {visibleResults.map((u) => (
                  <CommandItem key={u.id} value={String(u.id)} onSelect={() => handleAdd(u.id)}>
                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{u.name}</span>
                    <span className="text-muted-foreground">{u.email}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </PopoverContent>
          </Command>
        </Popover>
      )}

      <div className="space-y-1">
        {members.map((member) => {
          const isSelf = member.id === currentUserId
          const canRemove = isAdmin && !(isSelf && isBuiltin)
          return (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <UserAvatar
                  id={member.id}
                  name={member.name}
                  email={member.email}
                  imageUrl={member.profile_image_url}
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium">{member.name}</span>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
              </div>
              {canRemove && (
                <Button variant="ghost" size="sm" onClick={() => onRemoveMember(member.id)}>
                  Remove
                </Button>
              )}
            </div>
          )
        })}
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No members in this group.
          </p>
        )}
      </div>
    </div>
  )
}
