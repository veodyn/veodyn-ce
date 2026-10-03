import type { VisualizationPlugin } from './plugin'
import { getVisualization, registerVisualization } from './registry'

export function registerPlugins(plugins: readonly VisualizationPlugin[]): void {
  for (const plugin of plugins) {
    if (getVisualization(plugin.type) === plugin) continue
    registerVisualization(plugin, 'plugin')
  }
}
