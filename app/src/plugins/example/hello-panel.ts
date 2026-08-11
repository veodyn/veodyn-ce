// The example visualization plugin.
//
// This package demonstrates the plugin seam documented in
// docs/visualization-plugins.md: a package the product does not maintain,
// reaching the app through nothing but VisualizationPlugin, installed by
// putting its directory under src/plugins/ and removed by deleting it. It is
// also the package that keeps plugin-boundary.test.ts honest: that test
// discovers packages by reading this directory, and with none present its
// it.each blocks would iterate an empty array and report green having
// checked nothing, which is the exact failure it exists to prevent.
//
// Kept as one file, unlike a multi-visualization package, because there is
// exactly one visualization here and nothing to split it against. Written with
// createElement rather than JSX so the plugin declaration and its render
// function can live in the same .ts file the generator expects an index.ts
// beside; see ./index.ts.
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

  // Draws nothing from a query result, the same way a static image panel
  // does; there is no data to read here at all.
  needs: 'none',

  // An ordinary type an analyst would create, not scenery an operator places.
  audience: 'analyst',

  Renderer: HelloPanelRenderer,
}
