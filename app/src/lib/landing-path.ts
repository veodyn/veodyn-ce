const LANDING_PATH_SHAPE = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/

export const ROOT_PATH = '/'
export const HOME_ROUTE = '/home'

export function landingPathFrom(raw: string | undefined): string {
  return raw && LANDING_PATH_SHAPE.test(raw) ? raw : ROOT_PATH
}

export const LANDING_PATH = landingPathFrom(process.env.NEXT_PUBLIC_LANDING_PATH)

export function landingRedirect(pathname: string, landing: string = LANDING_PATH): string | null {
  if (pathname === ROOT_PATH && landing !== ROOT_PATH) return landing
  if (pathname === HOME_ROUTE && landing !== HOME_ROUTE) return landing
  return null
}
