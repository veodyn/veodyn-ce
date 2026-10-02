'use client'

import { createElement, Suspense } from 'react'
import { chatToolCardFor } from '@/features/chat-tools'
import type { CallView } from '@/lib/chat/thread-calls'

export function ContributedCallCard({ call }: { call: CallView }) {
  const card = chatToolCardFor(call.tool)
  if (!card) return null
  // createElement and a lowercase binding, as in features/slots.tsx: this is a
  // lookup in a module-level cache, not a component declared during a render.
  return <Suspense fallback={null}>{createElement(card, { call })}</Suspense>
}
