import { useRef, useState } from 'react'
import { Loader2, Paperclip, Trash2, Upload } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { MICRO } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { useToast } from '#/lib/hooks/useToast'
import {
  useExpenseAttachments, useAttachFiles, useDeleteAttachment,
  type ExpenseAttachment,
} from '#/lib/hooks/usePfis'
import { uploadExpenseFile, type ExpenseUploadedFile } from '#/lib/hooks/useCloudinaryUpload'
import { AttachmentViewer, type ViewableAttachment } from '#/components/AttachmentViewer'

/** What the attach endpoint stores for one uploaded file. */
export type PendingFile = ExpenseUploadedFile

const readableSize = (bytes: number) => {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let u = 0
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u += 1 }
  return `${n < 10 && u > 0 ? n.toFixed(1) : Math.round(n)} ${units[u]}`
}

/**
 * The file picker.
 *
 * No type or size filter anywhere — deliberately. A receipt is whatever the
 * vendor handed over, and refusing a file at upload time just means it never
 * gets attached at all. (Cloudinary applies its own per-file ceiling; a file
 * over it fails there and says so.)
 */
export function FileButton({
  busy, onFiles, label = 'Attach files',
}: {
  busy: boolean
  onFiles: (files: FileList) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input} type="file" multiple className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          // Cleared so re-picking the same file still fires a change.
          e.target.value = ''
        }}
      />
      <Button
        type="button" variant="outline" size="sm" disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Upload data-icon="inline-start" />}
        {busy ? 'Uploading…' : label}
      </Button>
    </>
  )
}

/**
 * The wide drop target the request form uses.
 *
 * A small "Attach files" button tucked beside a heading reads as optional,
 * and the paperwork is the part of a request that most often arrives missing
 * — an approver cannot verify a payment against a description. A target the
 * width of the form, that also accepts a dragged file, says the opposite.
 *
 * Same no-filter rule as FileButton: a receipt is whatever the vendor handed
 * over, and refusing it here means it never gets attached at all.
 */
export function FileDropZone({
  busy, onFiles, hint,
}: {
  busy: boolean
  onFiles: (files: FileList) => void
  hint?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <>
      <input
        ref={input} type="file" multiple className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files)
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors duration-200',
          over
            ? 'border-accent bg-accent/10'
            : 'border-foreground/20 hover:border-accent/50 hover:bg-muted/40',
          busy && 'opacity-60',
        )}
      >
        {busy ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <Upload className={cn('size-6', over ? 'text-accent' : 'text-muted-foreground')} />
        )}
        <span className="text-sm font-semibold">
          {busy ? 'Uploading…' : 'Upload invoice or document'}
        </span>
        <span className="text-xs text-muted-foreground">
          {hint ?? 'Drag a file here, or click to browse. PDFs, photos and scans all work.'}
        </span>
      </button>
    </>
  )
}

export function FileRow({
  name, size, href, contentType, onRemove, removing, onView,
}: {
  name: string
  size: number
  href?: string
  contentType?: string | null
  onRemove?: () => void
  removing?: boolean
  /** Opens the file in the in-app viewer. Falls back to a link without it. */
  onView?: (file: { name: string; url: string; contentType?: string | null }) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-foreground/15 px-2.5 py-1.5">
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
      {href && onView ? (
        // A button, not a link: the file opens in the dialog rather than
        // sending the person out of the dashboard to a bare storage URL.
        <button
          type="button"
          onClick={() => onView({ name, url: href, contentType })}
          className="min-w-0 flex-1 truncate text-left text-sm underline-offset-2 outline-none hover:underline focus-visible:underline"
        >
          {name}
        </button>
      ) : href ? (
        <a
          href={href} target="_blank" rel="noreferrer"
          className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
        >
          {name}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{readableSize(size)}</span>
      {onRemove && (
        <Button
          variant="ghost" size="icon-sm" title="Remove" disabled={removing} onClick={onRemove}
        >
          {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
          <span className="sr-only">Remove</span>
        </Button>
      )}
    </div>
  )
}

/**
 * Attachments on a request that already exists — the drawer, and the edit form.
 * Files register the moment they finish uploading.
 */
export function ExpenseAttachments({
  expenseId, canEdit = true, dropZone = false,
}: {
  expenseId: number
  canEdit?: boolean
  /** The request form wants the wide target; the review drawer keeps the button. */
  dropZone?: boolean
}) {
  const { data: files, isLoading } = useExpenseAttachments(expenseId)
  const attach = useAttachFiles()
  const remove = useDeleteAttachment()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<ViewableAttachment | null>(null)

  const onFiles = async (list: FileList) => {
    setBusy(true)
    try {
      const uploaded = await Promise.all([...list].map(uploadExpenseFile))
      await attach.mutateAsync({ id: expenseId, files: uploaded })
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {!dropZone && (
        <div className="flex items-center justify-between gap-2">
          <p className={cn(MICRO, 'text-muted-foreground')}>
            Attachments{files?.length ? ` (${files.length})` : ''}
          </p>
          {canEdit && <FileButton busy={busy} onFiles={onFiles} />}
        </div>
      )}

      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : files?.length ? (
        <div className="space-y-1.5">
          {files.map((f: ExpenseAttachment) => (
            <FileRow
              key={f.id}
              name={f.file_name || 'Document'}
              size={f.size_bytes}
              href={f.storage_key}
              contentType={f.content_type}
              onView={setViewing}
              removing={remove.isPending}
              onRemove={
                canEdit
                  ? () => remove.mutate({ attachmentId: f.id, expenseId })
                  : undefined
              }
            />
          ))}
        </div>
      ) : !dropZone ? (
        <p className="text-sm text-muted-foreground/70">
          Nothing attached. Invoices, teller slips, anything supporting the request.
        </p>
      ) : null}

      {dropZone && canEdit && (
        <FileDropZone
          busy={busy}
          onFiles={onFiles}
          hint={
            files?.length
              ? 'Drag another file here, or click to browse.'
              : undefined
          }
        />
      )}

      <AttachmentViewer
        attachment={viewing}
        open={viewing !== null}
        onOpenChange={(o) => { if (!o) setViewing(null) }}
      />
    </div>
  )
}

/**
 * Attachments on a request that does not exist yet.
 *
 * A new request has no id to register against, so files upload immediately and
 * are held here; the form registers them once the request is created. Uploading
 * up front rather than on submit means a slow connection fails at the moment
 * the file is chosen, not after the person has finished typing.
 */
export function PendingAttachments({
  files, onChange,
}: {
  files: PendingFile[]
  onChange: (next: PendingFile[]) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<ViewableAttachment | null>(null)

  const onFiles = async (list: FileList) => {
    setBusy(true)
    try {
      const uploaded = await Promise.all([...list].map(uploadExpenseFile))
      onChange([...files, ...uploaded])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f) => (
            <FileRow
              key={f.publicId}
              name={f.fileName}
              size={f.sizeBytes}
              href={f.url}
              contentType={f.contentType}
              onView={setViewing}
              onRemove={() => onChange(files.filter((x) => x.publicId !== f.publicId))}
            />
          ))}
        </div>
      )}
      <FileDropZone
        busy={busy}
        onFiles={onFiles}
        hint={files.length ? 'Drag another file here, or click to browse.' : undefined}
      />

      <AttachmentViewer
        attachment={viewing}
        open={viewing !== null}
        onOpenChange={(o) => { if (!o) setViewing(null) }}
      />
    </div>
  )
}
