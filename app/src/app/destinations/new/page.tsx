'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { DestinationIcon } from '@/components/destinations/destination-icon'
import { configOptions, missingRequiredMessage } from '@/components/destinations/destination-config'
import { schemaFields } from '@/components/forms/schema-fields'
import { DynamicForm, useDynamicFormState } from '@/components/forms/dynamic-form'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDestinationTypes, useCreateDestination } from '@/hooks/use-destinations'
import { PageContainer } from '@/components/layout/page-container'

export default function NewDestinationPage() {
  const router = useRouter()
  const toast = useToast()
  const { data: types } = useDestinationTypes()
  const createDestination = useCreateDestination()
  const nameId = useId()
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const form = useDynamicFormState()

  const typeSchema = types?.find((t) => t.type === selectedType)
  const fields = schemaFields(typeSchema?.configuration_schema)

  // Values belong to the schema they were typed into. Picking Slack, filling
  // it, going back and picking PagerDuty used to carry the Slack webhook URL
  // into a form that has no such field, and send it.
  const selectType = (type: string) => {
    if (type !== selectedType) {
      form.reset()
      setError(null)
    }
    setSelectedType(type)
  }

  const handleCreate = async () => {
    if (!selectedType || !name.trim()) return
    const options = configOptions(fields, form.values)
    const incomplete = missingRequiredMessage(fields, options)
    if (incomplete) {
      setError(incomplete)
      toast.error(incomplete)
      return
    }
    try {
      await createDestination.mutateAsync({ name: name.trim(), type: selectedType, options })
    } catch (err) {
      // Every value stays on screen. A refused create used to reject the
      // promise, skip the navigation and say nothing at all, so the page just
      // sat there looking like the button had not been pressed.
      const message = err instanceof Error ? err.message : 'Could not create the destination.'
      setError(message)
      toast.error(message)
      return
    }
    router.push('/destinations')
  }

  // Both steps share one container so the header and the card do not jump
  // width between picking a type and configuring it.
  return (
    <PageContainer width="narrow">
      {selectedType === null ? (
        <>
          <PageHeader
            title="New Alert Destination"
            description="Pick where a triggered alert should send its notification."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(types ?? []).map((t) => (
              <Button
                key={t.type}
                type="button"
                variant="ghost"
                onClick={() => selectType(t.type)}
                className="h-auto w-full rounded-xl p-0 hover:bg-transparent active:translate-y-0 dark:hover:bg-transparent"
              >
                <Card className="w-full flex-row items-center gap-3 px-4 transition-colors hover:ring-primary/50">
                  <DestinationIcon type={t.type} className="h-6 w-6 text-primary" />
                  <span className="font-medium">{t.name}</span>
                </Card>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <>
          <PageHeader title={`New ${typeSchema?.name ?? ''} Destination`} />
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
                placeholder="Destination name"
              />
            </div>
            <DynamicForm fields={fields} values={form.values} onChange={form.onChange} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSelectedType(null)}>
                Back
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || createDestination.isPending}>
                Create
              </Button>
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  )
}
