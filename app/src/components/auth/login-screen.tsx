'use client'

// The sign-in card, on its own route. It used to render in place of whatever
// protected page you were on, which left the address bar pointing at a page you
// could no longer see and gave the middleware nowhere to send an unauthenticated
// request.

import { useId, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useConfig } from '@/components/config/config-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Only a same-origin path is followed. `next` arrives in a query string that
// anyone can write, so it is resolved against a fixed base and the result is
// kept only if the origin did not move.
//
// Character checks were not enough. `//evil.example` is protocol-relative, and
// `/\evil.example` is too once the URL parser normalises the backslash, so a
// startsWith('/') && !startsWith('//') test accepted it and the browser then
// navigated off-site. Letting the URL parser decide means anything it would
// treat as another origin is refused, including forms not thought of here.
const SAFE_BASE = 'https://veodyn.invalid'

export function safeNextPath(next: string | null | undefined): string {
  if (!next) return '/'
  try {
    const resolved = new URL(next, SAFE_BASE)
    if (resolved.origin !== SAFE_BASE) return '/'
    // Rebuilt from the parsed parts rather than passed through, so what the
    // router receives is exactly what was validated.
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return '/'
  }
}

export function LoginScreen({ next }: { next?: string | null }) {
  const login = useAuthStore((s) => s.login)
  const useRealApi = useAuthStore((s) => s.useRealApi)
  // Whoever refused the sign-in said why, and the store keeps that. The card
  // repeats it rather than assuming a bad password, which is what it used to
  // report for a Redash that was down, rate limited, or not set up yet.
  const loginError = useAuthStore((s) => s.loginError)
  const { brand } = useConfig()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  // Both fields carry a real label association. Without htmlFor/id the visible
  // text sits next to the control rather than naming it, which leaves the sign
  // in form unlabelled for assistive tech and for any name-based query.
  const emailFieldId = useId()
  const passwordFieldId = useId()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    const form = e.target as HTMLFormElement
    const email = (form.elements.namedItem('email') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    const success = await login(email, password)

    if (success) {
      // `loading` is deliberately left set, and there is no state update after
      // this line. Between here and the destination rendering, the router is
      // still fetching a page; on stage that runs to seconds. Releasing the
      // button in that window puts an armed "Sign In" in front of someone who
      // is already signed in, which reads as a click that did nothing, so they
      // click again. This component goes away when the navigation lands.
      router.replace(safeNextPath(next))
      return
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="p-8 w-full max-w-sm">
        <div className="flex justify-center mb-2">
          {brand.logo ? (
            <Image src={brand.logo} alt={brand.name} width={64} height={64} />
          ) : (
            <span className="text-lg font-semibold">{brand.name}</span>
          )}
        </div>
        <h1 className="font-display text-2xl font-medium text-center mb-2">{brand.name}</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          {useRealApi ? 'Sign in to your account' : 'Sign in (mock mode, no backend required)'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor={emailFieldId} className="mb-1 block">
              Email
            </Label>
            <Input
              id={emailFieldId}
              name="email"
              type="email"
              defaultValue={useRealApi ? '' : 'admin@example.com'}
              required
            />
          </div>
          <div>
            <Label htmlFor={passwordFieldId} className="mb-1 block">
              Password
            </Label>
            <Input
              id={passwordFieldId}
              name="password"
              type="password"
              required={useRealApi}
              defaultValue={useRealApi ? '' : 'mock'}
            />
          </div>

          {loginError && !loading && (
            <p className="text-sm text-destructive" role="alert">
              {loginError}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>

        {!useRealApi && (
          <div className="mt-4 p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground">
              <strong>Mock mode:</strong> No backend needed. Use any email from mock data
              (admin@example.com, maya@example.com, jane@example.com, bob@example.com).
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Set <code className="bg-background px-1 rounded">NEXT_PUBLIC_REDASH_URL</code> in .env to connect to a real backend instance.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
