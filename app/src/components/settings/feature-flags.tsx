'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/shared/toast-provider'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/use-org-settings'
import { USE_REAL_API } from '@/services/redash/config'

// Each flag names the organization setting it writes. Anything without a
// backing setting does not belong here: a toggle that persists nowhere is worse
// than an absent one.
const FLAGS = [
  {
    key: 'feature_show_permissions_control',
    label: 'Show Permissions Control',
    description: 'Show permissions management on queries and dashboards',
    fallback: true,
  },
  {
    key: 'multi_byte_search_enabled',
    label: 'Multi-Byte Search',
    description: 'Enable multi-byte character search support',
    fallback: false,
  },
  {
    key: 'beacon_consent',
    label: 'Usage Data Sharing',
    description: 'Share anonymous usage data to help improve the product',
    fallback: false,
  },
  {
    key: 'disable_public_urls',
    label: 'Disable Public URLs',
    description: 'Turn off public sharing links for dashboards and queries',
    fallback: false,
  },
] as const

export function FeatureFlags() {
  const toast = useToast()
  const { data: orgSettings, isLoading } = useOrgSettings()
  const updateSettings = useUpdateOrgSettings()
  const [edits, setEdits] = useState<Record<string, boolean>>({})

  const valueOf = (flag: (typeof FLAGS)[number]): boolean =>
    edits[flag.key] ?? (orgSettings?.[flag.key] as boolean | undefined) ?? flag.fallback

  const toggle = (key: string, next: boolean) => setEdits((prev) => ({ ...prev, [key]: next }))

  // Whether anything would actually change, rather than whether anything was
  // touched: flipping a switch and flipping it back leaves nothing to save.
  const isDirty = FLAGS.some(
    (flag) =>
      edits[flag.key] != null &&
      edits[flag.key] !== ((orgSettings?.[flag.key] as boolean | undefined) ?? flag.fallback)
  )

  const handleSave = () => {
    const changes = Object.fromEntries(FLAGS.map((f) => [f.key, valueOf(f)]))
    if (!USE_REAL_API) {
      toast.success('Feature flags saved (mock mode, not persisted)')
      return
    }
    updateSettings.mutate(changes, {
      onSuccess: () => {
        setEdits({})
        toast.success('Feature flags saved')
      },
      onError: (err) => toast.error((err as Error).message || 'Could not save feature flags'),
    })
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className="text-lg font-medium">Feature Flags</h3>
        <div className="space-y-3">
          {FLAGS.map((flag) => (
            <div key={flag.key} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">{flag.label}</p>
                <p className="text-xs text-muted-foreground">{flag.description}</p>
              </div>
              {/* The shared primitive, not a Button dressed as a switch. This
                  was a toggle button with a hand-positioned thumb, which reads
                  to a screen reader as "button, pressed" rather than "switch,
                  on", and reimplemented the focus ring and the disabled state
                  that ui/switch already carries. */}
              <Switch
                aria-label={flag.label}
                checked={valueOf(flag)}
                disabled={isLoading}
                onCheckedChange={(checked) => toggle(flag.key, checked)}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-2">
          {/* Nothing to save until something would change: these apply on Save,
              and a live Save button beside untouched switches suggests they do
              not. */}
          <Button onClick={handleSave} disabled={updateSettings.isPending || !isDirty}>
            {updateSettings.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
