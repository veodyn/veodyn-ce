'use client'

// Mock mode only. Four-eyes governance needs a second person, a demo instance
// has one browser, and there was no way to become anybody else, so the
// publishing half of Reports could be submitted for review and then never
// approved. This switches the mock identity in place. In a configured
// deployment it does not render at all: real identities come from Redash.

import { useId } from 'react'
import { UserRoundCog } from 'lucide-react'
import { mockUsers } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function IdentitySwitcher() {
  const useRealApi = useAuthStore((s) => s.useRealApi)
  const currentUser = useAuthStore((s) => s.currentUser)
  const login = useAuthStore((s) => s.login)
  const triggerId = useId()

  if (useRealApi || !currentUser) return null

  // An invitation that was never accepted is not an identity you can be.
  const switchable = mockUsers.filter((user) => !user.is_disabled && !user.is_invitation_pending)

  return (
    <div className="px-3 py-2">
      <Label
        htmlFor={triggerId}
        className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <UserRoundCog className="h-3.5 w-3.5 shrink-0" />
        Acting as (mock mode)
      </Label>
      <Select
        value={currentUser.email}
        onValueChange={(email) => {
          if (email && email !== currentUser.email) void login(email)
        }}
      >
        <SelectTrigger id={triggerId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {switchable.map((user) => (
            <SelectItem key={user.email} value={user.email}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
