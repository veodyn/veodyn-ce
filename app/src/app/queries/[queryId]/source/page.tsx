'use client'

import { use } from 'react'
import { QueryEditorPage } from '@/components/query/query-editor-page'

export default function QuerySourcePage({ params }: { params: Promise<{ queryId: string }> }) {
  const { queryId } = use(params)
  return <QueryEditorPage queryId={parseInt(queryId, 10)} />
}
