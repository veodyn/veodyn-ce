'use client'

import { BookOpen } from 'lucide-react'
import { useConfig } from '@/components/config/config-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { helpLinkHref } from '@/lib/chat/thread-help'
import type { HelpLinkView } from '@/lib/chat/thread-model'

function label(link: HelpLinkView): string {
  return link.sectionTitle ? `${link.pageTitle} › ${link.sectionTitle}` : link.pageTitle
}

export function HelpLinkCard({ links }: { links: HelpLinkView[] }) {
  const docsUrl = useConfig().brand.docs_url
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4" aria-hidden="true" />
          Documentation
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {links.map((link) => {
          const href = helpLinkHref(docsUrl, link.page, link.anchor)
          return (
            <div key={link.callId} className="flex min-w-0 flex-col">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="truncate text-sm hover:underline">
                  {label(link)}
                </a>
              ) : (
                <span className="truncate text-sm">{label(link)}</span>
              )}
              {link.reason ? <span className="text-xs text-muted-foreground">{link.reason}</span> : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
