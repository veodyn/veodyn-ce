'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CodeBlock } from '@/components/shared/code-block'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/components/config/config-provider'
import { PageContainer } from '@/components/layout/page-container'

// Static, config-driven docs: how to reach this instance's data API. The
// browser only ever calls same-origin /api/* proxy routes; backend keys stay
// server-side. The base URL is this instance's own origin, read after mount so
// the copyable examples carry real connection info (a placeholder covers the
// first paint before the origin resolves, avoiding a hydration mismatch).
const PLACEHOLDER_ORIGIN = 'https://your-instance.example'

export default function ConnectApisPage() {
  const { brand } = useConfig()
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    const readOrigin = () => setOrigin(window.location.origin)
    readOrigin()
  }, [])
  const base = origin || PLACEHOLDER_ORIGIN

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="APIs"
        description={`Reach the ${brand.name} data API from your own tools.`}
        action={
          brand.help_url ? (
            <Button variant="outline" render={<Link href={brand.help_url} />}>
              <BookOpen className="h-4 w-4" />
              Documentation
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Base URL</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              All API traffic goes through this instance&apos;s same-origin proxy.
            </p>
            <CodeBlock language="text" code={`${base}/api`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            {/* This used to document a session cookie and show
                `curl --cookie "session=<your-session>"`, which is not something
                the product will give you: there is nowhere to obtain that
                cookie. The personal API key is the credential that exists, the
                proxy already prefers a caller-supplied `Authorization` header
                over everything else, and the MCP page next door was already
                sending people to the same place for it. */}
            <p className="text-sm text-muted-foreground">
              Requests authenticate with your personal API key, sent as an{' '}
              <code className="font-mono text-xs">Authorization</code> header. Your key is on your{' '}
              <Link
                href="/profile"
                className="underline underline-offset-4 hover:text-foreground"
              >
                profile page
              </Link>
              . It reaches only the data your own account can.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Backend credentials never leave the server. The browser only ever calls same-origin
              routes under /api, which forward to the backends with the instance&apos;s server-side
              keys.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Example request</CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock
              language="bash"
              code={`curl -H "Authorization: Key <your-api-key>" \\\n  ${base}/api/node/queries`}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
