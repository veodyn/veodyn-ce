import { postcss } from './postcss.mjs'

const ROOT = '.veodyn'
const LAYER = 'veodyn'
const UNTOUCHED_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'font-face', 'property'])
const ROOT_HOSTS = new Set([':root', ':host'])
const HOST_OWNED = new Set(['html', 'body'])

function splitSelectors(selector) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of selector) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function scopeSelector(selector) {
  if (ROOT_HOSTS.has(selector)) return ROOT
  if (HOST_OWNED.has(selector)) return null
  if (selector === ROOT || selector.startsWith(`${ROOT}[`) || selector.startsWith(`${ROOT} `) || selector.startsWith(`${ROOT}:`)) return selector
  return `${ROOT} ${selector}`
}

function insideUntouchedAtRule(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && UNTOUCHED_AT_RULES.has(parent.name)) return true
  }
  return false
}

export const scopePlugin = () => ({
  postcssPlugin: 'veodyn-scope',
  OnceExit(root) {
    root.walkRules((rule) => {
      if (insideUntouchedAtRule(rule)) return
      const scoped = [...new Set(splitSelectors(rule.selector).map(scopeSelector).filter(Boolean))]
      if (scoped.length === 0) rule.remove()
      else rule.selector = scoped.join(', ')
    })
    root.walkDecls((decl) => {
      decl.important = false
    })
    const layer = postcss.atRule({ name: 'layer', params: LAYER })
    root.each((node) => {
      if (node.type === 'atrule' && UNTOUCHED_AT_RULES.has(node.name)) return
      layer.append(node.clone())
      node.remove()
    })
    root.append(layer)
  },
})
scopePlugin.postcss = true

export async function scopeCss(css) {
  const result = await postcss([scopePlugin()]).process(css, { from: undefined })
  return result.css
}
