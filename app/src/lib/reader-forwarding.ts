// What a public-link proxy has to carry through so the backend that resolves
// the token still knows who asked. Without it, the access log records Next's
// own address for every reader who came through the product's URL.
//
// The chain is forwarded unchanged, with nothing appended: a route handler sees
// only the Web `Request`, which does not expose the socket peer, so Next cannot
// name its own client. The ingress in front of it already added that address.

const FORWARDED_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  // Not identity, but the other two columns an access log wants. Undici would
  // otherwise send its default user-agent and no referer at all.
  'user-agent',
  'referer',
] as const

export function readerForwardingHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  return headers
}
