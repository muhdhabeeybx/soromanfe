import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Loader2, AlertTriangle } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'

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
  /**
   * The probe result, tagged with the URL it belongs to.
   *
   * Tagged rather than reset, so switching attachments needs no synchronous
   * clear inside the effect — a result whose URL no longer matches simply
   * reads as "not known yet". The parent owns `open`, so there is no reliable
   * moment to reset on, and a second attachment used to wear the first one's
   * outcome.
   */
  const [probe, setProbe] = useState<{ url: string; status: number } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const url = attachment?.url ?? ''
  const setFailed = () => setFailedUrl(url)

  /**
   * Ask the file whether it can be shown, before trying to show it.
   *
   * A PDF the storage host refuses answers 401, and an <iframe> renders that
   * as a blank white box — the dialog opens and there is simply nothing in it,
   * with no way to tell a refusal from a slow load or an empty file. The host
   * sends `access-control-allow-origin: *` even on the refusal, so the status
   * is readable from here and the dialog can say what happened.
   *
   * Keyed on the URL rather than on `open`: the parent controls `open`, so
   * onOpenChange never fires with true and resetting there left a second
   * attachment wearing the first one's outcome.
   */
  useEffect(() => {
    if (!url || !open) return
    let cancelled = false
    fetch(url, { method: 'HEAD' })
      .then((res) => { if (!cancelled) setProbe({ url, status: res.status }) })
      // A blocked or offline preflight is not itself a failure — fall through
      // and let the browser try, which is still the better guess.
      .catch(() => { if (!cancelled) setProbe({ url, status: 200 }) })
    return () => { cancelled = true }
  }, [url, open])

  if (!attachment) return null
  const kind = attachmentKind(attachment)
  const status = probe?.url === url ? probe.status : null
  const failed = failedUrl === url
  const refused = status !== null && status >= 400
  const checking = status === null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          {checking ? (
            <div className="flex min-h-[50svh] items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : refused || failed || kind === 'other' ? (
            <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3 p-8 text-center">
              {refused || failed ? (
                <AlertTriangle className="size-8 text-warning" />
              ) : (
                <FileText className="size-8 text-muted-foreground" />
              )}
              <p className="text-sm font-semibold">
                {kind === 'other' && !refused && !failed
                  ? 'No preview for this file type'
                  : 'This file cannot be displayed'}
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                {/* The exact reason, because "could not be displayed" sends
                    somebody hunting through the app for a fault that is a
                    setting on the storage account. */}
                {status === 401 || status === 403
                  ? `The storage host refused it (${status}). PDFs are blocked until “Allow delivery of PDF and ZIP files” is enabled on the Cloudinary account — until then this file cannot be shown or downloaded from anywhere.`
                  : status === 404
                    ? 'The file is no longer at the address recorded for it.'
                    : refused
                      ? `The storage host answered ${status}.`
                      : kind === 'other'
                        ? 'Spreadsheets and documents open in the app that owns them.'
                        : 'The browser could not render it.'}
              </p>
              {!refused && (
                <Button size="sm" asChild>
                  <a href={attachment.url} download={attachment.name}>
                    <Download data-icon="inline-start" />
                    Download {attachment.name.split('.').pop()?.toUpperCase()}
                  </a>
                </Button>
              )}
            </div>
          ) : kind === 'image' ? (
            // Never hidden behind an opacity gate while "loading". A cached
            // image can finish before React attaches onLoad, the handler never
            // fires, and the picture stays invisible forever — which is
            // exactly what an attachment that popped open empty was doing.
            <img
              src={attachment.url}
              alt={attachment.name}
              onError={setFailed}
              className="mx-auto max-h-[70svh] w-auto object-contain"
            />
          ) : (
            <iframe
              src={attachment.url}
              title={attachment.name}
              className="h-[70svh] w-full bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
