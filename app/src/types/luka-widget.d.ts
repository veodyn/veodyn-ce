/**
 * Luka Embed Widget Type Definitions
 * Based on luka_web/embed/src/types.ts
 */

export type WidgetMode = 'bubble' | 'copilot' | 'inline' | 'embedded'
export type WidgetPosition = 'bottom-right' | 'bottom-left'
export type WidgetTheme = 'light' | 'dark' | 'ocean' | 'sunset' | 'auto'

export interface PageContext {
  url?: string
  title?: string
  description?: string
  topic?: string
  stage?: string
  product?: {
    id?: string
    name?: string
    category?: string
    price?: number
  }
  userSegment?: string
  custom?: Record<string, unknown>
}

export interface LukaEmbedConfig {
  integrationId: string
  mode: WidgetMode
  position: WidgetPosition
  defaultOpen: boolean
  panelWidth: string
  theme: WidgetTheme | string
  primaryColor: string
  title: string
  greeting?: string
  locale: string
  apiUrl: string
  authToken?: string
  subAgent?: string
  agentConfig?: Record<string, unknown>
  pageContext?: PageContext
  autoOpenOnScroll?: boolean
  autoOpenDelay?: number
  showUnreadBadge?: boolean
  persistSession?: boolean
  /** Block public thread creation, force all threads to private */
  privateOnly?: boolean
  /** Container element for embedded mode */
  container?: HTMLElement | null
}

export interface LukaWidgetAPI {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  sendMessage: (msg: string) => void
  configure: (config: Partial<LukaEmbedConfig>) => void
  destroy: () => void
}

declare global {
  interface Window {
    LukaWidget?: LukaWidgetAPI
    LukaWidgetConfig?: Partial<LukaEmbedConfig>
  }
}

export {}
