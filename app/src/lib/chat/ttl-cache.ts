export interface TtlCache<K, V> {
  get: (key: K) => V | undefined
  set: (key: K, value: V, ttlMs?: number) => void
  delete: (key: K) => void
}

export function ttlCache<K, V>(ttlMs: number, maxEntries: number): TtlCache<K, V> {
  const entries = new Map<K, { value: V; expires: number }>()
  return {
    get(key) {
      const hit = entries.get(key)
      if (!hit) return undefined
      if (hit.expires <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value, ttl = ttlMs) {
      entries.delete(key)
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next()
        if (!oldest.done) entries.delete(oldest.value)
      }
      entries.set(key, { value, expires: Date.now() + ttl })
    },
    delete(key) {
      entries.delete(key)
    },
  }
}
