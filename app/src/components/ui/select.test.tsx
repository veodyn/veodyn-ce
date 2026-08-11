import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function renderSelect() {
  return render(
    <Select defaultOpen>
      <SelectTrigger aria-label="Object type">
        <SelectValue placeholder="Any type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="queries">Queries</SelectItem>
        <SelectItem value="dashboards">Dashboards</SelectItem>
      </SelectContent>
    </Select>
  )
}

describe('Select', () => {
  it('renders its trigger with the placeholder when closed', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Object type">
          <SelectValue placeholder="Any type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="queries">Queries</SelectItem>
          <SelectItem value="dashboards">Dashboards</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(screen.getByLabelText('Object type')).toBeInTheDocument()
    expect(screen.getByText('Any type')).toBeInTheDocument()
    expect(screen.queryByText('Queries')).not.toBeInTheDocument()
  })

  it('renders its options when open', () => {
    renderSelect()
    expect(screen.getByText('Queries')).toBeInTheDocument()
    expect(screen.getByText('Dashboards')).toBeInTheDocument()
  })

  it('updates the trigger value and closes the popup when an option is selected', async () => {
    renderSelect()
    const trigger = screen.getByLabelText('Object type')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getByText('Dashboards'))

    // The option's label, not its value: base-ui prints the raw value in the
    // trigger unless the root is told the pairs, which is why this read
    // "dashboards" before, and "TABLE" and "BOXPLOT" elsewhere in the app.
    expect(trigger).toHaveTextContent('Dashboards')
    expect(trigger).not.toHaveTextContent('Any type')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Queries')).not.toBeVisible()
  })

  // The pairs come off the <SelectItem> children, so they are still found when
  // the items sit inside a group rather than directly under the content.
  it('resolves the label of an option nested in a group', async () => {
    render(
      <Select>
        <SelectTrigger aria-label="Object type">
          <SelectValue placeholder="Any type" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Library</SelectLabel>
            <SelectItem value="dashboards">Dashboards</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    await userEvent.click(screen.getByLabelText('Object type'))
    await userEvent.click(await screen.findByRole('option', { name: 'Dashboards' }))

    expect(screen.getByLabelText('Object type')).toHaveTextContent('Dashboards')
  })

  // An explicit `items` still wins: a caller whose options are not SelectItem
  // children knows the pairs better than a walk of the subtree does.
  it('prefers an explicitly passed items map', () => {
    render(
      <Select value="dashboards" items={{ dashboards: 'Every dashboard' }}>
        <SelectTrigger aria-label="Object type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dashboards">Dashboards</SelectItem>
        </SelectContent>
      </Select>
    )

    expect(screen.getByLabelText('Object type')).toHaveTextContent('Every dashboard')
  })
})
