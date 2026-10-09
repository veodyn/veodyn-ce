# @veodyn/viz

Render Veodyn visualizations natively inside your own React or Next.js pages.
A visualization is built and shared in Veodyn. Your page places it by its share
token, and it draws in your page's DOM with your fonts and colours rather than
inside an iframe.

## Install

```sh
npm install @veodyn/viz
```

`react`, `react-dom` and `@tanstack/react-query` are peer dependencies. TypeScript
users also need `@types/react`.

Every Veodyn instance also serves the package it was built with, beside any
plugin packages it carries, at `/packages/<name>-<version>.tgz`:

```sh
curl -O https://veodyn.example.org/packages/veodyn-viz-0.2.0.tgz
npm install ./veodyn-viz-0.2.0.tgz
```

Keep the downloaded file in your repository. A later release of the instance
serves only its own versions, so a build that fetches the URL directly breaks
when the instance moves on.

## Render a shared visualization

```tsx
'use client'

import { VeodynProvider, VeodynViz } from '@veodyn/viz'

export function RidershipPanel() {
  return (
    <VeodynProvider baseUrl="https://veodyn.example.org">
      <VeodynViz token="SHARE_TOKEN" refreshSeconds={60} style={{ height: 420 }} />
    </VeodynProvider>
  )
}
```

Import the stylesheet once, usually in your root layout:

```ts
import '@veodyn/viz/styles.css'
```

Leave the import out to style everything yourself. The part attributes still
render, but the variables below are defined by the stylesheet, so define the ones
you use.

### `VeodynProvider`

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseUrl` | `string` | required | The Veodyn instance that issued the share tokens. |
| `plugins` | `VisualizationPlugin[]` | none | Extra visualization types to register, such as a pack's widgets. |
| `theme` | `'light' \| 'dark'` | `'light'` | The palette the widgets start from. |
| `queryClient` | `QueryClient` | a new one | Reuse your app's TanStack Query client. |
| `formats` | `{ dateFormat?, timeFormat? }` | Redash defaults | Date and time patterns for axes, tooltips and table cells. |
| `assetsUrl` | `string` | `baseUrl` | Where map geometry is fetched from. |

One provider can hold any number of `VeodynViz`. Two providers on one page may
share a plugin list.

### `VeodynViz`

| Prop | Type | What it does |
| --- | --- | --- |
| `token` | `string` | The share token of the visualization. |
| `parameters` | `Record<string, string \| number>` | Values for the parameters the visualization lists as public, sent as `p_<name>`. A visualization that does not list them answers as an unavailable token. |
| `refreshSeconds` | `number` | Re-read the latest stored result on this interval, between 15 and 3600 seconds. Without it the widget fetches once. |
| `className`, `style` | | Size the widget. A `style.height` such as `420`, `'60vh'` or `'calc(100vh - 4rem)'` is also the height charts and maps fill. A percentage, a keyword such as `auto` or `fit-content`, or a `var()` reference is not, because it may have nothing definite to resolve against inside the widget. Sized another way, they keep their own height inside your box. |
| `renderLoading` | `() => ReactNode` | Replaces the default loading placeholder. |
| `renderUnavailable` | `() => ReactNode` | Replaces the panel shown for a revoked, expired or unknown token. |

The fetch sends no cookies and no credentials. A token revoked in Veodyn shows the
unavailable panel on the next refresh. A refresh that fails, or that meets a
server error or rate limit, keeps the last good render on screen.

## Fetch on the server instead

A Next.js server component can fetch the payload itself and hand it to a client
component. `@veodyn/viz/normalize` holds no client code, so a server component or
route handler can import it.

```tsx
import { normalizePublicVisualization, publicVisualizationUrl } from '@veodyn/viz/normalize'
import { Panel } from './panel'

export default async function Page() {
  const response = await fetch(publicVisualizationUrl('https://veodyn.example.org', 'SHARE_TOKEN'))
  const payload = response.ok ? normalizePublicVisualization(await response.json()) : null
  return payload ? <Panel payload={payload} /> : <p>Not available.</p>
}
```

```tsx
'use client'

import { VeodynProvider, VisualizationRenderer, type PublicVisualizationPayload } from '@veodyn/viz'

