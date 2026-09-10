export type SignInOutcome = { ok: true } | { ok: false; error: string }

async function refusalMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = (body as { message?: unknown } | null)?.message
  if (typeof message === 'string' && message.trim()) return message
  return `Sign in failed (${response.status}).`
}

export async function signInThrough(
  path: string,
  payload: Record<string, unknown>,
  loadSession: () => Promise<void>,
  isAuthenticated: () => boolean
): Promise<SignInOutcome> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('Login request failed:', err)
    return { ok: false, error: 'Could not reach the sign-in service. Check your connection.' }
  }

  if (!response.ok) return { ok: false, error: await refusalMessage(response) }

  await loadSession()
  if (!isAuthenticated()) {
    return {
      ok: false,
      error: 'Signed in, but the session could not be loaded. Please try again.',
    }
  }
  return { ok: true }
}
