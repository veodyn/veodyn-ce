'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/shared/toast-provider'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/use-org-settings'
import { USE_REAL_API } from '@/services/redash/config'

export function AuthSettings() {
  const toast = useToast()
  const { data: orgSettings, isLoading } = useOrgSettings()
  const updateSettings = useUpdateOrgSettings()
  const passwordLoginId = useId()
  const samlLoginId = useId()

  const [edits, setEdits] = useState<{ password?: boolean; saml?: boolean }>({})
  const passwordEnabled =
    edits.password ?? (orgSettings?.auth_password_login_enabled as boolean | undefined) ?? true
  const samlEnabled = edits.saml ?? (orgSettings?.auth_saml_enabled as boolean | undefined) ?? false

  const handleSave = () => {
    const changes = {
      auth_password_login_enabled: passwordEnabled,
      auth_saml_enabled: samlEnabled,
    }
    if (!USE_REAL_API) {
      toast.success('Authentication settings saved (mock mode, not persisted)')
      return
    }
    updateSettings.mutate(changes, {
      onSuccess: () => {
        setEdits({})
        toast.success('Authentication settings saved')
      },
      onError: (err) => toast.error((err as Error).message || 'Could not save authentication settings'),
    })
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className="text-lg font-medium">Authentication</h3>

        <div className="flex items-center gap-2">
          <Checkbox
            id={passwordLoginId}
            checked={passwordEnabled}
            disabled={isLoading}
            onCheckedChange={(checked) => setEdits((p) => ({ ...p, password: checked }))}
          />
          <Label htmlFor={passwordLoginId} className="text-sm">
            Allow password login
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={samlLoginId}
            checked={samlEnabled}
            disabled={isLoading}
            onCheckedChange={(checked) => setEdits((p) => ({ ...p, saml: checked }))}
          />
          <Label htmlFor={samlLoginId} className="text-sm">
            Allow SAML login
          </Label>
        </div>

        {/* LDAP, Google OAuth and JWT are server-side configuration (env vars on
            the Redash instance), not organization settings, so there is nothing
            here that could write them. Say so rather than offer a dead control. */}
        <p className="text-xs text-muted-foreground">
          LDAP, Google OAuth and JWT are configured on the server, not from this page.
        </p>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
