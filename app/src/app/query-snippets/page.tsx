// The route gate for a switched-off surface. A server component on purpose:
// features.query_snippets is instance config read on the server, so an instance
// with snippets off answers this URL with a 404 instead of shipping the page to
// the browser and hiding it there. Same posture as the AI gate, which the
// routes enforce server-side rather than trusting a hidden button.
//
// The page body lives beside this file because it is a client component (it
// holds dialog state and calls hooks), and a client component cannot read the
// config module, which touches the filesystem.
import { notFound } from 'next/navigation'
import { config } from '@/lib/config'
import { QuerySnippetsPage } from './query-snippets-page'

export default function Page() {
  if (!config.features.query_snippets) notFound()
  return <QuerySnippetsPage />
}
