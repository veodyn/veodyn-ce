'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Radio } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { credentialsToSend, missingCredentialMessage } from '@/components/connectors/connector-credentials'
import { ContentContractSummary } from '@/components/connectors/content-contract-summary'
import { schemaFields } from '@/components/forms/schema-fields'
import { DynamicForm, useDynamicFormState } from '@/components/forms/dynamic-form'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NoData } from '@/components/ui/no-data'
import { useConnectorTypes, useCreateConnector } from '@/hooks/use-connectors'
import { PageContainer } from '@/components/layout/page-container'

export default function NewConnectorPage() {
  const router = useRouter()
  const toast = useToast()
  const { data: types } = useConnectorTypes()
  const createConnector = useCreateConnector()
  const nameId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const form = useDynamicFormState()

  const connectorType = types?.find((t) => t.connectorId === selectedId)
  const fields = schemaFields(connectorType?.credentialSchema)

  const selectType = (connectorId: string) => {
    if (connectorId !== selectedId) {
      form.reset()
      setError(null)
    }
    setSelectedId(connectorId)
  }

  const handleCreate = async () => {
    if (!selectedId || !name.trim()) return
    const credentials = credentialsToSend(fields, form.values)
    const incomplete = missingCredentialMessage(fields, credentials)
    if (incomplete) {
      setError(incomplete)
      toast.error(incomplete)
      return
    }
    try {
      await createConnector.mutateAsync({ connectorId: selectedId, name: name.trim(), credentials })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save these credentials.'
      setError(message)
      toast.error(message)
      return
    }
    router.push('/connectors')
  }

  return (
    <PageContainer width="narrow">
      {selectedId === null || connectorType === undefined ? (
        <>
          <PageHeader
            title="New Connector"
            description="Pick the channel this agency's credentials belong to."
          />
          {(types ?? []).length === 0 ? (
            <NoData
              icon={<Radio className="h-8 w-8" />}
              message="This build installs no channel connectors, so there is nothing to configure yet."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(types ?? []).map((t) => (
                <Button
                  key={t.connectorId}
                  type="button"
                  variant="ghost"
                  onClick={() => selectType(t.connectorId)}
                  className="h-auto w-full rounded-xl p-0 hover:bg-transparent active:translate-y-0 dark:hover:bg-transparent"
                >
                  <Card className="h-full w-full flex-row items-center gap-3 px-4 transition-colors hover:ring-primary/50">
                    <Radio className="h-6 w-6 shrink-0 text-primary" />
                    <span className="line-clamp-2 min-w-0 flex-1 text-left font-medium whitespace-normal wrap-break-word">
                      {t.displayName}
                    </span>
                  </Card>
                </Button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <PageHeader title={`New ${connectorType.displayName} Connector`} />
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
                placeholder="Connector name"
              />
            </div>
            <DynamicForm fields={fields} values={form.values} onChange={form.onChange} />
            <ContentContractSummary connectorType={connectorType} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSelectedId(null)}>
                Back
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || createConnector.isPending}>
                Save and test
              </Button>
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  )
}
