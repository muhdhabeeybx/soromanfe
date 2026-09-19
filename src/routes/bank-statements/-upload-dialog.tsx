import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Settings2, Loader2, AlertCircle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  useStatementMapping, useSaveStatementMapping, useUploadStatement,
} from '#/lib/hooks/useBankStatements'
import {
  readGrid, parseRows, formatPlainDay,
  type Grid, type ColumnMapping, type DateOrder,
} from '#/lib/bank-statement-parser'

const NONE = -1

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean; hint?: string }[] = [
  { key: 'dateColumn', label: 'Date', required: true },
  { key: 'creditColumn', label: 'Credit', hint: 'If credits and debits are separate columns' },
  { key: 'amountColumn', label: 'Amount', hint: 'If one signed column holds both' },
  { key: 'depositorColumn', label: 'Depositor' },
  { key: 'referenceColumn', label: 'Reference', hint: 'The bank’s own id — this is what stops a double import' },
  { key: 'narrationColumn', label: 'Narration' },
]

const BLANK: ColumnMapping = {
  headerRow: 0, dateColumn: 0, amountColumn: null, creditColumn: null,
  depositorColumn: null, referenceColumn: null, narrationColumn: null,
}

/**
 * Uploading a statement, and setting up the format it is read with.
 *
 * This used to be the whole page, with the bank chosen from a dropdown inside
 * it. The account now comes from where you opened it — a bank's card, or that
 * bank's own page — so the one thing that must never be wrong about an upload
 * cannot be picked by mistake from a list of twenty-eight.
 *
 * `mode` decides what opens: the full upload flow, or the format editor alone.
 * A format can be corrected without a file to hand, which matters because a
 * mis-mapped reference column is usually diagnosed from the upload history
 * rather than from a spreadsheet somebody still has open.
 *
 * MOUNT THIS ONLY WHILE IT IS OPEN — `{open && <UploadStatementDialog … />}`.
 * Everything about a file belongs to that file: the grid, the preview, the
 * date-order override. Unmounting is what clears them, so a dialog kept
 * mounted across closes would open showing a preview of a statement that has
 * already been imported, with an Import button still under it.
 */
