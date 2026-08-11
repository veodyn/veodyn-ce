import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { SchemaTable } from './schema-table'
import type { DatasetColumn } from '@/types/catalog'

afterEach(() => resetStores())

const schema: DatasetColumn[] = [
  { name: 'observed_at', type: 'timestamp' },
  { name: 'vehicle_count', type: 'integer', description: 'Vehicles counted' },
]

describe('SchemaTable', () => {
  it('renders one row per column with the name and type in font-mono', () => {
    renderWithProviders(<SchemaTable schema={schema} />)

    expect(screen.getAllByRole('row')).toHaveLength(schema.length + 1) // + header row

    const observedAtName = screen.getByText('observed_at')
    expect(observedAtName).toHaveClass('font-mono')

    const timestampType = screen.getByText('timestamp')
    expect(timestampType).toHaveClass('font-mono')

    const vehicleCountName = screen.getByText('vehicle_count')
    expect(vehicleCountName).toHaveClass('font-mono')

    const integerType = screen.getByText('integer')
    expect(integerType).toHaveClass('font-mono')

    expect(screen.getByText('Vehicles counted')).toBeInTheDocument()
  })
})
