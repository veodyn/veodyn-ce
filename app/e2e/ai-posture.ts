import { expect, type APIRequestContext } from '@playwright/test'

// Which posture the web server under test is in.
//
// ai.enabled is server-side instance config read once at server start, and Next
// refuses two dev servers from one directory, so the posture is a property of
// the running server rather than something a test can set. Every AI spec asks
// this and skips the half it is not: `pnpm test:e2e` runs the disabled posture,
// `pnpm test:e2e:ai` the enabled one.
//
// Not a spec file: the name deliberately avoids the `.spec.` pattern Playwright
// collects.
const PROBE_REQUEST = {
  prompt: 'rows by day',
  dataset: { table: 'vehicle_locations', columns: [{ name: 'device_id', type: 'String' }] },
}

/**
 * Reads the posture off the server-side gates. This probe carries no session,
 * so 403 is the disabled instance answering (the disabled gate is first), and
 * 401 is the enabled instance refusing an unauthenticated caller before it runs
 * the mock or the provider. Anything else is a broken route rather than a
 * posture, so it fails the run instead of skipping it. A 200 here would be the
 * pre-fix bug: the relay answering an anonymous caller.
 */
export async function aiEnabledOnServer(request: APIRequestContext): Promise<boolean> {
  const response = await request.post('/api/ai/generate-sql', { data: PROBE_REQUEST })
  const status = response.status()

  if (status === 403) {
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_002' })
    return false
  }
  if (status === 401) {
    expect(await response.json()).toMatchObject({ id: 'E_AUTH_001' })
    return true
  }
  throw new Error(`POST /api/ai/generate-sql answered ${status}, which is neither posture`)
}

export const SKIP_UNLESS_AI =
  'this server has ai.enabled false; run pnpm test:e2e:ai for the enabled posture'
