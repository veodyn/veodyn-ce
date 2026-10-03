'use client'

import { createContext, useContext } from 'react'

export interface VeodynContextValue {
  baseUrl: string
}

export const VeodynContext = createContext<VeodynContextValue | null>(null)

export function useVeodyn(): VeodynContextValue {
  const value = useContext(VeodynContext)
  if (!value) throw new Error('VeodynViz must be rendered inside a VeodynProvider')
  return value
}
