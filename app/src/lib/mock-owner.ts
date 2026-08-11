import type { CurrentUser } from '@/stores/auth-store'

/**
 * Who a newly created mock entity belongs to.
 *
 * The mock creation hooks used to stamp a hardcoded Admin User on everything.
 * That was invisible while "my" lists were also hardcoded to id 1, but once
 * those follow the identity switcher, anything created while acting as someone
 * else lands under a different owner and vanishes from the list that just
 * created it.
 *
 * The fallback keeps the previous behaviour for the case where nothing is
 * signed in, which is the only case that reached the old constant legitimately.
 */
export function mockOwner(user: CurrentUser | null): { id: number; name: string; email: string } {
  if (!user) {
    return { id: 1, name: 'Admin User', email: 'admin@example.com' }
  }
  return { id: user.id, name: user.name, email: user.email }
}
