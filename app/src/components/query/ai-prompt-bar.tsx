'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useAiEnabled, useGenerateSql } from '@/hooks/use-ai'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import type { AiDataset, GenerateSqlResponse } from '@/types/ai'

interface AiPromptBarProps {
  dataset: AiDataset
  currentSql: string
  onGenerated: (sql: string) => void
  /**
   * Why generation is off, when it is. Said rather than hidden: a bar that
   * vanishes for some data sources reads as a missing feature, and the reason
   * ("takes json, not SQL") is the thing worth knowing.
   */
  blockedReason?: string | null
}

export function AiPromptBar({
  dataset,
  currentSql,
  onGenerated,
  blockedReason = null,
}: AiPromptBarProps) {
  const enabled = useAiEnabled()
  const generation = useGenerateSql()
  const inputId = useId()
  const rationaleId = useId()
  const errorId = useId()
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<GenerateSqlResponse | null>(null)

  // A superseded or unmounted generation must not overwrite a newer draft. Each
  // submit gets its own controller and a monotonic token: a new submit aborts
  // the old request, and only the current token's response is applied.
  const controllerRef = useRef<AbortController | null>(null)
  const tokenRef = useRef(0)
  useEffect(() => () => controllerRef.current?.abort(), [])

  // The latest editor content, so a response can be dropped when the analyst
  // hand-edits the draft while the generation is still pending. A new submit is
  // not the only way the base moves out from under an in-flight request.
  const currentSqlRef = useRef(currentSql)
  useEffect(() => {
    currentSqlRef.current = currentSql
  }, [currentSql])

  if (!enabled) return null

  const isIteration = result !== null
  const label = isIteration ? 'Edit with prompt' : 'Generate SQL with AI'
  const blocked = blockedReason != null
  const descriptionId = blocked
    ? errorId
    : generation.isError
      ? errorId
      : result
        ? rationaleId
        : undefined

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (blocked || trimmedPrompt.length === 0 || generation.isPending) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const token = tokenRef.current + 1
    tokenRef.current = token
    // The editor content this generation is based on. If the analyst hand-edits
    // the draft before the response lands, applying it would clobber that edit.
    const baseSql = currentSql

    generation.mutate(
      { prompt: trimmedPrompt, dataset, currentSql, signal: controller.signal },
      {
        onSuccess: (response) => {
          // Ignore a response the editor has already moved past, whether from a
          // newer generation (token) or a manual edit under this one (baseSql).
          if (token !== tokenRef.current) return
          if (currentSqlRef.current !== baseSql) return
          setResult(response)
          setPrompt('')
          onGenerated(response.sql)
        },
      }
    )
  }

  return (
    <form className="space-y-2 border-b bg-card px-3 py-2" onSubmit={handleSubmit}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <InputGroup>
        <InputGroupAddon>
          <Sparkles aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          id={inputId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            // "off for this data source" was untrue for the block an author
            // meets most: an empty editor on a source with several tables,
            // which naming one turns on. It also contradicted the reason
            // printed directly below. The placeholder now states only the part
            // that is always true, and the specific reason stays the answer.
            blocked ? 'SQL generation is off' : isIteration ? 'Edit with prompt' : 'Describe the SQL you want'
          }
          disabled={blocked}
          aria-describedby={descriptionId}
          aria-invalid={generation.isError || undefined}
        />
        <InputGroupAddon align="inline-end">
          <Button
            type="submit"
            size="sm"
            disabled={blocked || generation.isPending || prompt.trim().length === 0}
          >
            {generation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {generation.isPending
              ? 'Generating draft'
              : isIteration
                ? 'Update draft'
                : 'Generate draft'}
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {result ? (
        <p id={rationaleId} className="text-xs text-muted-foreground" aria-live="polite">
          {result.rationale}
        </p>
      ) : null}
      {blocked ? (
        // status, not alert: nothing failed. The offer was never applicable to
        // this source, and saying so is the whole content of the line.
        <p id={errorId} role="status" className="text-xs text-muted-foreground">
          {blockedReason} Write SQL manually below.
        </p>
      ) : null}
      {!blocked && generation.isError ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          AI is unavailable right now. Write SQL manually below.
        </p>
      ) : null}
    </form>
  )
}
