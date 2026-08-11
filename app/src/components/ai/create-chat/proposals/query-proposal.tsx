'use client'

// The query proposal: name, description and chart shape are the user's to
// change, the generated SQL is not. Editing SQL here would put a statement the
// validator never saw into the write, so the only ways to change it are to ask
// in the chat or to open the saved query in the editor (spec section 6).
import { useId, useState } from 'react'
import { useToast } from '@/components/shared/toast-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useDataSources } from '@/hooks/use-data-sources'
import { useCreateQuery } from '@/hooks/use-queries'
import { useCreateVisualization } from '@/hooks/use-visualizations'
import { useConfig } from '@/components/config/config-provider'
import { DEFAULT_VIZ_ID, resolveVizChoice, visibleVizChoices } from '@/lib/viz-choices'
import type { QueryProposal } from '@/types/ai-create'
import { ProposalFrame } from './proposal-frame'
import { createErrorMessage, defaultDataSourceId } from './proposal-model'
import { useCreateFromProposal } from './use-create-from-proposal'

interface QueryProposalCardProps {
  proposal: QueryProposal
  onCreated: (href: string | null) => void
  onBusyChange: (busy: boolean) => void
}

export function QueryProposalCard({
  proposal,
  onCreated,
  onBusyChange,
}: QueryProposalCardProps) {
  const { data: dataSources } = useDataSources()
  const createQuery = useCreateQuery()
  const createVisualization = useCreateVisualization()
  const toast = useToast()
  const commit = useCreateFromProposal({ onCreated, onBusyChange })

  const nameId = useId()
  const descriptionId = useId()
  const vizId = useId()
  const sourceId = useId()

  const [name, setName] = useState(proposal.name)
  const [description, setDescription] = useState(proposal.description)
  const [vizChoiceId, setVizChoiceId] = useState(proposal.vizChoiceId)
  const offeredVizChoices = useConfig().visualizations
  // Null until the user overrides it, so the default follows the data sources
  // as they load instead of being frozen from an empty first render.
  const [chosenSource, setChosenSource] = useState<number | null>(null)

  const sources = dataSources ?? []
  const dataSourceId = chosenSource ?? defaultDataSourceId(sources)
  const error = createErrorMessage('query', commit.error)

  function create() {
    if (dataSourceId == null) return
    commit.start(async () => {
      const query = await createQuery.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        // Byte-identical to what the validator passed. Nothing on this card
        // can reach it.
        query: proposal.sql,
        data_source_id: dataSourceId,
      })
      // A chart shape is an option on a CHART visualization, so the picked
      // choice becomes {type, name, options} rather than a type on its own.
      const choice = resolveVizChoice(vizChoiceId)
      // The service authored these options for one Redash type. The analyst can
      // change the shape in this card, and a chart's columnMapping means nothing
      // to a counter, so they travel only as far as the type they were written
      // for: line to bar keeps them, line to counter drops them.
      const options =
        resolveVizChoice(proposal.vizChoiceId).type === choice.type
          ? { ...choice.options, ...proposal.vizOptions }
          : choice.options
      // Every new query already has a TABLE visualization, so adding one for
      // the table choice gives the editor two identical Table tabs.
      if (choice.id !== DEFAULT_VIZ_ID) {
        try {
          await createVisualization.mutateAsync({
            queryId: query.id,
            type: choice.type,
            name: choice.label,
            options,
          })
        } catch {
          // The query exists. Saying "could not create this query" here would
          // be false, and the retry it invites writes a second copy of it.
          toast.warning(
            `Created the query, but its ${choice.label} visualization did not save. Add it from the editor.`
          )
        }
      }
      return `/queries/${query.id}`
    })
  }

  return (
    <ProposalFrame
      title="Create this query"
      description="Edit the details, then create it. The SQL is fixed here: ask in the chat for a change, or edit it in the query editor afterwards."
      createLabel="Create query"
      busy={commit.busy}
      error={error}
      canCreate={name.trim() !== '' && dataSourceId != null}
      onCreate={create}
    >
      <div className="space-y-2">
        <Label htmlFor={nameId}>Query name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={commit.busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={descriptionId}>Description</Label>
        <Textarea
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={commit.busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={vizId}>Visualization</Label>
        <Select
          value={vizChoiceId}
          onValueChange={(next) => {
            if (next != null) setVizChoiceId(String(next))
          }}
          disabled={commit.busy}
        >
          <SelectTrigger id={vizId} aria-label="Visualization" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* The instance allowlist governs creation wherever creation
                happens, and an AI proposal is a creation surface like any
                other. Reading the unfiltered list here let a proposal offer,
                and then persist, a type the instance had disabled. */}
            {visibleVizChoices(offeredVizChoices).map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Only when there is a decision to make. One data source is not a
          choice, and the label below still says which one it will be. */}
      {sources.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor={sourceId}>Data source</Label>
          <Select
            value={dataSourceId == null ? undefined : String(dataSourceId)}
            onValueChange={(next) => {
              if (next != null) setChosenSource(Number(next))
            }}
            disabled={commit.busy}
          >
            <SelectTrigger id={sourceId} aria-label="Data source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={String(source.id)}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Generated SQL <span className="text-muted-foreground">(read only)</span>
        </p>
        <pre
          aria-label="Generated SQL"
          className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap"
        >
          {proposal.sql}
        </pre>
        <p className="text-xs text-muted-foreground">
          Reads {proposal.datasetTable}.
        </p>
      </div>
    </ProposalFrame>
  )
}
