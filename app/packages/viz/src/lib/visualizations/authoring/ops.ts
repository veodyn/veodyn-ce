type Container = Record<string, unknown> | unknown[]

export type OptionOps = {
  set?: { path: string; value: unknown }[]
  unset?: string[]
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

class SkippedOperation extends Error {}

function segmentsOf(path: string): string[] | null {
  const segments = path.split('.')
  if (segments.some((segment) => segment === '' || FORBIDDEN_SEGMENTS.has(segment))) return null
  return segments
}

function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment)
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null
}

function cloneContainer(node: Container): Container {
  return Array.isArray(node) ? [...node] : { ...node }
}

function isEmptyContainer(value: unknown): boolean {
  if (!isContainer(value)) return false
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0
}

function write(node: Container, key: string, value: unknown): void {
  if (Array.isArray(node)) node[Number(key)] = value
  else node[key] = value
}

function remove(node: Container, key: string): void {
  if (Array.isArray(node)) node.splice(Number(key), 1)
  else delete node[key]
}

function readChild(node: Container, key: string): unknown {
  return Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined
}

function setAt(node: unknown, segments: string[], value: unknown): Container {
  const [head, ...rest] = segments
  const base: Container = isContainer(node) ? node : isIndex(head) ? [] : {}
  if (Array.isArray(base) && (!isIndex(head) || Number(head) > base.length)) throw new SkippedOperation()
  const copy = cloneContainer(base)
  write(copy, head, rest.length === 0 ? value : setAt(readChild(base, head), rest, value))
  return copy
}

function unsetAt(node: unknown, segments: string[]): unknown {
  if (!isContainer(node)) return node
  const [head, ...rest] = segments
  if (!Object.hasOwn(node, head)) return node
  const copy = cloneContainer(node)
  if (rest.length === 0) {
    remove(copy, head)
    return copy
  }
  const current = readChild(node, head)
  const child = unsetAt(current, rest)
  if (child === current) return node
  if (isEmptyContainer(child)) remove(copy, head)
  else write(copy, head, child)
  return copy
}

export function applyOptionOps(options: Record<string, unknown>, ops: OptionOps): Record<string, unknown> {
  let current: Record<string, unknown> = { ...options }
  for (const { path, value } of ops.set ?? []) {
    const segments = segmentsOf(path)
    if (!segments) continue
    try {
      current = setAt(current, segments, value) as Record<string, unknown>
    } catch (error) {
      if (!(error instanceof SkippedOperation)) throw error
    }
  }
  for (const path of ops.unset ?? []) {
    const segments = segmentsOf(path)
    if (!segments) continue
    current = unsetAt(current, segments) as Record<string, unknown>
  }
  return current
}
