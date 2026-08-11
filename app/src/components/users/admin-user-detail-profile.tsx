import { Calendar, Clock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { TimeAgo } from '@/components/shared/time-ago'
import { UserAvatar } from '@/components/shared/user-avatar'
import type { RedashUserDetail } from './admin-user-detail'

// ---------------------------------------------------------------------------
// Profile card: avatar, name, status badge, and the joined/active timestamps.
// Extracted from admin-user-detail.tsx to keep that file under the file-size
// seam. Purely presentational: it derives everything from the user record and
// owns no state.
//
// The name is NOT here: it is the page title, rendered by the PageHeader in
// admin-user-detail.tsx, the way every other detail route titles itself with
// the name of the thing it is about. It used to be an h1 inside this card,
// which put the page's first heading 100px right of and 20px below where the
// rest of the app puts one, and left the route with no page title at all.
// ---------------------------------------------------------------------------

export function AdminUserDetailProfile({ user }: { user: RedashUserDetail }) {
  const isDisabled = user.is_disabled

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
            <div className="flex items-center gap-2 flex-wrap">
              {isDisabled && <Badge variant="destructive">Disabled</Badge>}
              {user.is_invitation_pending && <Badge variant="secondary">Pending</Badge>}
              {!isDisabled && !user.is_invitation_pending && <Badge>Active</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Joined <TimeAgo date={user.created_at} />
              </span>
              {user.active_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Active <TimeAgo date={user.active_at} />
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