export function UploadStatementDialog({
  open, onOpenChange, bankAccountId, bankLabel, mode = 'upload',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: number | string
  bankLabel: string
  mode?: 'upload' | 'format'
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [filename, setFilename] = useState('')
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [editingFormat, setEditingFormat] = useState(mode === 'format')
  /**
   * An override for a file the evidence cannot settle. Per upload, not saved:
   * the next statement is a different file and may be exported differently,
   * and a sticky setting would silently apply this decision to it.
   */
  const [dateOrder, setDateOrder] = useState<DateOrder | undefined>(undefined)
  const [draft, setDraft] = useState<ColumnMapping>(BLANK)

  const { data: saved, isLoading: loadingMapping } = useStatementMapping(
    open ? bankAccountId : undefined,
  )
  const saveMapping = useSaveStatementMapping()
  const upload = useUploadStatement()

  /** The saved format, if this account has one. */
  const mapping: ColumnMapping | null = useMemo(() => {
    if (!saved) return null
    return {
      headerRow: saved.header_row ?? 0,
      dateColumn: saved.date_column,
      amountColumn: saved.amount_column,
      creditColumn: saved.credit_column,
      depositorColumn: saved.depositor_column,
      referenceColumn: saved.reference_column,
      narrationColumn: saved.narration_column,
    }
  }, [saved])

  // Opening the format editor starts from the format that is actually in
  // force, not from a blank one — an edit is a correction, not a re-entry.
  useEffect(() => {
    if (!open) return
    setEditingFormat(mode === 'format')
    if (mapping) setDraft(mapping)
  }, [open, mode, mapping])

  /**
   * Column selects read from the freshly uploaded file when there is one, and
   * fall back to the headers captured the last time this account's format was
   * saved — so the format can be edited without uploading a file first.
   * Rows migrated from the legacy system store sample_headers as
   * `{ keys: [...], legacy: {...} }` rather than a flat array — handle both.
   */
  const savedHeaders: string[] = Array.isArray(saved?.sample_headers)
    ? saved.sample_headers
    : (Array.isArray(saved?.sample_headers?.keys) ? saved.sample_headers.keys : [])
  const liveHeaders = grid?.[draft.headerRow] ?? []
  const headers = liveHeaders.length > 0 ? liveHeaders : savedHeaders
  const showFormatPanel = (grid && !mapping) || editingFormat
  const effectiveMapping = editingFormat ? draft : (mapping ?? draft)

  const preview = grid ? parseRows(grid, { ...effectiveMapping, dateOrder }) : null

  const handleFile = async (file: File) => {
    setReading(true); setReadError('')
    try {
      const g = await readGrid(file)
      setGrid(g)
      setFilename(file.name)
      if (!mapping) setDraft((d) => ({ ...d, headerRow: 0 }))
    } catch (err: any) {
      // readGrid throws on a file too large to import rather than truncating
      // it. That has to reach the screen — a silent truncation is the whole
      // reason it throws.
      setGrid(null); setFilename('')
      setReadError(err?.message || 'That file could not be read.')
    } finally {
      setReading(false)
    }
  }

  const handleUpload = async () => {
    if (!preview?.rows.length) return
    await upload.mutateAsync({ bankAccountId, filename, rows: preview.rows })
    onOpenChange(false)
  }

  const canSaveFormat = draft.amountColumn !== null || draft.creditColumn !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'format' ? 'Statement format' : 'Upload a statement'}
          </DialogTitle>
          <DialogDescription>{bankLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {loadingMapping && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking this account&rsquo;s format&hellip;
            </p>
          )}

          {mode === 'upload' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor="file">
                  Statement file
                </label>
                {mapping && !editingFormat && (
                  <Button variant="ghost" size="xs" onClick={() => { setDraft(mapping); setEditingFormat(true) }}>
                    <Settings2 data-icon="inline-start" />
                    Edit format
                  </Button>
                )}
              </div>
              <input
                ref={fileInput}
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none file:mr-3 file:h-6 file:rounded-md file:border-0 file:bg-muted file:px-2 file:text-xs file:font-normal disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
              />
            </div>
          )}

          {reading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the file&hellip;
            </p>
          )}

          {readError && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {readError}
            </p>
          )}

          {/* Format setup — for a first upload, or when explicitly editing. */}
          {showFormatPanel && (
            <div className="space-y-4 rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-start gap-2">
                <Settings2 className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-normal">
                    {mapping ? "Edit this account's format" : "Set up this account's format"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {mapping
                      ? 'Pick which columns to use for this account. Saving overwrites the current format for every future upload.'
                      : 'Tell us which row holds the headers and what each column means. Saved once, then reused for every future upload.'}
                  </p>
                </div>
              </div>

              {grid && (
                <div className="space-y-2">
                  <label className={cn(MICRO, 'block text-muted-foreground')}>Header row</label>
                  <NativeSelect
                    value={String(draft.headerRow)}
                    onChange={(e) => setDraft((d) => ({ ...d, headerRow: Number(e.target.value) }))}
                    className="sm:max-w-xs"
                  >
                    {grid.slice(0, 10).map((row, i) => (
                      <option key={i} value={i}>
                        Row {i + 1} — {row.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              {!grid && (
                <p className="text-xs text-muted-foreground/70">
                  Columns below are from the last uploaded file. Upload a new file instead if the
                  header row itself has moved.
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <label className={cn(MICRO, 'block text-muted-foreground')}>
                      {f.label}{f.required && <span className="text-destructive"> *</span>}
                    </label>
                    <NativeSelect
                      value={String((draft[f.key] as number | null) ?? NONE)}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setDraft((d) => ({ ...d, [f.key]: v === NONE ? null : v }))
                      }}
                    >
                      <option value={NONE}>Not present</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>{h?.trim() || `Column ${i + 1}`}</option>
                      ))}
                    </NativeSelect>
                    {f.hint && <p className="text-xs text-muted-foreground/70">{f.hint}</p>}
                  </div>
                ))}
              </div>

              {/*
                The reference is the only thing that stops a credit being
                imported twice — see the repository's dedup note. An account
                with no reference column falls back to a fingerprint that
                includes the date, and two exports that date the same credit
                differently will both get in. Worth saying at the point the
                choice is made rather than after the money is doubled.
              */}
              {draft.referenceColumn === null && (
                <p className="flex items-start gap-2 text-xs text-warning">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  No reference column. Duplicates can then only be caught when a row matches in
                  every field, so two exports that date the same credit differently will both
                  import. Set one if the file has one.
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={saveMapping.isPending || !canSaveFormat}
                  onClick={() =>
                    saveMapping.mutate(
                      { bankAccountId, mapping: draft, sampleHeaders: headers },
                      {
                        onSuccess: () => {
                          setEditingFormat(false)
                          if (mode === 'format') onOpenChange(false)
                        },
                      },
                    )
                  }
                >
                  {saveMapping.isPending && <Loader2 className="animate-spin" />}
                  Save format
                </Button>
                {editingFormat && mapping && (
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => {
                      setEditingFormat(false)
                      setDraft(mapping)
                      if (mode === 'format') onOpenChange(false)
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              {!canSaveFormat && (
                <p className="text-xs text-muted-foreground/70">
                  Choose either a credit column or a signed amount column.
                </p>
              )}
            </div>
          )}

          {/* What will be imported. */}
          {grid && preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={preview.rows.length ? 'accent' : 'warning'}>
                  {preview.rows.length} credit row{preview.rows.length === 1 ? '' : 's'}
                </StatusChip>
                <StatusChip tone="inert">{preview.skipped} skipped</StatusChip>
                {/*
                  Why they were skipped, not just how many.
                  "365 skipped" is a black box, and the one question anybody
                  asks of an import is why a line they can see in the file is
                  not in the system.
                */}
                {Object.entries(preview.skipSummary).map(([reason, n]) => (
                  <StatusChip key={reason} tone={reason === 'debit, not a credit' ? 'inert' : 'warning'}>
                    {n} {reason}
                  </StatusChip>
                ))}
                {/*
                  Which way round the dates were read, always said out loud.

                  09/01/2026 is 1 September to one bank and 9 January to
                  another, and nothing in the row decides it. Reading it the
                  wrong way is invisible — the date still looks like a date —
                  so the only safe version of this is to state the reading and
                  let somebody disagree with it.
                */}
                <StatusChip tone={preview.dateOrderDetected ? 'accent' : 'warning'}>
                  {preview.dateOrder === 'month-first' ? 'Month/day' : 'Day/month'}
                  {preview.dateOrderDetected ? ' — from the file' : ' — assumed'}
                </StatusChip>
                <span className="text-xs text-muted-foreground">
                  Debits, blanks, totals and repeated headers are skipped, not errors.
                </span>
              </div>

              {preview.rows.length > 0 && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Total in this file</span>{' '}
                  <span className="font-semibold">
                    ₦{preview.rows.reduce((s, r) => s + r.amount, 0).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}{formatPlainDay(preview.rows[0].txnDate)}
                    {' – '}{formatPlainDay(preview.rows[preview.rows.length - 1].txnDate)}
                  </span>
                </p>
              )}

              {/*
                An assumption gets a way to be corrected; a proven reading
                does not need one and offering it would invite somebody to
                override the evidence.
              */}
              {!preview.dateOrderDetected && preview.rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                  <AlertCircle className="size-3.5 shrink-0 text-warning" />
                  <span className="text-xs text-muted-foreground">
                    No date in this file is past the 12th, so it cannot say which half is the
                    day. Reading it as{' '}
                    <strong className="text-foreground">
                      {preview.dateOrder === 'month-first' ? 'month/day' : 'day/month'}
                    </strong>
                    {' — '}the first row is {formatPlainDay(preview.rows[0].txnDate)}.
                  </span>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setDateOrder(
                      preview.dateOrder === 'month-first' ? 'day-first' : 'month-first',
                    )}
                  >
                    Read as {preview.dateOrder === 'month-first' ? 'day/month' : 'month/day'}
                  </Button>
                </div>
              )}

              {/*
                The rows that were left out for a reason other than being a
                debit — those are the ones worth a person's eye, because a
                mis-mapped column and a genuinely blank cell look the same
                from a count.
              */}
              {preview.skipNotes.some((n) => n.reason !== 'debit, not a credit') && (
                <details className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">
                    Show the rows that were left out for another reason
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {preview.skipNotes
                      .filter((n) => n.reason !== 'debit, not a credit')
                      .slice(0, 40)
                      .map((n, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="text-foreground">Row {n.row}</span>
                          {' — '}{n.reason}
                          {n.value ? <span className="text-muted-foreground/70">{' · saw "'}{n.value}{'"'}</span> : null}
                        </li>
                      ))}
                  </ul>
                </details>
              )}

              {preview.rows.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-foreground/15">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Depositor</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.slice(0, 5).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatPlainDay(r.txnDate)}</TableCell>
                          <TableCell>{r.depositor || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{r.bankRef || '—'}</TableCell>
                          <TableCell className="text-right font-semibold">
                            ₦{r.amount.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={!mapping || editingFormat || !preview.rows.length || upload.isPending}
              >
                {upload.isPending && <Loader2 className="animate-spin" />}
                <Upload data-icon="inline-start" />
                Import {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'}
              </Button>

              {!mapping && (
                <p className="text-xs text-muted-foreground/70">
                  Save the format first — uploads are rejected until it exists.
                </p>
              )}
              {mapping && editingFormat && (
                <p className="text-xs text-muted-foreground/70">
                  Save or cancel the format change above before importing.
                </p>
              )}
              <p className="text-xs text-muted-foreground/70">
                Rows already on this account are skipped, not added again. A credit is identified
                by its bank reference, so re-uploading an overlapping period is safe.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
