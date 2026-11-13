'use client'

import { useId, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useConfig } from '@/components/config/config-provider'
import { LANDING_PATH } from '@/lib/landing-path'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'

interface TokenPasswordFormProps {
  token: string
  /** 'invite' clears is_invitation_pending; 'reset' just updates the password */
  mode: 'invite' | 'reset'
}

interface UserInfo {
  name: string
  email: string
}

type FieldName = 'password' | 'confirm'

interface FormIssue {
  message: string
  field: FieldName | null
}

type PageState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'form'; user: UserInfo }
  | { type: 'success' }

export function TokenPasswordForm({ token, mode }: TokenPasswordFormProps) {
  const router = useRouter()
  const { brand } = useConfig()
  const [state, setState] = useState<PageState>({ type: 'loading' })
  const passwordId = useId()
  const confirmId = useId()
  const errorId = useId()
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState<FormIssue | null>(null)

  const endpoint = `/api/node/${mode}/${token}`
  const title = mode === 'invite' ? 'Set your password' : 'Reset your password'
  const subtitle =
    mode === 'invite'
      ? 'Create a password to complete your account setup.'
      : 'Enter a new password for your account.'
  const submitLabel = mode === 'invite' ? 'Activate account' : 'Set new password'

  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(endpoint)
        const data = await res.json()
        if (!res.ok) {
          setState({ type: 'error', message: data.message ?? 'Link is invalid or expired.' })
        } else {
          setState({ type: 'form', user: data.user })
        }
      } catch {
        setState({ type: 'error', message: 'Could not reach the server. Please try again.' })
      }
    }
    validate()
  }, [endpoint])

  useEffect(() => {
    if (fieldError?.field === 'password') passwordRef.current?.focus()
    if (fieldError?.field === 'confirm') confirmRef.current?.focus()
  }, [fieldError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldError(null)

    if (password.length < 6) {
      setFieldError({ message: 'Password must be at least 6 characters.', field: 'password' })
      return
    }
    if (password !== confirm) {
      setFieldError({ message: 'Passwords do not match.', field: 'confirm' })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFieldError({ message: data.message ?? 'Something went wrong. Please try again.', field: null })
      } else {
        setState({ type: 'success' })
        setTimeout(() => router.replace(LANDING_PATH), 2000)
      }
    } catch {
      setFieldError({ message: 'Could not reach the server. Please try again.', field: null })
    } finally {
      setSubmitting(false)
    }
  }

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
        <h1 className="font-display text-2xl font-medium text-center mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">{subtitle}</p>

        {state.type === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Validating link…</span>
          </div>
        )}

        {state.type === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{state.message}</span>
            </div>
            <Button variant="outline" onClick={() => router.push(LANDING_PATH)} className="w-full">
              Back to login
            </Button>
          </div>
        )}

        {state.type === 'success' && (
          <div className="flex items-start gap-2 rounded-md border border-status-fresh/30 bg-status-fresh/10 px-3 py-2.5 text-sm text-status-fresh">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {mode === 'invite'
                ? 'Account activated! Redirecting to login…'
                : 'Password updated! Redirecting to login…'}
            </span>
          </div>
        )}

        {state.type === 'form' && (
          <form method="post" onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md bg-muted px-3 py-2.5 text-sm">
              <p className="font-medium">{state.user.name}</p>
              <p className="text-muted-foreground">{state.user.email}</p>
            </div>

            {fieldError && (
              <div
                id={errorId}
                role={fieldError.field === null ? 'alert' : undefined}
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{fieldError.message}</span>
              </div>
            )}

            <div>
              <Label htmlFor={passwordId} className="mb-1 block" required>
                New password
              </Label>
              <InputGroup>
                <InputGroupAddon>
                  <Lock />
                </InputGroupAddon>
                <InputGroupInput
                  id={passwordId}
                  ref={passwordRef}
                  aria-invalid={fieldError?.field === 'password'}
                  aria-describedby={fieldError?.field === 'password' ? errorId : undefined}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-required="true"
                  autoFocus
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div>
              <Label htmlFor={confirmId} className="mb-1 block" required>
                Confirm password
              </Label>
              <InputGroup>
                <InputGroupAddon>
                  <Lock />
                </InputGroupAddon>
                <InputGroupInput
                  id={confirmId}
                  ref={confirmRef}
                  aria-invalid={fieldError?.field === 'confirm'}
                  aria-describedby={fieldError?.field === 'confirm' ? errorId : undefined}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  aria-required="true"
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </InputGroup>
            </div>

            <Button type="submit" disabled={submitting || !password || !confirm} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Saving…' : submitLabel}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
