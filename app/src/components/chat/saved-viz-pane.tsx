'use client'

import { useSavedVisualization } from '@/hooks/use-saved-visualization'
import type { CallView } from '@/lib/chat/thread-model'
import { DetailPane } from './detail-pane'
import { RunControls, SavedChart } from './saved-viz-card'

export function SavedVizPane({ call, onClose }: { call: CallView; onClose: () => void }) {
  const saved = useSavedVisualization(call)
  const names = [saved.query?.name, saved.visualization?.name].filter(Boolean)
  const title = names.length > 0 ? names.join(' · ') : 'Saved chart'
  return (
    <DetailPane
      title={title}
      sql={saved.query?.query ?? ''}
      vizChoiceId="table"
      data={saved.data ?? undefined}
      chart={<SavedChart saved={saved} className="h-96" />}
      actions={<RunControls saved={saved} />}
      onClose={onClose}
    />
  )
}
