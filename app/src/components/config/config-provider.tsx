'use client'

import { createContext, useContext } from 'react'
import type { ClientConfig } from '@/lib/config-schema'

const ConfigContext = createContext<ClientConfig | null>(null)

export function ConfigProvider({ value, children }: { value: ClientConfig; children: React.ReactNode }) {
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): ClientConfig {
  const ctx = useContext(ConfigContext)
  if (ctx === null) throw new Error('useConfig must be used within a ConfigProvider')
  return ctx
}
