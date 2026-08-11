import { parseTextbox, type TextboxNode } from '@/lib/dashboard-markdown'
import type { RichInline } from '@/lib/richtext'

// One renderer for a text box, used by both the widget and the dialog preview.
// They used to hold separate copies of the same regexes, so the preview could
// promise a render the saved widget did not produce, and a fix to one silently
// left the other behind.
//
// Nothing here is an HTML string: the parser hands over nodes and these render
// as elements. That is what makes a text box safe to show to a whole
// organisation, since there is no point at which author text is interpreted as
// markup.

function Inline({ node }: { node: RichInline }) {
  switch (node.type) {
    case 'bold':
      return <strong>{node.value}</strong>
    case 'italic':
      return <em>{node.value}</em>
    case 'link':
      // The parser already refused anything isSafeLink rejects, so a link that
      // reaches here has a scheme worth opening. noreferrer because a dashboard
      // is an internal surface and its URL is not the destination's business.
      return (
        <a href={node.href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
          {node.text}
        </a>
      )
    case 'ref':
      // `{{...}}` is a report-narrative affordance: it names a query or KPI to
      // freeze a number from at snapshot time. A dashboard text box has no
      // snapshot and nothing to resolve against, so the token stays as the
      // literal text the author typed rather than rendering as a broken
      // reference to a feature this surface does not have.
      return <>{node.token}</>
    case 'text':
      return <>{node.value}</>
  }
}

function Inlines({ nodes }: { nodes: RichInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  )
}

function Block({ node }: { node: TextboxNode }) {
  switch (node.type) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3'] as const)[node.level - 1]
      return (
        <Tag className="font-display font-medium tracking-tight">
          <Inlines nodes={node.children} />
        </Tag>
      )
    }
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-5">
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

export function TextboxMarkdown({ text, className }: { text: string; className?: string }) {
  const nodes = parseTextbox(text)

  return (
    <div
      data-testid="textbox-markdown"
      className={
        className ??
        'space-y-2 text-sm leading-relaxed text-foreground [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm'
      }
    >
      {nodes.map((node, index) => (
        <Block key={index} node={node} />
      ))}
    </div>
  )
}
