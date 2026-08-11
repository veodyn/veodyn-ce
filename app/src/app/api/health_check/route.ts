/**
 * Health endpoint for Kubernetes readiness/liveness probes
 * (helm frontend chart defaults to GET /api/health_check).
 */

export function GET() {
  return Response.json({ status: 'ok' })
}
