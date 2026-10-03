'use client'

import { VeodynProvider, VeodynViz } from '@veodyn/viz'

const TOKENS = ['chart', 'table', 'counter', 'heatmap', 'choropleth']

export function HostWidgets() {
  return (
    <VeodynProvider baseUrl="">
      {TOKENS.map((token) => (
        <VeodynViz key={token} token={token} className="widget" />
      ))}
    </VeodynProvider>
  )
}
