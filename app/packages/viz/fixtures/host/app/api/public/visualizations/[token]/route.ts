import chart from '../../../../../payloads/chart.json'
import choropleth from '../../../../../payloads/choropleth.json'
import counter from '../../../../../payloads/counter.json'
import heatmap from '../../../../../payloads/heatmap.json'
import table from '../../../../../payloads/table.json'

const PAYLOADS: Record<string, unknown> = { chart, choropleth, counter, heatmap, table }

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const payload = PAYLOADS[token]
  if (!payload) return Response.json({ error: 'visualization not available' }, { status: 404 })
  return Response.json(payload)
}
