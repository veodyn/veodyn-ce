import { describe, expect, it } from 'vitest'
import * as legacyDisclosure from '@/components/ai/create-chat/proposals/written-query-disclosure'
import * as legacyFrame from '@/components/ai/create-chat/proposals/proposal-frame'
import * as legacyModel from '@/components/ai/create-chat/proposals/proposal-model'
import * as legacyCreate from '@/components/ai/create-chat/proposals/use-create-from-proposal'
import * as legacyWrite from '@/components/ai/create-chat/proposals/use-write-proposed-query'
import { createErrorMessage, defaultDataSourceId } from './create-model'
import { ProposalFrame } from './proposal-frame'
import { useCreateFromProposal } from './use-create-from-proposal'
import { useWriteProposedQuery } from './use-write-proposed-query'
import { WrittenQueryDisclosure } from './written-query-disclosure'
import * as legacyButton from '@/components/ai/create-chat/create-with-ai-button'
import { CreateWithAiButton } from '@/components/chat/create-with-ai-button'

describe('proposal kit', () => {
  it('serves the same pieces from the old paths', () => {
    expect(legacyFrame.ProposalFrame).toBe(ProposalFrame)
    expect(legacyDisclosure.WrittenQueryDisclosure).toBe(WrittenQueryDisclosure)
    expect(legacyCreate.useCreateFromProposal).toBe(useCreateFromProposal)
    expect(legacyWrite.useWriteProposedQuery).toBe(useWriteProposedQuery)
    expect(legacyModel.createErrorMessage).toBe(createErrorMessage)
    expect(legacyModel.defaultDataSourceId).toBe(defaultDataSourceId)
  })

  it('serves the Create with AI button from its old path', () => {
    expect(legacyButton.CreateWithAiButton).toBe(CreateWithAiButton)
  })

  it('prefers ClickHouse for the default data source', () => {
    expect(
      defaultDataSourceId([
        { id: 1, name: 'a', type: 'pg' },
        { id: 2, name: 'b', type: 'ClickHouse' },
      ])
    ).toBe(2)
  })
})
