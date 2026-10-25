import { parseDashboardText, type TextBlock, type TextInline } from '../lib/dashboard-text'

function isExternal(href: string): boolean {
  return !href.startsWith('/')
}

function Inline({ node }: { node: TextInline }) {
  switch (node.type) {
    case 'bold':
      return <strong>{node.value}</strong>
    case 'italic':
      return <em>{node.value}</em>
    case 'link':
      return isExternal(node.href) ? (
        <a href={node.href} target="_blank" rel="noopener noreferrer">
          {node.text}
        </a>
      ) : (
        <a href={node.href}>{node.text}</a>
      )
    case 'image':
      return <img src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" />
    case 'image-link':
      return (
        <a href={node.href} {...(isExternal(node.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          <img src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" />
        </a>
      )
    case 'text':
      return <>{node.value}</>
  }
}

function Inlines({ nodes }: { nodes: TextInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  )
}

function Block({ node }: { node: TextBlock }) {
  switch (node.type) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[node.level - 1]
      return (
        <Tag>
          <Inlines nodes={node.children} />
        </Tag>
      )
    }
    case 'list':
      return (
        <ul>
          {node.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ul>
      )
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={node.children} />
        </p>
      )
  }
}

export function DashboardText({ text, className }: { text: string; className?: string }) {
  return (
    <div data-veodyn-part="dashboard-text" className={className}>
      {parseDashboardText(text).map((node, index) => (
        <Block key={index} node={node} />
      ))}
    </div>
  )
}
