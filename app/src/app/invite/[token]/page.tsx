import { TokenPasswordForm } from '@/components/auth/token-password-form'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <TokenPasswordForm token={token} mode="invite" />
}
