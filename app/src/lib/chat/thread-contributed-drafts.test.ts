import { describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'

const parseKpi = vi.hoisted(() => vi.fn())

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatDrafts: [{ kind: 'kpi', parse: parseKpi, card: async () => ({ default: () => null }) }],
    },
  }
  return { FEATURES }
})

import type { ChatFrame } from './frames'
import { addContributedPromotion, applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import type { ChatPromotion, ChatThreadDetail } from './wire'

const TURN = 'turn-1'
const DRAFT = 'draft-1'

function draftFrame(kind: string, payload: Record<string, unknown>, version = 1): ChatFrame {
  const parsed = {
    draftId: DRAFT,
    version,
    kind,
    payload,
  }
  return { event: 'draft', id: `1-${version}`, data: parsed as never }
}

function started() {
  return startTurn(emptyThread(), TURN, 1, 'go')
}

const PROMOTION = {
  id: 'promotion-1',
  targetType: 'snippet',
  targetId: '4',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'done',
  receipts: [],
  createdAt: 'x',
  updatedAt: 'x',
} as ChatPromotion

describe('drafts of a kind the thread does not draw itself', () => {
  it('keeps a community snippet draft, parsed, in the contributed slot', () => {
    const payload = { trigger: 'dt', snippet: 'select 1', description: '' }
    const state = applyFrame(started(), TURN, draftFrame('snippet', payload))
    expect(state.contributedDrafts[DRAFT]).toMatchObject({ id: DRAFT, kind: 'snippet', versions: [{ version: 1, payload }] })
    expect(state.turns[0].items).toEqual([{ kind: 'draft', draftId: DRAFT, version: 1 }])
  })

  it('drops a snippet payload that does not parse but still records the draft so a fallback can show', () => {
    const state = applyFrame(started(), TURN, draftFrame('snippet', { trigger: 5 }))
    expect(state.contributedDrafts[DRAFT]).toMatchObject({ kind: 'snippet', versions: [] })
  })

  it('hands a feature kind to the feature parser and stores what it returns', () => {
    parseKpi.mockReturnValue({ name: 'parsed' })
    const state = applyFrame(started(), TURN, draftFrame('kpi', { name: 'raw' }))
    expect(parseKpi).toHaveBeenCalledWith({ name: 'raw' })
    expect(state.contributedDrafts[DRAFT].versions).toEqual([{ version: 1, payload: { name: 'parsed' } }])
  })

  it('stores nothing for a feature that refuses its own payload', () => {
    parseKpi.mockReturnValue(null)
    const state = applyFrame(started(), TURN, draftFrame('kpi', { bad: true }))
    expect(state.contributedDrafts[DRAFT].versions).toEqual([])
  })

  it('keeps an unknown kind with its raw payload so the transcript can say it cannot show it', () => {
    const state = applyFrame(started(), TURN, draftFrame('mystery', { a: 1 }))
    expect(state.contributedDrafts[DRAFT]).toMatchObject({ kind: 'mystery', versions: [{ version: 1, payload: { a: 1 } }] })
  })

  it('adds versions in order and records promotions', () => {
    let state = applyFrame(started(), TURN, draftFrame('mystery', { a: 1 }, 1))
    state = applyFrame(state, TURN, draftFrame('mystery', { a: 2 }, 2))
    state = addContributedPromotion(state, DRAFT, PROMOTION)
    expect(state.contributedDrafts[DRAFT].versions.map((one) => one.version)).toEqual([1, 2])
    expect(state.contributedDrafts[DRAFT].promotions).toEqual([PROMOTION])
  })

  it('restores stored drafts of every kind into the contributed slot', () => {
    parseKpi.mockReturnValue({ name: 'parsed' })
    const detail = {
      thread: { id: TURN, title: 't', pinned: false, createdAt: 'x', updatedAt: 'x', lastTurnAt: 'x', origin: 'chat' },
      turns: [],
      drafts: [
        { id: DRAFT, kind: 'kpi', promotions: [PROMOTION], versions: [{ version: 1, payload: { name: 'raw' } }] },
        { id: 'other', kind: 'mystery', promotions: [], versions: [{ version: 1, payload: { a: 1 } }] },
        {
          id: 'snip',
          kind: 'snippet',
          promotions: [],
          versions: [{ version: 1, payload: { trigger: 'dt', snippet: 's', description: '' } }],
        },
      ],
    } as unknown as ChatThreadDetail
    const state = fromDetail(detail)
    expect(state.contributedDrafts[DRAFT]).toMatchObject({ kind: 'kpi', promotions: [PROMOTION] })
    expect(state.contributedDrafts.other).toMatchObject({ kind: 'mystery' })
    expect(state.contributedDrafts.snip.versions).toHaveLength(1)
  })
})
