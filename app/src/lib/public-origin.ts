function firstValue(header: string | null): string | null {
  const value = header?.split(',')[0]?.trim()
  return value ? value : null
}

export function publicOrigin(request: Request): string {
  const host = firstValue(request.headers.get('x-forwarded-host')) ?? firstValue(request.headers.get('host'))
  if (!host) return new URL(request.url).origin
  const protocol = firstValue(request.headers.get('x-forwarded-proto')) ?? 'https'
  return `${protocol}://${host}`
}
