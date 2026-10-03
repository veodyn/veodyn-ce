import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isRenderableComponent } from '@/test/component-shape'
import { CORE_VISUALIZATIONS, PLUGIN_API_VERSION, getVisualization, registerVisualization } from '@veodyn/viz'
import { VisualizationEditorSlot } from '@/components/visualizations/visualization-editor-slot'
import { CORE_EDITORS } from './visualization-editors'

describe('core visualization editors', () => {
  it('gives every builder-offered core type an editor', () => {
    for (const plugin of CORE_VISUALIZATIONS) {
      if (!plugin.choices?.length) continue
      expect(isRenderableComponent(CORE_EDITORS[plugin.type]), `${plugin.type} is pickable but has no Editor`).toBe(true)
    }
  })

  it('keeps editors out of the core plugin objects themselves', () => {
    for (const plugin of CORE_VISUALIZATIONS) {
      expect(getVisualization(plugin.type)?.Editor, plugin.type).toBeUndefined()
    }
  })

  it('lets the editor slot fall back to the editor a plugin registered with', async () => {
    registerVisualization({
      apiVersion: PLUGIN_API_VERSION,
      type: 'TEST_EDITOR_FALLBACK',
      displayName: 'Fallback',
      icon: () => null,
      defaultOptions: {},
      Renderer: () => null,
      Editor: () => <p>plugin editor</p>,
    })

    render(
      <VisualizationEditorSlot
        type="TEST_EDITOR_FALLBACK"
        options={{}}
        data={{ columns: [], rows: [] }}
        onChange={() => {}}
      />
    )

    expect(await screen.findByText('plugin editor')).toBeInTheDocument()
  })
})
