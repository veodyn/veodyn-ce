'use client'

import { ParametersBar } from '@/components/parameters/parameters-bar'
import { ParameterSettingsDialog } from '@/components/parameters/parameter-settings-dialog'
import type { useEditorParameters } from './use-editor-parameters'

/**
 * The editor's parameter surface: values to run with, and a way into each
 * parameter's settings. Its own component so the editor page keeps room under
 * the file-size limit, and because the bar and its dialog always appear
 * together.
 */
export function QueryEditorParameterStrip({
  params,
}: {
  params: ReturnType<typeof useEditorParameters>
}) {
  if (params.parameters.length === 0) return null

  return (
    <div className="px-4 pt-3">
      <ParametersBar
        parameters={params.parameters}
        onChange={params.applyValues}
        onEditParameter={params.openSettings}
      />
      {params.editing && (
        <ParameterSettingsDialog
          // Remounts per parameter, so the dialog's fields are seeded from the
          // one being opened rather than from whichever was opened first.
          key={params.editing.name}
          open
          parameter={params.editing}
          onClose={params.closeSettings}
          onSave={params.saveSettings}
        />
      )}
    </div>
  )
}
