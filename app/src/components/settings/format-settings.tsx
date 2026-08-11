'use client'

// This tab used to offer four formats and no surface in the product read any of
// them. Date and time are now honoured wherever an absolute timestamp renders,
// through useFormats. Charts included: they went a round longer than the rest
// (an operator's axis still read 2026-07-25 while every table beside it read
// 07/25/26), and they now reshape the same patterns to the precision each axis
// is drawing at (chart-time-axis.ts, date-pattern.ts).
//
// Integer Format and Float Format are gone rather than wired. They are moment
// and numeral pattern strings that Redash applies inside its own result grid,
// which this app does not render through, so keeping the fields would have kept
// exactly the promise the finding was about.

import { useId, useState } from 'react'
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/use-org-settings'
import { useFormats } from '@/hooks/use-formats'
import { useToast } from '@/components/shared/toast-provider'
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from '@/lib/format-datetime'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const DATE_FORMATS = ['DD/MM/YY', 'MM/DD/YY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']

const TIME_FORMATS = [
  { value: 'HH:mm', label: '24h (HH:mm)' },
  { value: 'HH:mm:ss', label: '24h (HH:mm:ss)' },
  { value: 'hh:mm A', label: '12h (hh:mm AM/PM)' },
  { value: 'hh:mm:ss A', label: '12h (hh:mm:ss AM/PM)' },
]

export function FormatSettings() {
  const { data: orgSettings } = useOrgSettings()
  const updateSettings = useUpdateOrgSettings()
  const formats = useFormats()
  const toast = useToast()
  const dateFormatId = useId()
  const timeFormatId = useId()

  // Server values are the base; local edits overlay them until saved
  const [edits, setEdits] = useState<{ date_format?: string; time_format?: string }>({})
  const dateFormat = edits.date_format ?? (orgSettings?.date_format as string) ?? DEFAULT_DATE_FORMAT
  const timeFormat = edits.time_format ?? (orgSettings?.time_format as string) ?? DEFAULT_TIME_FORMAT

  const handleSave = () => {
    updateSettings.mutate(
      { date_format: dateFormat, time_format: timeFormat },
      {
        onSuccess: () => {
          setEdits({})
          toast.success('Settings saved')
        },
        onError: (err) => toast.error((err as Error).message || 'Save failed'),
      }
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className="text-lg font-medium">Display Formats</h3>
        <p className="text-sm text-muted-foreground">
          Applied wherever a date or a time is shown as a value, including chart
          axes, tooltips and KPI history. A chart shortens the pattern to the
          precision it is drawing at, so an axis stepping in hours shows the time
          and states the date once. Relative labels (&quot;4 months ago&quot;)
          keep their own form.
        </p>
        <div>
          <Label htmlFor={dateFormatId} className="mb-1 block">
            Date Format
          </Label>
          <Select
            value={dateFormat}
            onValueChange={(v) => setEdits((prev) => ({ ...prev, date_format: v ?? dateFormat }))}
          >
            <SelectTrigger className="w-full" id={dateFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={timeFormatId} className="mb-1 block">
            Time Format
          </Label>
          <Select
            value={timeFormat}
            onValueChange={(v) => setEdits((prev) => ({ ...prev, time_format: v ?? timeFormat }))}
            items={TIME_FORMATS}
          >
            <SelectTrigger className="w-full" id={timeFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Shows the saved formats, not the pending edit: what the rest of the
            app is rendering right now is the useful thing to see next to a
            control whose whole promise is that it changes that. */}
        <p className="text-sm text-muted-foreground" data-testid="format-preview">
          Dates currently read <span className="font-mono">{formats.dateTime(new Date())}</span>
        </p>
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
