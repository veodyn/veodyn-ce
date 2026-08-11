'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { AuthSettings } from '@/components/settings/auth-settings'
import { FeatureFlags } from '@/components/settings/feature-flags'
import { FormatSettings } from '@/components/settings/format-settings'
import { InstanceDetails } from '@/components/settings/instance-details'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/page-container'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'auth', label: 'Authentication' },
  { id: 'features', label: 'Feature Flags' },
  { id: 'formats', label: 'Formats' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('general')

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Settings"
        description="Instance-wide preferences: sign-in methods, feature flags, and how dates are displayed."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="mb-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general"><InstanceDetails /></TabsContent>
        <TabsContent value="auth"><AuthSettings /></TabsContent>
        <TabsContent value="features"><FeatureFlags /></TabsContent>
        <TabsContent value="formats"><FormatSettings /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}
