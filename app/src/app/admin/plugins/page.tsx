'use client'

// What this image actually installed, read from the registry rather than from
// a manifest.
//
// The failure this page exists to make visible is a plugin that ships in the
// image but was never registered: the code is present, nothing imports it, and
// every visualization of its type renders "Unsupported visualization type" with
// no clue as to why. A build manifest would report that plugin as installed. A
// registry read cannot, because the registry is the same thing the renderer
// dispatches through.
import { Plug } from 'lucide-react'
import { RequireAdmin } from '@/components/auth/require-permission'
import { useConfig } from '@/components/config/config-provider'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { NoData } from '@/components/ui/no-data'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { registeredVisualizations } from '@/lib/visualizations'
import { effectiveAudience, visibleVisualizations } from '@/lib/viz-choices'
import { PLUGIN_PACKAGES, installedPluginNames } from '@/plugins'

const HEAD =
  'text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3'

/**
 * The package names this build was asked to install.
 *
 * Read at module scope because NEXT_PUBLIC_* is inlined at build time and
 * cannot change while the app runs, so re-reading it per render would only
 * suggest it could.
 */
const INSTALLED = installedPluginNames(process.env.NEXT_PUBLIC_VEODYN_PLUGINS)

export default function AdminPluginsPage() {
  const { visualizations } = useConfig()
  const registered = registeredVisualizations()
  const plugins = registered.filter((entry) => entry.origin === 'plugin')
  const coreCount = registered.length - plugins.length
  // The same call the type selector makes, so this column cannot drift from
  // what an analyst is actually offered.
  const offered = new Set(visibleVisualizations(visualizations).map((plugin) => plugin.type))

  return (
    <RequireAdmin>
      <PageContainer>
        <PageHeader
          title="Plugins"
          description="Visualization packages this build installed, and who they are offered to."
        />

        <p className="text-sm text-muted-foreground">
          {plugins.length === 0
            ? `No plugin visualizations are registered. ${coreCount} core types ship with the product.`
            : `${plugins.length} plugin ${plugins.length === 1 ? 'visualization' : 'visualizations'} from ${INSTALLED.join(', ')}, alongside ${coreCount} core types.`}
        </p>

        {plugins.length === 0 ? (
          <NoData
            card
            message={
              <span>
                Set <code className="font-mono">NEXT_PUBLIC_VEODYN_PLUGINS</code> at build time to
                install one. This build contains:{' '}
                <code className="font-mono">{Object.keys(PLUGIN_PACKAGES).join(', ')}</code>.
              </span>
            }
          />
        ) : (
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className={HEAD}>Visualization</TableHead>
                  <TableHead className={HEAD}>Type</TableHead>
                  <TableHead className={HEAD}>API</TableHead>
                  <TableHead className={HEAD}>Reads</TableHead>
                  <TableHead className={HEAD}>Audience</TableHead>
                  <TableHead className={HEAD}>In the picker</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map(({ plugin }) => {
                  const Icon = plugin.icon
                  const audience = effectiveAudience(plugin, visualizations.audience)
                  const overridden = visualizations.audience?.[plugin.type] != null
                  return (
                    <TableRow key={plugin.type} className="hover:bg-muted/30">
                      <TableCell className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Plug
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          {`Plugin[${plugin.displayName}]`}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {plugin.type}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">
                        {plugin.apiVersion}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">
                        {(plugin.needs ?? 'query-result') === 'none'
                          ? 'Nothing'
                          : 'Its query result'}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">
                        {audience === 'internal' ? 'Internal' : 'Analysts'}
                        {overridden && ' (set by config)'}
                      </TableCell>
                      {/* Two different reasons a type can be missing from the
                          picker, and an operator chasing "where did it go"
                          needs to know which one applies. */}
                      <TableCell className="px-4 py-3 text-muted-foreground">
                        {offered.has(plugin.type)
                          ? 'Offered'
                          : audience === 'internal'
                            ? 'Hidden: internal'
                            : 'Hidden: not in visualizations.enabled'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PageContainer>
    </RequireAdmin>
  )
}
