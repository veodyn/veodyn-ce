import { Calendar, Clock } from 'lucide-react'

import { TimeAgo } from '@/components/shared/time-ago'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Card, CardContent } from '@/components/ui/card'
import type { RedashUserDetail } from '@/components/users/user-detail-types'

// ---------------------------------------------------------------------------
// Profile identity card: avatar, name, joined/active timestamps. Modelled on
// AdminUserDetailProfile, but for the person's own profile rather than an
// admin's view of someone else's account. No status badge (active, disabled,
// pending is an admin judgement about someone else's account, not a fact
// about your own) and no email line (ProfileAccount owns the email; showing
// it here too would give it two places to go stale relative to each other).
//
// The name is an h2: the page's own PageHeader owns the h1 now. This card used
// to carry it, which is why /profile was one of only two routes with no page
// title, and why its first heading sat 100px right of and 20px below where
// every other route puts one.
// ---------------------------------------------------------------------------

export function ProfileIdentity({ user }: { user: RedashUserDetail }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-start gap-4">
          <UserAvatar
            size="lg"
            id={user.id}
            name={user.name}
            email={user.email}
            imageUrl={user.profile_image_url}
          />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl font-medium tracking-tight">{user.name}</h2>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Joined <TimeAgo date={user.created_at} />
              </span>
              {user.active_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {/* "Last active", not "Active": the latter reads as the same word
                      as the status badge this component deliberately omits, and
                      testing-library's text matcher treats this span's own direct
                      text as "Active" regardless of the nested TimeAgo, which would
                      make it indistinguishable from a status badge in a query. */}
                  Last active <TimeAgo date={user.active_at} />
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