export function Panel({ payload }: { payload: PublicVisualizationPayload }) {
  return (
    <VeodynProvider baseUrl="https://veodyn.example.org">
      <VisualizationRenderer
        visualization={{ ...payload.visualization, id: 0, created_at: '', updated_at: '' }}
        data={payload.data ?? { columns: [], rows: [] }}
      />
    </VeodynProvider>
  )
}
```

## Styling

Every rule the stylesheet ships is scoped under `.veodyn` and sits in one cascade
layer, `@layer veodyn`. Any rule of yours that is not in a layer wins over it,
whatever its specificity, and none of the package's utility classes reach markup
outside the provider.

### Parts

Target these attributes rather than class names. Class names are an
implementation detail and can change in any release. Renaming or removing a part
is a breaking change.

| Part | Where |
| --- | --- |
| `provider` | The provider's root element. |
| `portal` | Where tooltips and menus are portalled, inside the provider. |
| `root` | Each `VeodynViz`. |
| `loading`, `unavailable` | The default loading and unavailable states. |
| `visualization` | Every rendered visualization. It also carries `data-veodyn-type`, such as `CHART` or `TABLE`. |
| `problems` | The notice listing configuration problems. |
| `empty` | Messages such as "No data to display." |
| `tooltip` | Chart, heatmap, funnel, sankey and sunburst tooltips. |
| `legend`, `legend-item` | Chart legends, and the heatmap scale. |
| `chart` | The frame around line, area, bar, pie and scatter charts. |
| `table`, `table-toolbar`, `table-head`, `table-row`, `table-cell`, `pagination` | The table visualization. |
| `counter`, `counter-value`, `counter-label`, `counter-trend` | The counter, and a table whose result is a single number. |
| `map` | The point map and the choropleth. |
| `map-popup` | A point map marker's popup. |
| `heatmap`, `heatmap-cell` | The heatmap grid. |
| `details` | The single-record details view. |

`PARTS` exports the same list.

```css
[data-veodyn-type="COUNTER"] [data-veodyn-part="counter-value"] {
  color: #0b5394;
}
```

### Variables

Set any of these on `.veodyn`, or on a wrapper of your own, to change the palette.
`--chart-1` to `--chart-8` colour data series in order. With `theme="dark"` the
dark column applies.

| Variable | Light | Dark |
| --- | --- | --- |
| `--accent` | `#EFEBE2` | `#1A1F2B` |
| `--accent-foreground` | `#1C1B18` | `#E7E9EE` |
| `--background` | `#F7F5F0` | `#0B0E14` |
| `--border` | `#E5E1D8` | `rgba(255, 255, 255, 0.08)` |
| `--card` | `#FFFFFF` | `#12161F` |
| `--card-foreground` | `#1C1B18` | `#E7E9EE` |
| `--chart-1` | `#485EA7` | `#4A61AA` |
| `--chart-2` | `#2B7E4E` | `#2B7E4E` |
| `--chart-3` | `#A37AC7` | `#754998` |
| `--chart-4` | `#3570A2` | `#4D8FC8` |
| `--chart-5` | `#89435E` | `#A05771` |
| `--chart-6` | `#BF8A32` | `#BF861D` |
| `--chart-7` | `#1D9999` | `#1D9999` |
| `--chart-8` | `#B25630` | `#B55933` |
| `--destructive` | `#B4552D` | `#E06A45` |
| `--favorite` | `#C08A2D` | `#D9A441` |
| `--foreground` | `#1C1B18` | `#E7E9EE` |
| `--input` | `#E5E1D8` | `rgba(255, 255, 255, 0.12)` |
| `--muted` | `#F0EDE6` | `#1A1F2B` |
| `--muted-foreground` | `#6B6862` | `#9AA3B2` |
| `--popover` | `#FFFFFF` | `#12161F` |
| `--popover-foreground` | `#1C1B18` | `#E7E9EE` |
| `--primary` | `#475569` | `#7FA9E0` |
| `--primary-foreground` | `#FFFFFF` | `#0B0E14` |
| `--ring` | `#475569` | `#7FA9E0` |
| `--scrollbar-thumb` | `#D3CEC2` | `rgba(255, 255, 255, 0.16)` |
| `--scrollbar-thumb-hover` | `#B6B0A2` | `rgba(255, 255, 255, 0.28)` |
| `--secondary` | `#F0EDE6` | `#1A1F2B` |
| `--secondary-foreground` | `#1C1B18` | `#E7E9EE` |
| `--sidebar` | `#F7F5F0` | `#12161F` |
| `--sidebar-accent` | `#EFEBE2` | `#1A1F2B` |
| `--sidebar-accent-foreground` | `#1C1B18` | `#E7E9EE` |
| `--sidebar-border` | `#E5E1D8` | `rgba(255, 255, 255, 0.08)` |
| `--sidebar-foreground` | `#1C1B18` | `#E7E9EE` |
| `--sidebar-primary` | `#1C1B18` | `#E7E9EE` |
| `--sidebar-primary-foreground` | `#F7F5F0` | `#0B0E14` |
| `--sidebar-ring` | `#475569` | `#7FA9E0` |
| `--status-fresh` | `#2E7D4F` | `#4CAF7D` |
| `--status-stale` | `#94671F` | `#D9A441` |

### Fonts

The widgets inherit your page's font. To give them a different one, set
`font-family` on `.veodyn` or on any wrapper. Table column headings use a
monospace stack, which you can change by setting `--font-mono-family` on
`.veodyn`.

## Map geometry

A choropleth fetches its outlines from `{assetsUrl}/geo/<map>.geojson`. Veodyn
serves those files to any origin. Set `assetsUrl` only if you host the geometry
yourself.

## Not supported yet

- Free-form query parameters and filters. Only the parameters a visualization
  lists as public can be set, one value each.
- Editing. The package renders visualizations and does not include the editors.
