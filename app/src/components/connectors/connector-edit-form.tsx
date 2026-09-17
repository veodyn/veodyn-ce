'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { editBody, editProblem, editsForConnector } from '@/components/connectors/connector-credentials'
import { CredentialEditor } from '@/components/connectors/credential-editor'
import { ConnectorHealthBadge, connectorHealthSentence } from '@/components/connectors/connector-health'
import { schemaFields } from '@/components/forms/schema-fields'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDeleteConnector, useUpdateConnector } from '@/hooks/use-connectors'
import { PageContainer } from '@/components/layout/page-container'
import type { Connector, ConnectorType } from '@/types/connector'

export function ConnectorEditForm({
  connector,
  connectorType,
}: {
  connector: Connector
  connectorType: ConnectorType | undefined
}) {
  const router = useRouter()
  const toast = useToast()
  const updateConnector = useUpdateConnector()
  const removeConnector = useDeleteConnector()
  const nameId = useId()
  const fields = schemaFields(connectorType?.credentialSchema)
  const clearable = connectorType?.credentialSchema?.clearable ?? []
  const [name, setName] = useState(connector.name)
  const [edits, setEdits] = useState(() => editsForConnector(fields, connector.configuredFields))
  const [error, setError] = useState<string | null>(null)

  const fail = (message: string) => {
    setError(message)
    toast.error(message)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      fail('Give this connector a name.')
      return
    }
    const problem = editProblem(fields, edits, connector.configuredFields)
    if (problem) {
      fail(problem)
      return
    }
    const { replace, clear } = editBody(fields, edits)
    try {
      await updateConnector.mutateAsync({
        connectorId: connector.connectorId,
        input: { name: name.trim(), replace, clear },
      })
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not save these credentials.')
      return
    }
    setError(null)
    setEdits(editsForConnector(fields, connector.configuredFields))
    toast.success(`Saved "${name.trim()}".`)
  }

  const handleRemove = async () => {
    try {
      await removeConnector.mutateAsync(connector.connectorId)
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not remove this connector.')
      return
    }
    router.push('/connectors')
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={connector.name}
        description={connectorType?.displayName ?? connector.connectorId}
        action={<ConnectorHealthBadge health={connector.health} />}
      />
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">{connectorHealthSentence(connector.health)}</p>
        <div>
          <Label htmlFor={nameId} className="mb-1 block">
            Name
          </Label>
          <Input id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Stored credentials are never read back. Say what should happen to each one: keep what this instance
          holds, replace it with a value that will be tested again, or clear it.
        </p>
        <CredentialEditor
          fields={fields}
          configuredFields={connector.configuredFields}
          clearable={clearable}
          edits={edits}
          onChange={setEdits}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-between gap-2 pt-2">
          <Button variant="outline" onClick={handleRemove} disabled={removeConnector.isPending}>
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateConnector.isPending}>
              Save
            </Button>
          </div>
        </div>
      </Card>
    </PageContainer>
  )
}
