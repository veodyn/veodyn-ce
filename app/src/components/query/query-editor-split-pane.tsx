'use client'

// The PRO editor stacked over its results, with a pointer- and
// keyboard-operable splitter between them. Pulled out of QueryEditorPage so
// the height-persistence hook and the resize callback that reads its state
// stay next to the JSX that drives them, rather than the page threading a raw
// setter through.
import type { ComponentProps } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { QueryEditor } from './query-editor'
import { QueryEditorResults } from './query-editor-results'
import { MAX_EDITOR_HEIGHT, MIN_EDITOR_HEIGHT, usePersistedEditorHeight } from './use-editor-height'

interface QueryEditorSplitPaneProps {
  editor: ComponentProps<typeof QueryEditor>
  results: ComponentProps<typeof QueryEditorResults>
}

export function QueryEditorSplitPane({ editor, results }: QueryEditorSplitPaneProps) {
  const { defaultHeight, onResize } = usePersistedEditorHeight()

  return (
    <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
      <ResizablePanel
        id="query-editor-pane"
        defaultSize={defaultHeight}
        minSize={MIN_EDITOR_HEIGHT}
        maxSize={MAX_EDITOR_HEIGHT}
        onResize={(size) => onResize(size.inPixels)}
        className="border-b"
      >
        <QueryEditor {...editor} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="query-results-pane" minSize={80}>
        <QueryEditorResults {...results} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
