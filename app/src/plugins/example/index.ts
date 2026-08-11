// Registers the example package's visualizations.
//
// The pattern every plugin package's index.ts follows: import each
// visualization's plugin object, register it, and export the result under
// the name `register`, which scripts/generate-plugin-registry.mjs requires.
// A package with more than one visualization registers each of them the same
// way and exports one `register`; this one has a single entry.
import { registerVisualization, type VisualizationPlugin } from '@/lib/visualizations'
import { helloPanelPlugin } from './hello-panel'

export const EXAMPLE_VISUALIZATIONS: readonly VisualizationPlugin[] = [helloPanelPlugin]

/**
 * Register every example visualization.
 *
 * Not idempotent by design, matching every other package: registerVisualization
 * throws on a duplicate type, and calling this twice is a wiring bug worth
 * hearing about rather than something to paper over.
 */
export function registerExampleVisualizations(): void {
  for (const plugin of EXAMPLE_VISUALIZATIONS) {
    registerVisualization(plugin)
  }
}

// The canonical export name the plugin registry generator expects.
export { registerExampleVisualizations as register }
