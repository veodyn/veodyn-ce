import { beforeEach, describe, expect, it } from 'vitest'
import { buildPolicy } from '@/lib/policy'
import { useAuthStore } from '@/stores/auth-store'

describe('auth-store report publishing permission', () => {
  beforeEach(() => {
    useAuthStore.setState({
      currentUser: null,
      isAuthenticated: false,
      isLoading: true,
    })
  })

  it('lets the mock admin publish by being an admin, not by permission', async () => {
    // The mock groups mirror Redash's, and Redash's admin group does not carry
    // publish_report: it is this product's permission, not Redash's. Granting
    // it to the fixture made the mock admin the one account that could not
    // reproduce what every real admin saw, which is how a Publishing panel that
    // refused its own admin shipped. The rule that matters is the policy's, and
    // it is the same one veodyn-api applies.
    await useAuthStore.getState().loadSession()

    const currentUser = useAuthStore.getState().currentUser
    expect(currentUser?.isAdmin).toBe(true)
    expect(currentUser?.hasPermission('publish_report')).toBe(false)
    expect(buildPolicy(currentUser ?? null).canPublishReport()).toBe(true)
  })
})
