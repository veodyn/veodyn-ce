'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DASHBOARD_COLUMNS,
  normalizePublicDashboard,
  publicDashboardUrl,
  type PublicDashboardPayload,
  type PublicDashboardWidget,
} from '../lib/public-dashboard'
import { DashboardText } from './dashboard-text'
import { ParameterPicker } from './parameter-picker'
import { clampRefreshSeconds } from './refresh'
import { useElementSize } from './use-element-size'
import { useVeodyn } from './veodyn-context'
import { VeodynViz } from './veodyn-viz'

export type DashboardLayout = 'auto' | 'grid' | 'stack'

export interface DashboardWidgetFrameProps {
  widget: PublicDashboardWidget
  title: string | null
  children: ReactNode
}

export interface VeodynDashboardProps {
  token: string
  refreshSeconds?: number
  initialPayload?: PublicDashboardPayload | null
  parameters?: Record<string, string>
  onParametersChange?: (parameters: Record<string, string>) => void
  syncUrl?: boolean
  layout?: DashboardLayout
  stackBelow?: number
  rowHeight?: number
  gap?: number
  className?: string
  style?: CSSProperties
  renderWidgetFrame?: (props: DashboardWidgetFrameProps) => ReactNode
  renderText?: (text: string, widget: PublicDashboardWidget) => ReactNode
  renderLoading?: () => ReactNode
  renderUnavailable?: () => ReactNode
}

export const DEFAULT_STACK_BELOW = 768
export const DEFAULT_ROW_HEIGHT = 50
export const DEFAULT_GAP = 15
export const INITIAL_PAYLOAD_FRESH_MS = 60_000

async function fetchPublicDashboard(url: string, signal: AbortSignal): Promise<PublicDashboardPayload | null> {
  const response = await fetch(url, { credentials: 'omit', signal, headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Shared dashboard request failed with status ${response.status}`)
  return normalizePublicDashboard(await response.json().catch(() => null))
}

function DefaultFrame({ title, children }: DashboardWidgetFrameProps) {
  return (
    <section data-veodyn-part="dashboard-card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {title ? <h3 data-veodyn-part="dashboard-card-title">{title}</h3> : null}
      {children}
    </section>
  )
}

function DefaultUnavailable() {
  return <p data-veodyn-part="unavailable">This information is temporarily unavailable.</p>
}

function DefaultLoading() {
  return <div role="status" aria-label="Loading dashboard" data-veodyn-part="loading" />
}

function writeUrlParameters(values: Record<string, string>) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(values)) url.searchParams.set(`p_${name}`, value)
  window.history.replaceState(window.history.state, '', url)
}

function FillBox({ children }: { children: (height: number | undefined) => ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const size = useElementSize(element)
  return (
    <div ref={setElement} style={{ flex: '1 1 auto', minHeight: 0 }}>
      {children(size && size.height > 0 ? Math.floor(size.height) : undefined)}
    </div>
  )
}

function cellHeight(widget: PublicDashboardWidget, rowHeight: number, gap: number): number {
  const rows = widget.position.sizeY
  return rows * rowHeight + (rows - 1) * gap
}

export function VeodynDashboard({
  token,
  refreshSeconds,
  initialPayload,
  parameters,
  onParametersChange,
  syncUrl = true,
  layout = 'auto',
  stackBelow = DEFAULT_STACK_BELOW,
  rowHeight = DEFAULT_ROW_HEIGHT,
  gap = DEFAULT_GAP,
  className,
  style,
  renderWidgetFrame,
  renderText,
  renderLoading,
  renderUnavailable,
}: VeodynDashboardProps) {
  const { baseUrl } = useVeodyn()
  const refresh = clampRefreshSeconds(refreshSeconds)
  const url = publicDashboardUrl(baseUrl, token)
  const { data: payload, isLoading } = useQuery({
    queryKey: ['veodyn-public-dashboard', url],
    queryFn: ({ signal }) => fetchPublicDashboard(url, signal),
    retry: false,
    refetchInterval: refresh == null ? false : refresh * 1000,
    ...(initialPayload !== undefined
      ? { initialData: initialPayload, staleTime: refresh == null ? INITIAL_PAYLOAD_FRESH_MS : refresh * 1000 }
      : {}),
  })
  const [values, setValues] = useState<Record<string, string>>(parameters ?? {})
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const size = useElementSize(root)

  const choose = useCallback(
    (name: string, value: string) => {
      const next = { ...values, [name]: value }
      setValues(next)
      if (syncUrl) writeUrlParameters({ [name]: value })
      onParametersChange?.(next)
    },
    [values, syncUrl, onParametersChange]
  )

  if (isLoading && !payload) return <>{renderLoading ? renderLoading() : <DefaultLoading />}</>
  if (!payload) return <>{renderUnavailable ? renderUnavailable() : <DefaultUnavailable />}</>

  const stacked = layout === 'stack' || (layout === 'auto' && size !== null && size.width < stackBelow)
  const Frame = renderWidgetFrame ?? DefaultFrame

  const rootStyle: CSSProperties = stacked
    ? { display: 'flex', flexDirection: 'column', gap: `var(--veodyn-dashboard-gap, ${gap}px)`, ...style }
    : {
        display: 'grid',
        gridTemplateColumns: `repeat(${DASHBOARD_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap: `var(--veodyn-dashboard-gap, ${gap}px)`,
        ...style,
      }

  return (
    <div
      ref={setRoot}
      data-veodyn-part="dashboard"
      data-veodyn-layout={stacked ? 'stack' : 'grid'}
      aria-label={payload.name || undefined}
      className={className}
      style={rootStyle}
    >
      {payload.widgets.map((widget) => {
        const { col, row, sizeX, sizeY } = widget.position
        const cellStyle: CSSProperties = stacked
          ? widget.text !== null
            ? { minWidth: 0 }
            : { minWidth: 0, height: cellHeight(widget, rowHeight, gap) }
          : {
              minWidth: 0,
              minHeight: 0,
              overflow: widget.text !== null ? 'auto' : undefined,
              gridColumn: `${col + 1} / span ${sizeX}`,
              gridRow: `${row + 1} / span ${sizeY}`,
            }
        const viz = widget.visualization
        const title = viz && !widget.hideTitle && viz.name !== '' ? viz.name : null
        const widgetParameters = Object.fromEntries(
          widget.parameters.flatMap((parameter) =>
            values[parameter.name] !== undefined ? [[parameter.name, values[parameter.name]]] : []
          )
        )
        return (
          <div key={widget.id} data-veodyn-part="dashboard-cell" data-veodyn-widget={widget.id} style={cellStyle}>
            {viz === null ? (
              renderText ? (
                renderText(widget.text ?? '', widget)
              ) : (
                <DashboardText text={widget.text ?? ''} />
              )
            ) : (
              <Frame widget={widget} title={title}>
                {widget.parameters.map((parameter) => (
                  <ParameterPicker
                    key={parameter.name}
                    dashboardToken={token}
                    widgetId={widget.id}
                    parameter={parameter}
                    value={values[parameter.name]}
                    onChange={(value) => choose(parameter.name, value)}
                  />
                ))}
                <FillBox>
                  {(height) => (
                    <VeodynViz
                      dashboardToken={token}
                      widgetId={widget.id}
                      parameters={widgetParameters}
                      refreshSeconds={refreshSeconds}
                      style={height === undefined ? undefined : { height }}
                      renderUnavailable={renderUnavailable}
                    />
                  )}
                </FillBox>
              </Frame>
            )}
          </div>
        )
      })}
    </div>
  )
}
