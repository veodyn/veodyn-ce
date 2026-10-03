'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type ThemeScope = 'light' | 'dark'

const ThemeScopeContext = createContext<ThemeScope>('light')

export function useThemeScope(): ThemeScope {
  return useContext(ThemeScopeContext)
}

export function ThemeScopeProvider({ scope, children }: { scope: ThemeScope; children: ReactNode }) {
  return <ThemeScopeContext.Provider value={scope}>{children}</ThemeScopeContext.Provider>
}
