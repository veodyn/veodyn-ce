'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CodeBlock } from '@/components/shared/code-block'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/components/config/config-provider'
import { USE_REAL_API } from '@/services/redash/config'
import { PageContainer } from '@/components/layout/page-container'

// Static, config-driven docs: how to connect an MCP-compatible client to this
// instance. The endpoint is this instance's own origin, read after mount so the
// copyable client config carries real connection info (a placeholder covers the
// first paint before the origin resolves, avoiding a hydration mismatch).
const PLACEHOLDER_ORIGIN = 'https://your-instance.example'

export default function ConnectMcpPage() {
  const { brand } = useConfig()
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    const readOrigin = () => setOrigin(window.location.origin)
    readOrigin()
  }, [])
  const base = origin || PLACEHOLDER_ORIGIN

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        [brand.name.toLowerCase()]: {
          url: `${base}/mcp`,
          transport: 'http',
          headers: { Authorization: 'Key <your-veodyn-api-key>' },
        },
      },
    },
    null,
    2
  )

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="MCP"
        description={`Connect an MCP-compatible client to ${brand.name}.`}
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
            <CardTitle>What is MCP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {/* One template literal, not interpolated JSX text. This rendered
                  "query Veodyndata directly": a JSX text node that follows an
                  expression container loses its leading space, so `{brand.name}
                  data` closed up however the line was wrapped, and a {' '} in
                  front of the name did not help because the space being dropped
                  was the one after it. Not greppable either, since the bad
                  string is composed at render time and appears in no file. A
                  single string has no JSX whitespace rules to get wrong, and
                  the apostrophe needs no entity inside one. */}
              {`The Model Context Protocol lets an assistant client (such as Claude) query ${brand.name} data directly. Point your client at this instance's MCP endpoint and authenticate with your personal API key. The endpoint is read-only: it lists and runs saved queries and reads dashboards, and it can reach only the data your own account can.`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Endpoint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeBlock language="text" code={`${base}/mcp`} />
            {/* Said here, where the URL is copied, rather than discovered when
                a client fails to connect. The endpoint reads this instance's
                analytics backend, so with none configured it answers 503. */}
            {!USE_REAL_API && (
              <p className="text-sm text-muted-foreground" role="status">
                This instance has no analytics backend configured, so the endpoint answers 503 and
                no client can connect to it yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Example client config</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeBlock language="json" code={clientConfig} />
            <p className="text-sm text-muted-foreground">
              Your API key is on your{' '}
              <Link href="/profile" className="underline underline-offset-4 hover:text-foreground">
                profile page
              </Link>
              . It carries your permissions, so treat it like a password.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
