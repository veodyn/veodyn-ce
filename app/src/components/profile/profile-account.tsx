'use client'

import { useState } from 'react'

import { useSaveAccount } from '@/hooks/use-profile'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RedashUserDetail } from '@/components/users/user-detail-types'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

// ---------------------------------------------------------------------------
// Account card: name and email, the two fields Redash lets a user edit about
// themselves. Kept separate from ProfileIdentity because the email doubles as
// the sign-in identity and deserves its own explanatory copy, and separate
// from ApiKeyPanel/ChangePasswordDialog because those are credential-mutating
// and this is not.
// ---------------------------------------------------------------------------

export function ProfileAccount({
  user,
  onSaved,
}: {
  user: RedashUserDetail
  onSaved: (user: RedashUserDetail) => void
}) {
  const toast = useToast()
  const save = useSaveAccount(user.id)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)

  // Adopt refreshed server values, but only for fields the user has not
  // touched. Seeding state from props once and never looking again would leave
  // a pristine field showing a stale value while `dirty` reported true against
  // the new prop, so Save would quietly write the old value back over a newer
  // one. Editing in place still wins: an edited field is never overwritten
  // from under the person typing in it.
  const [synced, setSynced] = useState(user)
  if (synced !== user) {
    if (name === synced.name) setName(user.name)
    if (email === synced.email) setEmail(user.email)
    setSynced(user)
  }

  const dirty = name !== user.name || email !== user.email

  const handleSave = async () => {
    setSaving(true)
    try {
      onSaved(await save.mutateAsync({ name, email }))
      toast.success('Account updated')
    } catch {
      toast.error('Failed to update account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className={SUBSECTION_HEADING}>Account</h3>
      </CardHeader>
      <CardContent>
        {/* The card spans the page; the fields do not. A name and an email are
            short, and an input stretched to a wide display is neither readable
            nor a plausible target. */}
        <div className="max-w-md space-y-4">
        <div>
          <Label htmlFor="profile-account-name" className="text-xs text-muted-foreground block mb-1">
            Name
          </Label>
          <Input
            id="profile-account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="profile-account-email" className="text-xs text-muted-foreground block mb-1">
            Email
          </Label>
          <Input
            id="profile-account-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your email is how you sign in. Changing it changes your sign-in address.
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          Save
        </Button>
        </div>
      </CardContent>
    </Card>
  )
}
