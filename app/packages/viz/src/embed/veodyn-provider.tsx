'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { ThemeScopeProvider, type ThemeScope } from '../components/theme/theme-scope'
import type { VisualizationPlugin } from '../lib/visualizations/plugin'
import { registerPlugins } from '../lib/visualizations/register-plugins'
import { VizEnvironmentProvider } from '../lib/viz-environment'
import { DEFAULT_VIZ_FORMATS, formatsFor, VizFormatsProvider } from '../lib/viz-formats'
import { VeodynContext } from './veodyn-context'

export interface VeodynProviderProps {
  baseUrl: string
  plugins?: readonly VisualizationPlugin[]
  theme?: ThemeScope
  queryClient?: QueryClient
  formats?: { dateFormat?: string; timeFormat?: string }
  assetsUrl?: string
  children: ReactNode
}

export function VeodynProvider({
  baseUrl,
  plugins,
  theme = 'light',
  queryClient,
  formats,
  assetsUrl,
  children,
}: VeodynProviderProps) {
  if (plugins) registerPlugins(plugins)
  const [ownClient] = useState(() => new QueryClient())
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  const dateFormat = formats?.dateFormat ?? DEFAULT_VIZ_FORMATS.dateFormat
  const timeFormat = formats?.timeFormat ?? DEFAULT_VIZ_FORMATS.timeFormat
  const vizFormats = useMemo(() => formatsFor(dateFormat, timeFormat), [dateFormat, timeFormat])
  const context = useMemo(() => ({ baseUrl }), [baseUrl])

  return (
    <QueryClientProvider client={queryClient ?? ownClient}>
      <VeodynContext.Provider value={context}>
        <ThemeScopeProvider scope={theme}>
          <VizFormatsProvider value={vizFormats}>
            <VizEnvironmentProvider assetsUrl={assetsUrl ?? baseUrl} root={root} portalContainer={portalContainer}>
              <div ref={setRoot} className="veodyn" data-theme={theme} data-veodyn-part="provider">
                {children}
                <div ref={setPortalContainer} data-veodyn-part="portal" />
              </div>
            </VizEnvironmentProvider>
          </VizFormatsProvider>
        </ThemeScopeProvider>
      </VeodynContext.Provider>
    </QueryClientProvider>
  )
}

