'use client'

import { use, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { schemaFields, invalidJsonMessage } from '@/components/forms/schema-fields'
import { DynamicForm } from '@/components/forms/dynamic-form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { useDataSource, useDataSourceTypes, useUpdateDataSource, useDeleteDataSource, useTestConnection } from '@/hooks/use-data-sources'
import { PageContainer } from '@/components/layout/page-container'
import { DataSourcePause } from '@/components/data-sources/data-source-pause'
import type { MockDataSource, MockDataSourceType } from '@/lib/mock-data'

export default function DataSourceEditPage({ params }: { params: Promise<{ dataSourceId: string }> }) {
  const { dataSourceId } = use(params)
  const id = parseInt(dataSourceId, 10)
  const { data: ds, isPending: dsPending, isError: dsError } = useDataSource(id)
  const { data: types, isPending: typesPending, isError: typesError } = useDataSourceTypes()

  if (dsPending || typesPending) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard lines={4} />
      </PageContainer>
    )
  }

  // A failed read is not a missing data source: saying "not found" for a
  // backend that refused the request sends the reader looking for a deletion
  // that never happened.
  if (dsError || typesError || !types) {
    return (
      <PageContainer width="narrow">
        <NoData message="Unable to load this data source. It may have been deleted, or the request was refused." />
      </PageContainer>
    )
  }

  if (!ds) {
    return (
      <PageContainer width="narrow">
        <NoData message="Data source not found." />
      </PageContainer>
    )
  }

  // Keyed on the record, so moving between two data sources rebuilds the form
  // from the one now on screen rather than keeping the previous source's state.
  return <DataSourceEditForm key={ds.id} ds={ds} typeSchema={types.find((t) => t.type === ds.type)} />
}

/**
 * The form takes a loaded data source, never a possibly-loading one.
 *
 * Its state has to be seeded from `ds`, and `useState` only reads its argument
 * on the first render. When this lived in the page component above the loading
 * guard, that first render happened while the fetch was still in flight, so the
 * form initialised empty and never caught up: the name field went blank while
 * the heading beside it read the record directly, and every option field fell
 * back to its schema default (`http://127.0.0.1:8123`, user `default`) as
 * though that were the live configuration. Save wrote it. Mounting only once
 * the record exists is what makes the seeding correct.
 */
function DataSourceEditForm({ ds, typeSchema }: { ds: MockDataSource; typeSchema?: MockDataSourceType }) {
  const router = useRouter()
  const updateDataSource = useUpdateDataSource()
  const deleteDataSource = useDeleteDataSource()
  const testConnection = useTestConnection()
  const [values, setValues] = useState<Record<string, unknown>>(ds.options)
  const [name, setName] = useState(ds.name)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()

  const fields = schemaFields(typeSchema?.configuration_schema)

  const handleSave = () => {
    // Mirrors the inline check DynamicForm already shows as the field is
    // edited: this is what turns that into an actual block on save rather
    // than a message the user can click straight past.
    const invalidJson = invalidJsonMessage(fields, values)
    if (invalidJson) {
      setError(invalidJson)
      return
    }
    setError(null)
    updateDataSource.mutate({ id: ds.id, name, options: values })
  }

  return (
    <PageContainer width="narrow">
      <PageHeader title={ds.name} description={typeSchema?.name ?? ds.type} />
      <Card className="p-6">
        <div>
          <Label htmlFor={nameId} className="mb-1 block">Name</Label>
          <Input id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DynamicForm fields={fields} values={values} onChange={setValues} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2 pt-4">
          <Button onClick={handleSave} disabled={updateDataSource.isPending}>Save</Button>
          <Button variant="outline" onClick={() => testConnection.mutate(ds.id)} disabled={testConnection.isPending}>
            {testConnection.isPending ? 'Testing...' : 'Test Connection'}
          </Button>
          {testConnection.data && (
            <span className={`flex items-center gap-1.5 text-sm ${testConnection.data.ok ? 'text-status-fresh' : 'text-destructive'}`}>
              {testConnection.data.ok ? (
                <Check className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {testConnection.data.message}
            </span>
          )}
          <div className="flex-1" />
          <Button variant="destructive" onClick={async () => { await deleteDataSource.mutateAsync(ds.id); router.push('/data-sources') }}>Delete</Button>
        </div>
      </Card>

      {/* Its own card below the configuration form, because it is an operational
          switch rather than a setting: it takes effect immediately and has no
          part in the Save above. */}
      <div className="mt-4">
        <DataSourcePause id={ds.id} paused={ds.paused ?? 0} pauseReason={ds.pause_reason ?? null} />
      </div>
    </PageContainer>
  )
}
