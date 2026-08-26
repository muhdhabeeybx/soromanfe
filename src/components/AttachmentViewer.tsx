import { useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, AlertTriangle } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

/**
 * An attachment, shown where the person already is.
 *
 * Clicking a receipt used to open a new browser tab straight at the storage
 * URL. Two things went wrong with that: the tab left the dashboard behind for
 * a bare file, and for PDFs the storage host answers 401 — which the browser
 * renders as a login prompt, so an expense attachment appeared to be asking
 * staff to sign in to something.
 *
 * This keeps the file inside the app: images and PDFs render in the dialog,
 * anything the browser cannot show inline gets an honest download button
 * rather than a blank frame. Opening in a tab is still one click away for
 * anyone who wants it.
 */

export interface ViewableAttachment {
  name: string
  url: string
  /** MIME type where it was recorded — the extension answers when it wasn't. */
  contentType?: string | null
}

type Kind = 'image' | 'pdf' | 'other'

/**
 * What this file is, from its type if recorded and its extension if not.
 *
 * Attachments predating the contentType column carry an empty string, and a
 * receipt photographed on a phone can arrive with no type at all — so the
 * extension is not a fallback here so much as the other half of the answer.
 */
function attachmentKind(a: ViewableAttachment): Kind {
  const type = (a.contentType || '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf') return 'pdf'

  const ext = (a.name.split('.').pop() || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

export function AttachmentViewer({
  attachment, open, onOpenChange,
}: {
  attachment: ViewableAttachment | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  if (!attachment) return null
  const kind = attachmentKind(attachment)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset per open, so a second attachment doesn't inherit the first
        // one's failure or its finished spinner.
        if (next) { setFailed(false); setLoading(true) }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92svh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{attachment.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={attachment.url} target="_blank" rel="noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open in new tab
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              {/* `download` is advisory across origins — the storage host has
                  the final say — so this is offered as a link rather than
                  promised as a save. */}
              <a href={attachment.url} download={attachment.name}>
                <Download data-icon="inline-start" />
                Download
              </a>
            </Button>
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-[50svh] overflow-auto rounded-lg border border-foreground/15 bg-muted/30">
          {loading && kind !== 'other' && !failed && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {failed || kind === 'other' ? (
            <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3 p-8 text-center">
              {failed ? (
                <AlertTriangle className="size-8 text-warning" />
              ) : (
                <FileText className="size-8 text-muted-foreground" />
              )}
              <p className="text-sm font-semibold">
                {failed ? 'This file could not be displayed here' : 'No preview for this file type'}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {failed
                  ? 'The storage host refused to show it inline. Downloading it still works.'
                  : 'Spreadsheets and documents open in the app that owns them.'}
              </p>
              <Button size="sm" asChild>
                <a href={attachment.url} download={attachment.name}>
                  <Download data-icon="inline-start" />
                  Download {attachment.name.split('.').pop()?.toUpperCase()}
                </a>
              </Button>
            </div>
          ) : kind === 'image' ? (
            <img
              src={attachment.url}
              alt={attachment.name}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true) }}
              className={cn('mx-auto max-h-[70svh] w-auto object-contain', loading && 'opacity-0')}
            />
          ) : (
            <iframe
              src={attachment.url}
              title={attachment.name}
              onLoad={() => setLoading(false)}
              className="h-[70svh] w-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
