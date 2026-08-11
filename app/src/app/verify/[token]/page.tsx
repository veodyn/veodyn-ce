import { VerifyTokenView } from '@/components/auth/verify-token-view'

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <VerifyTokenView token={token} />
}
