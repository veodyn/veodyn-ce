'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { useConfig } from '@/components/config/config-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface VerifyTokenViewProps {
  token: string
}

type VerifyState = { type: 'loading' } | { type: 'verified' } | { type: 'invalid' } | { type: 'error' }

/**
 * The token comes from a URL the user clicked (an email link), so it is
 * untrusted: it is percent-encoded before it reaches the fetch URL and it is
 * never logged.
 */
export function VerifyTokenView({ token }: VerifyTokenViewProps) {
  const router = useRouter()
  const { brand } = useConfig()
  const [state, setState] = useState<VerifyState>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function verify() {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(token)}`)
        if (cancelled) return
        if (res.ok) {
          setState({ type: 'verified' })
        } else if (res.status === 400) {
          setState({ type: 'invalid' })
        } else {
          setState({ type: 'error' })
        }
      } catch {
        if (!cancelled) setState({ type: 'error' })
      }
    }
    verify()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="p-8 w-full max-w-sm">
        <div className="flex justify-center mb-2">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt={brand.name} width={64} height={64} />
          ) : (
            <span className="text-xl font-semibold">{brand.name}</span>
          )}
        </div>
        <h1 className="font-display text-2xl font-medium text-center mb-2">Verify your email</h1>

        {state.type === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Verifying your email…</span>
          </div>
        )}

        {state.type === 'verified' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-status-fresh/30 bg-status-fresh/10 px-3 py-2.5 text-sm text-status-fresh">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your email is verified.</span>
            </div>
            <Button onClick={() => router.push('/')} className="w-full">
              Continue to {brand.name}
            </Button>
          </div>
        )}

        {state.type === 'invalid' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This verification link is invalid or has expired. You can request a new one from your account settings.</span>
            </div>
            <Button variant="outline" onClick={() => router.push('/')} className="w-full">
              Back to login
            </Button>
          </div>
        )}

        {state.type === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Could not reach the server. Please try again.</span>
            </div>
            <Button variant="outline" onClick={() => router.push('/')} className="w-full">
              Back to login
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
