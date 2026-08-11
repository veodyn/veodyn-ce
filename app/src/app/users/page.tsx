'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { AdminUserList } from '@/components/users/admin-user-list'
import { GroupList, type RedashGroup } from '@/components/users/group-list'
import { GroupDetail } from '@/components/users/group-detail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/page-container'

const tabs = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
] as const

export default function AdminUsersPage() {
  const [tab, setTab] = useState<'users' | 'groups'>('users')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  return (
    <PageContainer>
      <PageHeader title="Team" description="Manage users, groups, and permissions." />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'users' | 'groups')
          setSelectedGroupId(null)
        }}
      >
        <TabsList variant="line" className="mb-4">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="users"><AdminUserList /></TabsContent>
        <TabsContent value="groups">
          {selectedGroupId ? (
            <GroupDetail groupId={selectedGroupId} onBack={() => setSelectedGroupId(null)} />
          ) : (
            <GroupList onSelectGroup={(g: RedashGroup) => setSelectedGroupId(String(g.id))} />
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
