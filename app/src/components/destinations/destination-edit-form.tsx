'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { DestinationIcon } from '@/components/destinations/destination-icon'
import { configOptions, missingRequiredMessage } from '@/components/destinations/destination-config'
import { schemaFields } from '@/components/forms/schema-fields'
import { DynamicForm } from '@/components/forms/dynamic-form'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateDestination } from '@/hooks/use-destinations'
import type { MockDestination, MockDestinationType } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'

/**
 * The edit form for one destination.
 *
 * It lives apart from the route so the route can render it only once the
 * destination has loaded, keyed by id. Seeding `useState` from a value that is
 * undefined on the first render (which is every first render, the destination
 * arrives from a query) left the form permanently blank, and Save then wrote
 * that blank name and an empty options object over the real ones.
 */
export function DestinationEditForm({
  destination,
  typeSchema,
}: {
  destination: MockDestination
  typeSchema: MockDestinationType | undefined
}) {
  const router = useRouter()
  const toast = useToast()
  const updateDestination = useUpdateDestination()
  const nameId = useId()
  const [name, setName] = useState(destination.name)
  const [values, setValues] = useState<Record<string, unknown>>(destination.options ?? {})
  const [error, setError] = useState<string | null>(null)

  const fields = schemaFields(typeSchema?.configuration_schema)

  const fail = (message: string) => {
    setError(message)
    toast.error(message)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      fail('Give the destination a name.')
      return
    }
    const options = configOptions(fields, values)
    const incomplete = missingRequiredMessage(fields, options)
    if (incomplete) {
      fail(incomplete)
      return
    }
    try {
      // `type` is not optional and not decoration: Redash reads req["type"]
      // before it touches the record, so an update without it is a KeyError
      // and nothing is saved. It is sent back unchanged; this form does not
      // offer changing a destination's type.
      //
      // `options` may carry Redash's `--------` placeholder for a secret,
      // which is correct to send verbatim: ConfigurationContainer.update()
      // maps that exact string back to the stored value, so the credential
      // survives. Anything that rewrites the placeholder would overwrite it.
      await updateDestination.mutateAsync({
        id: destination.id,
        name: name.trim(),
        type: destination.type,
        options,
      })
    } catch (err) {
      // A refused save used to be silent: mutate() swallowed the rejection and
      // the form still showed the edits as though they had been stored.
      fail(err instanceof Error ? err.message : 'Could not save the destination.')
      return
    }
    setError(null)
    toast.success(`Saved "${name.trim()}".`)
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={destination.name}
        description={typeSchema?.name ?? destination.type}
        action={<DestinationIcon type={destination.type} className="h-6 w-6 text-primary" />}
      />
      <Card className="p-6">
        <div>
          <Label htmlFor={nameId} className="mb-1 block">
            Name
          </Label>
          <Input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <DynamicForm fields={fields} values={values} onChange={setValues} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateDestination.isPending}>
            Save
          </Button>
        </div>
      </Card>
    </PageContainer>
  )
}
