'use client'

import { VeodynProvider, VeodynViz } from '@veodyn/viz'

const TOKENS = ['chart', 'table', 'counter', 'heatmap', 'choropleth']

export function HostWidgets() {
  return (
    <>
      <VeodynProvider baseUrl="" assetsUrl="http://assets.veodyn.test">
        {TOKENS.map((token) => (
          <VeodynViz key={token} token={token} className="widget" />
        ))}
      </VeodynProvider>
      <section id="dark-host">
        <VeodynProvider baseUrl="" theme="dark">
          <VeodynViz token="chart" className="widget" />
        </VeodynProvider>
      </section>
    </>
  )
}
