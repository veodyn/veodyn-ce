/**
 * How one table cell draws itself. Redash's table lets a column say it is a
 * link, an image, a boolean and so on (`displayAs`); veodyn drew every column
 * as text, so a camera id could not link to its feed and a snapshot URL was a
 * string of characters.
 */
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { ResultCell } from './result-cell'

const ROW = { camera_id: 'C12', label: 'North gate', online: true, seen: 3 }

function renderCell(config: Record<string, unknown> | undefined, column = 'camera_id') {
  renderWithProviders(
    <table>
      <tbody>
        <tr>
          <ResultCell
            value={ROW[column as keyof typeof ROW]}
            row={ROW}
            columnType="string"
            config={config as never}
          />
        </tr>
      </tbody>
    </table>
  )
}

describe('a column with nothing configured', () => {
  it('draws the value as text', () => {
    renderCell(undefined)

    expect(screen.getByText('C12')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('a link column', () => {
  it('draws an anchor to the resolved url', () => {
    renderCell({ name: 'camera_id', displayAs: 'link', linkUrlTemplate: '/cameras/{{ @ }}' })

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/cameras/C12')
    expect(link).toHaveTextContent('/cameras/C12')
  })

  it('uses the text template for what the reader sees', () => {
    renderCell({
      name: 'camera_id',
      displayAs: 'link',
      linkUrlTemplate: '/cameras/{{ @ }}',
      linkTextTemplate: '{{ label }}',
    })

    expect(screen.getByRole('link')).toHaveTextContent('North gate')
  })

  // A column marked as a link but never given a template is not a link. Falling
  // back to text beats rendering an anchor that goes nowhere.
  it('falls back to text when no url template was set', () => {
    renderCell({ name: 'camera_id', displayAs: 'link' })

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('C12')).toBeInTheDocument()
  })
})

describe('an image column', () => {
  it('draws an image with an alt from the title template', () => {
    renderCell({
      name: 'camera_id',
      displayAs: 'image',
      imageUrlTemplate: '/snap/{{ @ }}.jpg',
      imageTitleTemplate: '{{ label }}',
    })

    const image = screen.getByRole('img', { name: 'North gate' })
    expect(image).toHaveAttribute('src', '/snap/C12.jpg')
  })

  it('falls back to text when no url template was set', () => {
    renderCell({ name: 'camera_id', displayAs: 'image' })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('C12')).toBeInTheDocument()
  })
})

describe('a boolean column', () => {
  it('says true or false rather than printing the raw value', () => {
    renderCell({ name: 'online', displayAs: 'boolean' }, 'online')

    expect(screen.getByText('true')).toBeInTheDocument()
  })
})
