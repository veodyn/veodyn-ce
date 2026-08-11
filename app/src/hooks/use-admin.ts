'use client'

import { useQuery } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.message ?? `Request failed (${res.status})`)
  }
  return res.json()
}

/** Redash /status.json — flat metric map plus per-queue/database breakdowns. */
export interface AdminStatus {
  dashboards_count?: number
  queries_count?: number
  query_results_count?: number
  unused_query_results_count?: number
  version?: string
  workers?: unknown[]
  manager?: { outdated_queries_count?: string; last_refresh_at?: string; queues?: Record<string, { size?: number }> }
  database_metrics?: { metrics?: Array<[string, number]> }
  redis_used_memory?: number
  redis_used_memory_human?: string
}

export function useAdminStatus() {
  return useQuery({
    queryKey: ['admin', 'status'],
    queryFn: () => adminGet<AdminStatus>('/api/admin/status'),
    enabled: USE_REAL_API,
    refetchInterval: 60_000,
  })
}

export interface RqQueue {
  name: string
  started: unknown[]
  queued: number
}

export interface RqStatus {
  workers: Array<{
    name: string
    state: string
    birth_date?: string
    total_working_time?: number
    successful_jobs?: number
    failed_jobs?: number
    queues?: string
  }>
  queues: Record<string, { name?: string; started?: unknown[]; queued?: number }>
}

export function useAdminJobs() {
  return useQuery({
    queryKey: ['admin', 'rq-status'],
    queryFn: () => adminGet<RqStatus>('/api/admin/queries/rq-status'),
    enabled: USE_REAL_API,
    refetchInterval: 30_000,
  })
}

export interface OutdatedQueriesResponse {
  queries: Array<{
    id: number
    name: string
    retrieved_at?: string | null
    runtime?: number | null
    schedule?: { interval?: number } | null
  }>
  updated_at?: string
}

export function useOutdatedQueries() {
  return useQuery({
    queryKey: ['admin', 'outdated-queries'],
    queryFn: () => adminGet<OutdatedQueriesResponse>('/api/admin/queries/outdated'),
    enabled: USE_REAL_API,
    refetchInterval: 60_000,
  })
}
