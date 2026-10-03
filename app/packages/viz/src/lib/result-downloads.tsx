'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface ResultDownloads {
  csv: boolean
  tsv: boolean
  xlsxHref?: string
}

interface ResultDownloadsSource {
  value?: ResultDownloads
  resolve?: () => ResultDownloads | undefined
}

const ResultDownloadsContext = createContext<ResultDownloadsSource>({})

export function ResultDownloadsProvider({
  value,
  resolve,
  children,
}: ResultDownloadsSource & { children: ReactNode }) {
  return <ResultDownloadsContext.Provider value={{ value, resolve }}>{children}</ResultDownloadsContext.Provider>
}

export function useResultDownloads(): ResultDownloads | undefined {
  const source = useContext(ResultDownloadsContext)
  return source.value ?? source.resolve?.()
}
