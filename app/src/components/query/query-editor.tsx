'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useQuerySnippets } from '@/hooks/use-query-snippets'
import type { MockQuerySnippet, SchemaTable } from '@/lib/mock-data'

interface QueryEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute: () => void
  onSave: () => void
  schema: SchemaTable[]
}

export function QueryEditor({ value, onChange, onExecute, onSave, schema }: QueryEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  // The bundled Monaco is registered with the loader by monaco-setup.ts, which
  // can only run in a browser, so it is imported here rather than at the top
  // of this module (client components still render on the server). The
  // editor mounts only once that has happened: @monaco-editor/react calls
  // loader.init() in its own mount effect, and an init before config would
  // fall back to the CDN this exists to avoid.
  const [monacoReady, setMonacoReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    import('./monaco-setup').then(() => {
      if (!cancelled) setMonacoReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Snippets, held in a ref so the completion provider registered at mount can
  // read the current list rather than whatever had loaded by then. The hook is
  // called here rather than threaded as a prop because snippet-picker.tsx
  // already reads it the same way, and because a prop would have to cross three
  // components that have no other reason to know about snippets.
  const { data: snippets } = useQuerySnippets()
  const snippetsRef = useRef<MockQuerySnippet[]>([])
  // In an effect, not during render: assigning a ref while rendering is a
  // react-hooks/refs error, and this one genuinely is a post-render sync of an
  // async value into something the Monaco callback can read later.
  useEffect(() => {
    snippetsRef.current = snippets ?? []
  }, [snippets])

  // Completion providers register against the monaco instance, not the editor,
  // so they outlive this component unless disposed. Without this, every remount
  // added another provider and the suggestion list showed each snippet twice,
  // then three times.
  const snippetProviderRef = useRef<{ dispose: () => void } | null>(null)
  useEffect(() => () => snippetProviderRef.current?.dispose(), [])

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor

      // Keyboard shortcuts
      editor.addAction({
        id: 'execute-query',
        // Shown in Monaco's own command palette, so it is a user-facing name
        // and follows the button. The id stays put: it is not displayed, and
        // changing it would break any keybinding stored against it.
        label: 'Run Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => onExecute(),
      })

      editor.addAction({
        id: 'save-query',
        label: 'Save Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => onSave(),
      })

      // Schema-based autocomplete
      if (schema.length > 0) {
        monaco.languages.registerCompletionItemProvider('sql', {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position)
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            }

            const suggestions: Array<{
              label: string
              kind: number
              insertText: string
              range: typeof range
              detail?: string
            }> = []

            for (const table of schema) {
              suggestions.push({
                label: table.name,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: table.name,
                range,
                detail: 'Table',
              })
              for (const col of table.columns) {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range,
                  detail: `${table.name}.${col.name} (${col.type})`,
                })
              }
            }

            return { suggestions }
          },
        })
      }

      // Snippet expansion on the trigger word.
      //
      // The Query Snippets page has always described these as "expanded by
      // typing their trigger in the editor". That was Redash's mechanism, which
      // inserts through Ace's autocomplete; this product uses Monaco and
      // registered exactly one completion provider, for schema names. So the
      // sentence was false and the only real way in was the Snippets panel in
      // the sidebar. This registers the provider the sentence promises rather
      // than rewriting the sentence.
      //
      // Reads snippetsRef, not a captured list: snippets arrive from a query
      // after mount, and a provider registered with the value that existed at
      // mount time would offer nothing forever.
      //
      // InsertAsSnippet because the bodies already carry Monaco's own
      // placeholder syntax (`LIMIT ${1:100} OFFSET ${2:0}`), so tab-through
      // works without touching the fixtures. Inserted as plain text those
      // braces would land in the SQL literally.
      snippetProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }
          return {
            suggestions: snippetsRef.current.map((snippet) => ({
              label: snippet.trigger,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: snippet.snippet,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              detail: snippet.description,
              // The body in the side panel, so the reader can tell two similar
              // triggers apart before committing to one.
              documentation: snippet.snippet,
            })),
          }
        },
      })
    },
    [onExecute, onSave, schema]
  )

  if (!monacoReady) return null

  return (
    <Editor
      height="100%"
      defaultLanguage="sql"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      theme="vs"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        padding: { top: 8 },
      }}
    />
  )
}
