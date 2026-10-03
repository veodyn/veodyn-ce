import type { ReactNode } from 'react'
import './host.css'
import '@veodyn/viz/styles.css'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
