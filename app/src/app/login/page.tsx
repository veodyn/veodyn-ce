'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { LoginScreen } from '@/components/auth/login-screen'

// useSearchParams opts the tree into client rendering, so the boundary is
// required for the route to build. The fallback is the same card without a
// return path, which is the right answer if the query string never resolves.
function LoginWithReturnPath() {
  const params = useSearchParams()
  return <LoginScreen next={params.get('next')} />
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginScreen />}>
      <LoginWithReturnPath />
    </Suspense>
  )
}
