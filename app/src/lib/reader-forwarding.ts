// What a public-link proxy has to carry through so the backend that resolves
// the token still knows who asked.
//
// Both backends now sit on their own ingresses, so a share token can be
// redeemed at the origin directly and each backend logs the read where it
// resolves the token. That makes these two hops equal in every way except one:
// a read that comes through Next arrives from Next's address, so without this
// the access log would record the proxy for every reader who used the product's
// own URL.
//
// This appends nothing of its own. A route handler sees only the Web `Request`,
// which does not expose the socket peer, so Next cannot name its own client;
// the ingress in front of it already put that address on the chain, and the
// backend sees Next as its immediate peer anyway. Forwarding the chain
// unchanged therefore preserves every hop that is actually knowable here, and
// inventing one would be worse than the gap.

const FORWARDED_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  // Not identity, but the other two columns an access log wants. Undici would
  // otherwise present its own default user-agent and no referer at all, which
  // reads as "a robot with no source" for every reader who came through here.
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
