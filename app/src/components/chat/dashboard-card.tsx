'use client'

import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { CallView } from '@/lib/chat/thread-model'
import { ToolCardTitle, ToolFailure } from './tool-card-parts'

export function DashboardCard({ call }: { call: CallView }) {
  const output = call.output?.kind === 'dashboard' && call.output.ok ? call.output : null
  const dashboard = output?.dashboard
  const widgets = output?.widgets ?? []
  const textWidgets = output?.textWidgets ?? 0
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <ToolCardTitle icon={LayoutDashboard} running={call.status === 'running'}>
          {dashboard ? (
            <Link href={`/dashboards/${dashboard.id}`} className="truncate hover:underline">
              {dashboard.name}
            </Link>
          ) : (
            <span>{call.status === 'running' ? 'Opening the dashboard…' : 'Dashboard'}</span>
          )}
        </ToolCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {call.status === 'failed' ? (
          <ToolFailure>{call.error ?? 'The dashboard could not be opened.'}</ToolFailure>
        ) : null}
        {widgets.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {widgets.map((widget) => (
              <li key={widget.visualizationId} className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/queries/${widget.queryId}`}
                  target="_blank"
                  rel="noopener"
                  className="truncate hover:underline"
                >
                  {widget.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{widget.visualizationType.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {output && widgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">This dashboard has no charts.</p>
        ) : null}
        {textWidgets > 0 ? (
          <p className="text-xs text-muted-foreground">
            {textWidgets === 1 ? 'Plus 1 text box.' : `Plus ${textWidgets} text boxes.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
