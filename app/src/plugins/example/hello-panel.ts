// The example visualization plugin, demonstrating the seam documented in
// docs/visualization-plugins.md. plugin-boundary.test.ts discovers packages by
// reading src/plugins/, so with this package gone its it.each blocks iterate an
// empty array and report green. createElement rather than JSX so the plugin
// declaration and its renderer share one .ts file.
import { createElement } from 'react'
import { Sparkles } from 'lucide-react'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from '@/lib/visualizations'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const HELLO_PANEL_TYPE = 'EXAMPLE_HELLO_PANEL'

function HelloPanelRenderer() {
  return createElement(
    Card,
    null,
    createElement(CardHeader, null, createElement(CardTitle, null, 'Hello Panel')),
    createElement(
      CardContent,
      null,
      'The example plugin package, wired through the same seam a tenant package uses.'
    )
  )
}

export const helloPanelPlugin: VisualizationPlugin = {
  apiVersion: PLUGIN_API_VERSION,
  type: HELLO_PANEL_TYPE,
  displayName: 'Hello Panel',
  icon: Sparkles,
  defaultOptions: {},

  needs: 'none',

  // A type an analyst creates, not scenery an operator places.
  audience: 'analyst',

  Renderer: HelloPanelRenderer,
}
