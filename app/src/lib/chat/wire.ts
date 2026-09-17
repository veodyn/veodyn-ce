import { z } from 'zod'
import type { components } from '@/types/generated/veodyn-api'
import { toolResultSchema } from './tool-results'

type Schemas = components['schemas']

export type ChatThread = Schemas['ChatThreadOut']
export type ChatThreadList = Schemas['ChatThreadListOut']
export type ChatThreadDetail = Schemas['ChatThreadDetailOut']
export type ChatTurnRecord = Schemas['ChatTurnOut']
export type ChatDraftRecord = Schemas['ChatDraftOut']
export type ChatPromotion = Schemas['ChatPromotionOut']
export type ChatTurnStarted = Schemas['ChatTurnStartedOut']
export type ChatAccepted = Schemas['ChatAcceptedOut']

const uuid = z.string().uuid()
const timestamp = z.string().min(1).max(64)
const block = z.record(z.unknown())

export const threadSchema: z.ZodType<ChatThread> = z.object({
  id: uuid,
  title: z.string().max(200),
  pinned: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastTurnAt: timestamp,
})

export const threadListSchema: z.ZodType<ChatThreadList> = z.object({
  threads: z.array(threadSchema).max(50),
  nextOffset: z.number().int().nonnegative().nullable(),
})

const promotionSchema: z.ZodType<ChatPromotion> = z.object({
  id: uuid,
  targetType: z.string().max(32),
  targetId: z.string().max(64),
  promotedVersion: z.number().int().positive(),
  targetVersionAtPromote: z.number().int().nullable(),
  createdAt: timestamp,
})

export const promotionResponseSchema = promotionSchema

export const threadDetailSchema: z.ZodType<ChatThreadDetail> = z.object({
  thread: threadSchema,
  turns: z
    .array(
      z.object({
        id: uuid,
        seq: z.number().int().positive(),
        status: z.enum(['running', 'done', 'failed']),
        userText: z.string().max(4_000),
        blocks: z.array(block),
        stopReason: z.string().max(64).nullable(),
        errorId: z.string().max(128).nullable(),
        createdAt: timestamp,
        finishedAt: timestamp.nullable(),
      })
    )
    .max(200),
  drafts: z.array(
    z.object({
      id: uuid,
      kind: z.string().max(32),
      versions: z.array(
        z.object({
          version: z.number().int().positive(),
          turnId: uuid,
          payload: block,
          createdAt: timestamp,
        })
      ),
      promotions: z.array(promotionSchema),
    })
  ),
})

export const turnStartedSchema: z.ZodType<ChatTurnStarted> = z.object({
  turnId: uuid,
  seq: z.number().int().positive(),
})

export const acceptedSchema: z.ZodType<ChatAccepted> = z.object({ accepted: z.boolean() })

export const patchThreadSchema = z
  .object({ title: z.string().min(1).max(200).optional(), pinned: z.boolean().optional() })
  .strict()

export const turnRequestSchema = z.object({ text: z.string().min(1).max(4_000) }).strict()

export const toolResultRequestSchema = z
  .object({ callId: z.string().min(1).max(128), result: toolResultSchema })
  .strict()

export const promotionRequestSchema = z
  .object({
    version: z.number().int().positive(),
    targetType: z.literal('query'),
    targetId: z.string().min(1).max(64),
    targetVersionAtPromote: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()

export const chatIdSchema = uuid
