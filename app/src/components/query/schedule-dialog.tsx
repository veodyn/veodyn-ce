'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ScheduleDialogProps {
  open: boolean
  onClose: () => void
  schedule: { interval: number | null; time: string | null; day_of_week: string | null; until: string | null } | null
  onSave: (schedule: { interval: number | null; time: string | null; day_of_week: string | null; until: string | null } | null) => void
}

const INTERVALS = [
  { label: 'Never', value: 0 },
  { label: 'Every minute', value: 60 },
  { label: 'Every 5 minutes', value: 300 },
  { label: 'Every 10 minutes', value: 600 },
  { label: 'Every 15 minutes', value: 900 },
  { label: 'Every 30 minutes', value: 1800 },
  { label: 'Every 1 hour', value: 3600 },
  { label: 'Every 2 hours', value: 7200 },
  { label: 'Every 3 hours', value: 10800 },
  { label: 'Every 6 hours', value: 21600 },
  { label: 'Every 12 hours', value: 43200 },
  { label: 'Every 24 hours', value: 86400 },
  { label: 'Every week', value: 604800 },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ScheduleDialog({ open, onClose, schedule, onSave }: ScheduleDialogProps) {
  const [interval, setInterval] = useState(schedule?.interval ?? 0)
  const [time, setTime] = useState(schedule?.time ?? '06:00')
  const [dayOfWeek, setDayOfWeek] = useState(schedule?.day_of_week ?? 'Monday')
  const [until, setUntil] = useState(schedule?.until ?? '')
  const intervalId = useId()
  const timeId = useId()
  const dayId = useId()
  const untilId = useId()

  const handleSave = () => {
    if (interval === 0) {
      onSave(null)
    } else {
      onSave({
        interval,
        time: interval >= 86400 ? time : null,
        day_of_week: interval >= 604800 ? dayOfWeek : null,
        until: until || null,
      })
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Schedule Query</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div>
            <Label htmlFor={intervalId} className="mb-1 block">Refresh Every</Label>
            <Select
              value={String(interval)}
              onValueChange={(v) => { if (v != null) setInterval(Number(v)) }}
            >
              <SelectTrigger id={intervalId} className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {interval >= 86400 && (
            <div>
              <Label htmlFor={timeId} className="mb-1 block">At Time</Label>
              <Input
                id={timeId}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9"
              />
            </div>
          )}
          {interval >= 604800 && (
            <div>
              <Label htmlFor={dayId} className="mb-1 block">On Day</Label>
              <Select value={dayOfWeek} onValueChange={(v) => setDayOfWeek(v ?? dayOfWeek)}>
                <SelectTrigger id={dayId} className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {interval > 0 && (
            <div>
              <Label htmlFor={untilId} className="mb-1 block">Until (optional)</Label>
              <Input
                id={untilId}
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="h-9"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
