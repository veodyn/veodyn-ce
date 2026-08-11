'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { DataSourceLogo } from '@/components/data-sources/data-source-logo'
import { schemaFields, invalidJsonMessage } from '@/components/forms/schema-fields'
import { DynamicForm, useDynamicFormState } from '@/components/forms/dynamic-form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { useDataSourceTypes, useCreateDataSource } from '@/hooks/use-data-sources'
import { PageContainer } from '@/components/layout/page-container'

export default function NewDataSourcePage() {
  const router = useRouter()
  const { data: types } = useDataSourceTypes()
  const createDataSource = useCreateDataSource()
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const form = useDynamicFormState()
  const nameId = useId()
  const searchId = useId()

  const selectedTypeSchema = types?.find((t) => t.type === selectedType)
  const fields = schemaFields(selectedTypeSchema?.configuration_schema)

  const filteredTypes = (types ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = async () => {
    if (!selectedType || !name.trim()) return

    // A shape error in a JSON field (default_devices, say) is already shown
    // inline by DynamicForm as the user types; this is where it actually
    // blocks a save rather than only being visible while it is ignored.
    const invalidJson = invalidJsonMessage(fields, form.values)
    if (invalidJson) {
      setError(invalidJson)
      return
    }

    const ds = await createDataSource.mutateAsync({
      name: name.trim(),
      type: selectedType,
      syntax: selectedTypeSchema?.configuration_schema ? 'sql' : 'json',
      paused: 0,
      pause_reason: null,
      options: form.values,
      groups: { '2': false },
      view_only: false,
    })
    router.push(`/data-sources/${ds.id}`)
  }

  // `narrow`, matching step two, even though a card grid would otherwise take
  // the full width: this is one flow, and picking a type used to snap the column
  // from full-bleed to 768px on the very next click. The grid drops to two
  // tracks here, which is fine for a type picker.
  if (!selectedType) {
    return (
      <PageContainer width="narrow">
        <PageHeader title="New Data Source" description="Select the type of data source you want to create" />
        {/* The placeholder alone is not an accessible name: it disappears the
            moment someone types, and screen readers do not reliably announce
            it. A visually-hidden label keeps the name around, matching the
            pattern list-toolbar.tsx already uses for its own search box. */}
        <Label htmlFor={searchId} className="sr-only">
          Search data source types
        </Label>
        <InputGroup className="mb-4 max-w-md">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            id={searchId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search data source types..."
          />
        </InputGroup>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredTypes.map((t) => (
            <Button
              key={t.type}
              type="button"
              variant="ghost"
              onClick={() => setSelectedType(t.type)}
              className="h-auto w-full rounded-xl p-0 hover:bg-transparent active:translate-y-0 dark:hover:bg-transparent"
            >
              <Card className="w-full flex-row items-center gap-3 px-4 transition-colors hover:ring-primary/50">
                <DataSourceLogo type={t.type} className="h-8 w-8 object-contain" fallbackClassName="h-8 w-8 text-primary" />
                <span className="font-medium">{t.name}</span>
              </Card>
            </Button>
          ))}
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="narrow">
      <PageHeader title={`New ${selectedTypeSchema?.name ?? ''} Data Source`} />
      <Card className="p-6">
        <div>
          <Label htmlFor={nameId} className="mb-1 block">Name</Label>
          <Input id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Data source name" />
        </div>
        <DynamicForm fields={fields} values={form.values} onChange={form.onChange} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setSelectedType(null)}>Back</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || createDataSource.isPending}>Create</Button>
        </div>
      </Card>
    </PageContainer>
  )
}
