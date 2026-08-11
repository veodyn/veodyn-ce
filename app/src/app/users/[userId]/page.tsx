'use client'

import { use } from 'react'
import { AdminUserDetail } from '@/components/users/admin-user-detail'
import { PageContainer } from '@/components/layout/page-container'

export default function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  return (
    <PageContainer width="narrow">
      <AdminUserDetail userId={userId} />
    </PageContainer>
  )
}
