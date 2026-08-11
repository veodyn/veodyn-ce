import type { Metadata } from 'next'

// Generic on purpose, exactly as the public report layout is. This page is
// meant to sit inside someone else's iframe, and every crawler and unfurler
// that touches the bare URL renders whatever is here, so the visualization
// name, the query behind it and the token itself all stay out. `robots` keeps
// an unlisted link out of search indexes, which is what unlisted means.
const TITLE = 'Shared visualization'
const DESCRIPTION = 'A visualization shared through an unlisted link.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'article' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
}

export default function PublicEmbedLayout({ children }: { children: React.ReactNode }) {
  return children
}
