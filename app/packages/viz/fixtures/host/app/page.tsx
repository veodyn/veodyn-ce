import { normalizePublicVisualization } from '@veodyn/viz/normalize'
import upstream from '../payloads/upstream.json'
import { HostWidgets } from './host-widgets'

export default function Page() {
  const payload = normalizePublicVisualization(upstream)
  return (
    <main>
      <p data-testid="server-normalized">{payload?.visualization.name}</p>
      <div id="host-flex" className="flex">
        host markup
      </div>
      <div id="host-padding" className="p-4">
        more host markup
      </div>
      <HostWidgets />
    </main>
  )
}
