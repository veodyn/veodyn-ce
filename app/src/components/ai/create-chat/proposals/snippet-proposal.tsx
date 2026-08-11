'use client'

// The snippet proposal. A snippet is text with a trigger and nothing is
// grounded, so all three fields are the user's. There is no snippet detail
// route to open afterwards, so the commit answers null: stay where you are.
import { useId, useState } from 'react'
import { useToast } from '@/components/shared/toast-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCreateSnippet } from '@/hooks/use-query-snippets'
import type { SnippetProposal } from '@/types/ai-create'
import { ProposalFrame } from './proposal-frame'
import { createErrorMessage } from './proposal-model'
import { useCreateFromProposal } from './use-create-from-proposal'

interface SnippetProposalCardProps {
  proposal: SnippetProposal
  onCreated: (href: string | null) => void
  onBusyChange: (busy: boolean) => void
}

export function SnippetProposalCard({
  proposal,
  onCreated,
  onBusyChange,
}: SnippetProposalCardProps) {
  const createSnippet = useCreateSnippet()
  const toast = useToast()
  const commit = useCreateFromProposal({ onCreated, onBusyChange })

  const triggerId = useId()
  const bodyId = useId()
  const descriptionId = useId()

  const [trigger, setTrigger] = useState(proposal.trigger)
  const [snippet, setSnippet] = useState(proposal.snippet)
  const [description, setDescription] = useState(proposal.description)

  const error = createErrorMessage('snippet', commit.error)

  function create() {
    commit.start(async () => {
      await createSnippet.mutateAsync({
        trigger: trigger.trim(),
        snippet,
        description: description.trim(),
      })
      // Nowhere to navigate, so the toast is the only confirmation the user
      // gets that the snippet exists.
      toast.success(`Snippet ${trigger.trim()} created.`)
      return null
    })
  }

  return (
    <ProposalFrame
      title="Create this snippet"
      description="The trigger is what you type in the editor to insert the snippet."
      createLabel="Create snippet"
      busy={commit.busy}
      error={error}
      canCreate={trigger.trim() !== '' && snippet.trim() !== ''}
      onCreate={create}
    >
      <div className="space-y-2">
        <Label htmlFor={triggerId}>Trigger</Label>
        <Input
          id={triggerId}
          value={trigger}
          onChange={(event) => setTrigger(event.target.value)}
          disabled={commit.busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={bodyId}>Snippet</Label>
        <Textarea
          id={bodyId}
          value={snippet}
          rows={5}
          onChange={(event) => setSnippet(event.target.value)}
          disabled={commit.busy}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={descriptionId}>Description</Label>
        <Input
          id={descriptionId}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={commit.busy}
        />
      </div>
    </ProposalFrame>
  )
}
