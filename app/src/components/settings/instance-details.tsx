'use client'

// Settings > General: what this deployment is pointed at.
//
// It used to be a form: a text box holding the literal string "My
// Organization", disabled, above a Save button that was also disabled, above a
// line explaining that neither of them would ever do anything. Three controls
// to say one fact, none of them the actual fact, since the placeholder was not
// the instance's name.
//
// It is a read-out now. The name is real, from GET /api/session, which is the
// only place the frontend can learn it: Redash keeps it as a column on the
// Organization record, the organization-settings endpoint refuses any key it
// does not already define (models/organizations.py set_setting raises KeyError),
// and no other endpoint writes it. So there is nothing to edit here, and the
// screen should stop implying otherwise.
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { USE_REAL_API } from '@/services/redash/config'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">{value}</dd>
      {hint != null && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function InstanceDetails() {
  const orgName = useAuthStore((s) => s.orgName)
  const orgSlug = useAuthStore((s) => s.orgSlug)

  // Mock mode has no organization to report, and inventing one would put this
  // screen back where it started: a plausible-looking name that is not real.
  const unknown = USE_REAL_API ? 'Not reported by this instance' : 'No backend connected'

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className={SUBSECTION_HEADING}>General</h3>
        <dl className="space-y-4">
          <Detail
            label="Organization"
            value={orgName ?? unknown}
            hint="Set on the query service itself, and not editable from here."
          />
          {orgSlug != null && <Detail label="Slug" value={orgSlug} />}
        </dl>
      </CardContent>
    </Card>
  )
}
