'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { StaticGtfsRefControl } from './static-gtfs-ref'

const LABEL = 'Static GTFS reference'

export function StaticReferenceField({ control }: { control: StaticGtfsRefControl }) {
  const fieldId = useId()

  return (
    <div className="space-y-1">
      <Label htmlFor={fieldId} required>{LABEL}</Label>
      {control.entering ? (
        <Input
          id={fieldId}
          type="text"
          value={control.value}
          onChange={(e) => control.enter(e.target.value)}
          placeholder="the static feed this realtime feed extends"
          required
          aria-required="true"
        />
      ) : (
        <Select value={control.value} onValueChange={(v) => v && control.pick(v as string)} required>
          <SelectTrigger id={fieldId} className="w-full font-mono text-sm">
            <SelectValue placeholder="Pick the static feed this realtime feed extends" />
          </SelectTrigger>
          <SelectContent>
            {control.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-sm text-muted-foreground">
        This is an identity key: a feed resolves routes and stops by comparing it character for
        character, so a reference nothing else uses resolves nothing.
      </p>
      {control.entering
        ? control.options.length > 0 && (
            <Button type="button" variant="link" className="h-auto p-0" onClick={control.reset}>
              Pick a reference this organization already serves
            </Button>
          )
        : (
            <Button type="button" variant="link" className="h-auto p-0" onClick={control.enterNew}>
              Enter a different reference
            </Button>
          )}
    </div>
  )
}
