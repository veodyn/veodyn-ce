import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyStatus = 'idle' | 'copied' | 'failed'

const STATUS_RESET_MS = 2000

export function useCopyToClipboard() {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = useCallback(async (text: string) => {
    let ok = true
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      ok = false
    }
    if (!mounted.current) return ok
    if (timer.current) clearTimeout(timer.current)
    setStatus(ok ? 'copied' : 'failed')
    timer.current = setTimeout(() => setStatus('idle'), STATUS_RESET_MS)
    return ok
  }, [])

  return { status, copy }
}
