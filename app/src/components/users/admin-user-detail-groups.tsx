'use client'

import { Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RedashGroup } from './user-detail-types'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

// ---------------------------------------------------------------------------
// Groups card: the member's current groups plus an admin-only "add to group"
// selector. Extracted from admin-user-detail.tsx to keep that file under the
// file-size seam; stays a thin presentational list over group ids the
// parent owns.
//

interface AdminUserDetailGroupsProps {
  userGroupIds: number[]
  groupMap: Map<number, RedashGroup>
  availableGroups: RedashGroup[]
  isAdmin: boolean
  isOwnProfile: boolean
  onAddGroup: (groupId: number) => void
  onRemoveGroup: (groupId: number) => void
}

export function AdminUserDetailGroups({
  userGroupIds,
  groupMap,
  availableGroups,
  isAdmin,
  isOwnProfile,
  onAddGroup,
  onRemoveGroup,
}: AdminUserDetailGroupsProps) {
  const canManage = isAdmin && !isOwnProfile

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className={SUBSECTION_HEADING}>Groups</h3>
        </div>
      </CardHeader>
      <CardContent>
        {/* A group is a short name and maybe a Remove button, so the rows read as
            a list rather than as page-wide bars. */}
        <div className="max-w-md space-y-2">
          {userGroupIds.map((gId) => {
            const g = groupMap.get(gId)
            return (
              <div key={gId} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{g?.name ?? `Group ${gId}`}</span>
                  {/* Outline rather than a variant with a fill: the sibling
                      chips on this route colour account status, and a built-in
                      group is a fact about the group, not a state of it. */}
                  {g?.type === 'builtin' && (
                    <Badge variant="outline" className="text-muted-foreground">
                      built-in
                    </Badge>
                  )}
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => onRemoveGroup(gId)}>
                    Remove
                  </Button>
                )}
              </div>
            )
          })}
          {canManage && (
            <Select
              value=""
              onValueChange={(v) => {
                if (v) onAddGroup(Number(v))
              }}
              items={availableGroups.map((g) => ({ label: g.name, value: String(g.id) }))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Add to group..." />
              </SelectTrigger>
              <SelectContent>
                {availableGroups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
