'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TextboxMarkdown } from '@/components/dashboard/textbox-markdown'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { missingHeadingSpace } from '@/lib/dashboard-markdown'

interface TextboxDialogProps {
  open: boolean
  onClose: () => void
  initialText?: string
  onSave: (text: string) => void
}

export function TextboxDialog({ open, onClose, initialText = '', onSave }: TextboxDialogProps) {
  const [text, setText] = useState(initialText)
  const sourceId = useId()
  const previewId = useId()
  const hintId = useId()

  const handleSave = () => {
    onSave(text)
    onClose()
  }

  // "##Title" is not a heading in any markdown, so leaving it as prose is
  // correct. Correct and silent is still a dead end for the author, who typed
  // a heading and got none and has nothing to go on, so name the one thing
  // that is wrong instead of letting them conclude the preview is broken.
  const headingHint = missingHeadingSpace(text)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{initialText ? 'Edit Text Box' : 'Add Text Box'}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] gap-4 min-h-[300px] overflow-y-auto">
          <div className="flex-1 flex flex-col">
            <Label htmlFor={sourceId} className="text-xs mb-1 block">
              Markdown
            </Label>
            <Textarea
              id={sourceId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 resize-none font-mono"
              placeholder="# Title&#10;Some **bold** and *italic* text"
              aria-describedby={headingHint ? hintId : undefined}
            />
            {headingHint && (
              <p id={hintId} aria-live="polite" className="mt-1 text-xs text-muted-foreground">
                A heading needs a space after the hashes: <code>## Title</code>, not{' '}
                <code>##Title</code>.
              </p>
            )}
          </div>
          <div className="flex-1 flex flex-col">
            {/* Section heading over a role="region", not a form control: a
                htmlFor here would point at something that can never take
                focus, so this names the region directly rather than wearing
                <label> semantics it cannot back up. */}
            <div id={previewId} className="text-xs font-medium text-muted-foreground mb-1">
              Preview
            </div>
            {/* The widget's own renderer, so this preview cannot promise
                something the saved text box does not produce. */}
            <div
              role="region"
              aria-labelledby={previewId}
              className="flex-1 p-3 rounded-md border bg-card overflow-auto"
            >
              <TextboxMarkdown text={text} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
