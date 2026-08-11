'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { useConfig } from '@/components/config/config-provider'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
// Types are declared globally in src/types/luka-widget.d.ts

// Home page quick-action trigger + slide-over panel for the embeddable chat
// assistant. Fully config-driven: renders nothing when no assistant is
// configured (assistant.widget_url is null), since there is no widget to load.
export function AssistantWidget() {
  const { brand, assistant } = useConfig()
  const assistantTitle = assistant.title ?? brand.name

  const [chatOpen, setChatOpen] = useState(false)
  const [chatReady, setChatReady] = useState(false)
  // A state-backed ref (not a plain useRef) so the widget-loader effect below
  // reruns once the container actually attaches. SheetContent is portalled and
  // only renders its children after Base UI flips its internal `mounted` state
  // one render after `open`, so a plain ref would read null on the render where
  // `chatOpen` first becomes true and the effect would bail for good: the
  // dependency array wouldn't change again, so it would never retry.
  const [chatContainer, setChatContainer] = useState<HTMLDivElement | null>(null)
  const scriptLoadedRef = useRef(false)

  useEffect(() => {
    if (!chatOpen || scriptLoadedRef.current || !chatContainer || !assistant.widget_url) {
      return
    }
    const widgetUrl = assistant.widget_url
    const container = chatContainer

    const widgetConfig: Partial<typeof window.LukaWidgetConfig> = {
      integrationId: assistant.integration_id ?? undefined,
      mode: 'embedded' as const,
      theme: 'light',
      subAgent: assistant.sub_agent ?? undefined,
      apiUrl: widgetUrl,
      title: assistantTitle,
      defaultOpen: true,
      container,
    }
    window.LukaWidgetConfig = widgetConfig

    const script = document.createElement('script')
    script.src = `${widgetUrl}/luka_embed.js`
    script.async = true

    script.onload = () => {
      requestAnimationFrame(() => {
        const widgetEl = document.getElementById('luka-embed-container')
        if (widgetEl && !container.contains(widgetEl)) {
          container.appendChild(widgetEl)
        }
        setChatReady(true)
      })
    }

    script.onerror = () => {
      setChatReady(true)
    }

    document.head.appendChild(script)
    scriptLoadedRef.current = true

    return () => {
      const scripts = document.querySelectorAll('script[src*="luka_embed.js"]')
      scripts.forEach((s) => s.remove())
      if (window.LukaWidget) {
        window.LukaWidget.destroy()
      }
      delete window.LukaWidgetConfig
      delete window.LukaWidget
      scriptLoadedRef.current = false
      setChatReady(false)
    }
  }, [chatOpen, chatContainer, assistant.widget_url, assistant.integration_id, assistant.sub_agent, assistantTitle])

  if (!assistant.widget_url) {
    return null
  }

  return (
    <Sheet open={chatOpen} onOpenChange={setChatOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full items-start justify-start gap-4 rounded-lg border bg-card p-5 text-left font-normal hover:border-primary/50"
          />
        }
      >
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <MessageCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-medium text-sm">{assistantTitle}</h3>
          <p className="text-xs text-muted-foreground">Research {brand.name} data with AI</p>
        </div>
      </SheetTrigger>

      <SheetContent
        className="flex w-full flex-col p-0 data-[side=right]:sm:max-w-lg"
        // The assistant researches what is on the page beside it, so the page
        // stays legible. Dimmed, not blurred, same as the Create-with-AI chat.
        blurBackdrop={false}
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle className={SUBSECTION_HEADING}>{assistantTitle}</SheetTitle>
        </SheetHeader>
        <div ref={setChatContainer} className="relative flex-1 overflow-hidden">
          {!chatReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <svg
                  className="h-6 w-6 animate-spin text-muted-foreground"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-xs text-muted-foreground">Loading assistant...</span>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
