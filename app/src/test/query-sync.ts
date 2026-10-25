import { vi } from 'vitest'
import type { HeldQuerySync, QueryDraftSync } from '@/lib/chat/thread-sync'

export function querySync(held: Record<string, HeldQuerySync> = {}): QueryDraftSync {
  return { held, hold: vi.fn(), retry: vi.fn().mockResolvedValue(null) }
}
