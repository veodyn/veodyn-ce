import { ItemsTable, type Column } from '@/components/shared/items-table'
import type { DatasetColumn } from '@/types/catalog'

const columns: Column<DatasetColumn>[] = [
  {
    key: 'name',
    title: 'Name',
    render: (column) => <span className="font-mono">{column.name}</span>,
  },
  {
    key: 'type',
    title: 'Type',
    render: (column) => <span className="font-mono">{column.type}</span>,
  },
  {
    key: 'description',
    title: 'Description',
    render: (column) => (
      <span className="text-muted-foreground">{column.description ?? ''}</span>
    ),
  },
]

export function SchemaTable({ schema }: { schema: DatasetColumn[] }) {
  return <ItemsTable columns={columns} items={schema} rowKey={(column) => column.name} />
}
