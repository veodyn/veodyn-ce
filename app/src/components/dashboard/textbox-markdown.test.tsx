// What a dashboard text box renders, and what it refuses to.
//
// The renderer these replace built an HTML string from a few regexes and
// handed it to dangerouslySetInnerHTML, with no escaping anywhere, in two
// separate copies. A text box is authored by one person and read by everyone
// with access to the dashboard, so that was a stored-XSS surface.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextboxMarkdown } from './textbox-markdown'
import { TextboxDialog } from './textbox-dialog'
import { TextboxWidget } from './textbox-widget'

describe('TextboxMarkdown', () => {
  it('renders a heading as a heading', () => {
    render(<TextboxMarkdown text="## Text box header" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Text box header' })).toBeInTheDocument()
  })

  it('leaves a hash with no space as the prose it is', () => {
    render(<TextboxMarkdown text="##Text box header" />)

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('##Text box header')).toBeInTheDocument()
  })

  it('renders bold, italic and a list', () => {
    const { container } = render(
      <TextboxMarkdown text={'Some **bold** and *italic*.\n\n- one\n- two'} />
    )

    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelector('em')).toHaveTextContent('italic')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('never turns author text into markup', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const { container } = render(<TextboxMarkdown text={attack} />)

    // The literal characters are on the page; no element was created from them.
    expect(container.textContent).toContain(attack)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('refuses a javascript: link, keeping it as text', () => {
    const { container } = render(<TextboxMarkdown text="[click](javascript:alert(1))" />)

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[click](javascript:alert(1))')
  })

  it('renders an ordinary link, opened away from the dashboard', () => {
    render(<TextboxMarkdown text="[docs](https://example.com/runbook)" />)

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/runbook')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})

describe('the preview and the saved widget agree', () => {
  const source = '# Heading\n\nSome **bold** text.\n\n- a\n- b'

  it('renders the same markup in the dialog preview as on the dashboard', async () => {
    const preview = render(
      <TextboxDialog open onClose={() => {}} initialText={source} onSave={() => {}} />
    )
    const previewHtml = (await screen.findByTestId('textbox-markdown')).innerHTML
    preview.unmount()

    render(<TextboxWidget text={source} />)
    const widgetHtml = screen.getByTestId('textbox-markdown').innerHTML

    // Identical, because both mount the same component. The two used to hold
    // their own copies of the regexes, so the preview could show something the
    // dashboard never rendered.
    expect(widgetHtml).toBe(previewHtml)
  })
})

describe('TextboxDialog heading hint', () => {
  it('explains the missing space rather than leaving the author guessing', async () => {
    const user = userEvent.setup()
    render(<TextboxDialog open onClose={() => {}} onSave={() => {}} />)

    await user.type(screen.getByLabelText('Markdown'), '##Text box header')

    expect(screen.getByLabelText('Markdown')).toHaveAccessibleDescription(/needs a space/i)
  })

  it('says nothing once the heading is well formed', async () => {
    const user = userEvent.setup()
    render(<TextboxDialog open onClose={() => {}} onSave={() => {}} />)

    await user.type(screen.getByLabelText('Markdown'), '## Text box header')

    expect(screen.queryByText(/needs a space/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Text box header' })).toBeInTheDocument()
  })
})
