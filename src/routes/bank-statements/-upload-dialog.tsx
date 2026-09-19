import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload, Settings2, Loader2, AlertCircle, FileSpreadsheet, X, ArrowLeft,
  CheckCircle2, ShieldCheck,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { MICRO } from '#/lib/panel'
import { formatCurrency } from '#/lib/format'
import { cn } from '#/lib/utils'
import {
  useStatementMapping, useSaveStatementMapping, useUploadStatement,
  usePreviewStatement, type StatementPreview, type PreviewRow,
} from '#/lib/hooks/useBankStatements'
import {
  readGrid, parseRows, formatPlainDay,
  type Grid, type ColumnMapping, type DateOrder, type ParsedRow,
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

const ACCEPTED = ['.xlsx', '.xls', '.csv']
const accepted = (name: string) => ACCEPTED.some((e) => name.toLowerCase().endsWith(e))

/** How a skipped row reads on screen. */
const SKIP_REASON: Record<string, { label: string; tone: 'inert' | 'warning' }> = {
  'on record': { label: 'Already uploaded', tone: 'inert' },
  'in this file': { label: 'Repeated in this file', tone: 'warning' },
  reference: { label: 'Reference already on this account', tone: 'warning' },
  'reference in this file': { label: 'Reference repeated in this file', tone: 'warning' },
}

/**
 * Uploading a statement, and setting up the format it is read with.
 *
 * ── Three stages, because money ────────────────────────────────────────────
 *
 *   choose   drop a file in, or pick one
 *   review   every payment that will be imported, and every one that will not
 *   confirm  the account and the total, restated, then import
 *
 * The review is not the local parse. The file is read here, then sent to the
 * server to be partitioned by the rule the import itself uses, and what comes
 * back is what will be stored. A preview that ran its own arithmetic would be
 * worse than no preview: somebody would sign off on it.
 *
 * The confirm stage exists because the one thing that must never be wrong
 * about an upload is which account received the money, and by that point the
 * file has been on screen long enough to stop being read.
 *
 * `mode` decides what opens: the full flow, or the format editor alone. A
 * format can be corrected without a file to hand, which matters because a
 * mis-mapped reference column is usually diagnosed from the upload history
 * rather than from a spreadsheet somebody still has open.
 *
 * MOUNT THIS ONLY WHILE IT IS OPEN — `{open && <UploadStatementDialog … />}`.
 * Everything about a file belongs to that file: the grid, the preflight, the
 * date-order override. Unmounting is what clears them, so a dialog kept
 * mounted across closes would open showing a file that has already been
 * imported, with an Import button still under it.
 */
export function UploadStatementDialog({
  open, onOpenChange, bankAccountId, bankLabel, accountName, mode = 'upload',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: number | string
  bankLabel: string
  /** The account's own name, restated at the point of confirming. */
  accountName?: string
  mode?: 'upload' | 'format'
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [filename, setFilename] = useState('')
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [editingFormat, setEditingFormat] = useState(mode === 'format')
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  /**
   * An override for a file the evidence cannot settle. Per upload, not saved:
   * the next statement is a different file and may be exported differently,
   * and a sticky setting would silently apply this decision to it.
   */
  const [dateOrder, setDateOrder] = useState<DateOrder | undefined>(undefined)
  const [draft, setDraft] = useState<ColumnMapping>(BLANK)
  /** What the server says will happen. Null until a file has been sent to it. */
  const [preflight, setPreflight] = useState<StatementPreview | null>(null)

  const { data: saved, isLoading: loadingMapping } = useStatementMapping(
    open ? bankAccountId : undefined,
  )
  const saveMapping = useSaveStatementMapping()
  const upload = useUploadStatement()
  const preview = usePreviewStatement()

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

  /** What the file itself contains, before the account's history is consulted. */
  const parsed = grid ? parseRows(grid, { ...effectiveMapping, dateOrder }) : null

  /**
   * Ask the server what these rows would do.
   *
   * Called at every point the rows themselves change — a new file, a corrected
   * format, a flipped date order — rather than from an effect, so there is
   * never a moment where a stale partition sits on screen beside fresh rows.
   */
  const runPreflight = async (rows: ParsedRow[], name: string) => {
    setPreflight(null)
    setConfirming(false)
    setAcknowledged(false)
    if (!rows.length) return
    try {
      setPreflight(await preview.mutateAsync({ bankAccountId, filename: name, rows }))
    } catch {
      // usePreviewStatement has already said so; leaving preflight null keeps
      // the Import button out of reach, which is the right failure here.
    }
  }

  const handleFile = async (file: File) => {
    if (!accepted(file.name)) {
      setReadError('That is not a spreadsheet. Drop an .xlsx, .xls or .csv export.')
      return
    }
    setReading(true); setReadError(''); setPreflight(null)
    setConfirming(false); setAcknowledged(false)
    try {
      const g = await readGrid(file)
      setGrid(g)
      setFilename(file.name)
      if (!mapping) {
        setDraft((d) => ({ ...d, headerRow: 0 }))
        return
      }
      await runPreflight(parseRows(g, { ...mapping, dateOrder: undefined }).rows, file.name)
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

  const clearFile = () => {
    setGrid(null); setFilename(''); setReadError(''); setPreflight(null)
    setDateOrder(undefined); setConfirming(false); setAcknowledged(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  const handleUpload = async () => {
    // The ORIGINAL rows go up, not the ones the preflight kept. The server
    // partitions again on the way in — that is what catches a credit another
    // desk imported while this file sat on screen — and it is also what makes
    // the upload's own duplicate count true.
    if (!parsed?.rows.length) return
    await upload.mutateAsync({ bankAccountId, filename, rows: parsed.rows })
    onOpenChange(false)
  }

  const canSaveFormat = draft.amountColumn !== null || draft.creditColumn !== null
  const importing = preflight?.counts.importing ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'format'
              ? 'Statement format'
              : confirming
                ? 'Confirm this import'
                : 'Upload a statement'}
          </DialogTitle>
          <DialogDescription>{bankLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {loadingMapping && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking this account&rsquo;s format&hellip;
            </p>
          )}

          {/* ── Stage: confirm ───────────────────────────────────────────── */}
          {confirming && preflight ? (
            <ConfirmStage
              preflight={preflight}
              filename={filename}
              bankLabel={bankLabel}
              accountName={accountName}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
              onBack={() => setConfirming(false)}
              onImport={handleUpload}
              importing={upload.isPending}
            />
          ) : (
            <>
              {/* ── Stage: choose ─────────────────────────────────────────── */}
              {mode === 'upload' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn(MICRO, 'block text-muted-foreground')}>
                      Statement file
                    </span>
                    {mapping && !editingFormat && (
                      <Button
                        variant="ghost" size="xs"
                        onClick={() => { setDraft(mapping); setEditingFormat(true) }}
                      >
                        <Settings2 data-icon="inline-start" />
                        Edit format
                      </Button>
                    )}
                  </div>

                  <input
                    ref={fileInput}
                    id="file"
                    type="file"
                    accept={ACCEPTED.join(',')}
                    className="sr-only"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />

                  {filename ? (
                    <div className="flex items-center gap-3 rounded-lg border border-foreground/15 px-4 py-3">
                      <FileSpreadsheet className="size-4 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {parsed
                            ? `${parsed.rows.length.toLocaleString()} credit row${parsed.rows.length === 1 ? '' : 's'} read from the file`
                            : 'Read'}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={clearFile}>
                        <X data-icon="inline-start" />
                        Choose another
                      </Button>
                    </div>
                  ) : (
                    /*
                      A drop target that is also a button. Dragging the file
                      out of the downloads folder is how this actually gets
                      done; the click path stays because a file picker is the
                      only route on a machine with no second window open.
                    */
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInput.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          fileInput.current?.click()
                        }
                      }}
                      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragging(false)
                        const f = e.dataTransfer.files?.[0]
                        if (f) handleFile(f)
                      }}
                      className={cn(
                        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-colors duration-250 ease-luxe',
                        'focus-visible:ring-2 focus-visible:ring-ring/50',
                        dragging
                          ? 'border-accent bg-accent/5'
                          : 'border-foreground/25 hover:border-accent/50 hover:bg-muted/40',
                      )}
                    >
                      <Upload className={cn('size-5', dragging ? 'text-accent' : 'text-muted-foreground')} />
                      <p className="text-sm font-medium">
                        {dragging ? 'Drop it here' : 'Drag a statement here, or click to choose one'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        .xlsx, .xls or .csv — the export as the bank gives it to you
                      </p>
                    </div>
                  )}
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
                    imported twice. An account with no reference column falls
                    back to a fingerprint that includes the date, and two
                    exports that date the same credit differently will both get
                    in. Worth saying at the point the choice is made rather
                    than after the money is doubled.
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
                              if (mode === 'format') { onOpenChange(false); return }
                              // The format decides what the rows ARE, so the
                              // partition has to be asked again.
                              if (grid) {
                                runPreflight(
                                  parseRows(grid, { ...draft, dateOrder }).rows,
                                  filename,
                                )
                              }
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

              {/* ── Stage: review ─────────────────────────────────────────── */}
              {parsed && !showFormatPanel && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Which way round the dates were read, always said out loud.

                      09/01/2026 is 1 September to one bank and 9 January to
                      another, and nothing in the row decides it. Reading it
                      the wrong way is invisible — the date still looks like a
                      date — so the only safe version of this is to state the
                      reading and let somebody disagree with it.
                    */}
                    <StatusChip tone={parsed.dateOrderDetected ? 'accent' : 'warning'}>
                      {parsed.dateOrder === 'month-first' ? 'Month/day' : 'Day/month'}
                      {parsed.dateOrderDetected ? ' — from the file' : ' — assumed'}
                    </StatusChip>
                    {/*
                      Why rows were left out of the file read, not just how
                      many. "365 skipped" is a black box, and the one question
                      anybody asks of an import is why a line they can see in
                      the file is not in the system.
                    */}
                    {Object.entries(parsed.skipSummary).map(([reason, n]) => (
                      <StatusChip key={reason} tone={reason === 'debit, not a credit' ? 'inert' : 'warning'}>
                        {n} {reason}
                      </StatusChip>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      Debits, blanks, totals and repeated headers are skipped, not errors.
                    </span>
                  </div>

                  {/*
                    An assumption gets a way to be corrected; a proven reading
                    does not need one and offering it would invite somebody to
                    override the evidence.
                  */}
                  {!parsed.dateOrderDetected && parsed.rows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                      <AlertCircle className="size-3.5 shrink-0 text-warning" />
                      <span className="text-xs text-muted-foreground">
                        No date in this file is past the 12th, so it cannot say which half is the
                        day. Reading it as{' '}
                        <strong className="text-foreground">
                          {parsed.dateOrder === 'month-first' ? 'month/day' : 'day/month'}
                        </strong>
                        {' — '}the first row is {formatPlainDay(parsed.rows[0].txnDate)}.
                      </span>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => {
                          const next: DateOrder =
                            parsed.dateOrder === 'month-first' ? 'day-first' : 'month-first'
                          setDateOrder(next)
                          if (grid) {
                            runPreflight(
                              parseRows(grid, { ...effectiveMapping, dateOrder: next }).rows,
                              filename,
                            )
                          }
                        }}
                      >
                        Read as {parsed.dateOrder === 'month-first' ? 'day/month' : 'month/day'}
                      </Button>
                    </div>
                  )}

                  {/*
                    The rows the parser left out for a reason other than being
                    a debit — those are the ones worth a person's eye, because
                    a mis-mapped column and a genuinely blank cell look the
                    same from a count.
                  */}
                  {parsed.skipNotes.some((n) => n.reason !== 'debit, not a credit') && (
                    <details className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-medium">
                        Show the rows that were left out of the file read
                      </summary>
                      <ul className="mt-2 space-y-0.5">
                        {parsed.skipNotes
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

                  {preview.isPending && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Checking these payments against what is already on this account&hellip;
                    </p>
                  )}

                  {preflight && <ReviewStage preflight={preflight} />}

                  {preflight && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button disabled={importing === 0} onClick={() => setConfirming(true)}>
                        Continue to confirm
                      </Button>
                      <Button variant="ghost" onClick={clearFile}>Choose another file</Button>
                      {importing === 0 && (
                        <span className="text-xs text-muted-foreground">
                          Nothing here is new, so there is nothing to import.
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Every payment that will be imported, and every one that will not.
 *
 * The whole list, not a sample of five. A sample answers "did the columns come
 * out right", which is a different and much smaller question than "is this the
 * money". Somebody is about to put these credits on an account; they get to
 * see all of them.
 */
function ReviewStage({ preflight }: { preflight: StatementPreview }) {
  const { rows, skipped, counts, total } = preflight
  const period = rows.length
    ? rows.map((r) => String(r.txnDate).slice(0, 10)).sort()
    : []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          tone="accent"
          label="Will be imported"
          value={`${counts.importing.toLocaleString()} payment${counts.importing === 1 ? '' : 's'}`}
          detail={formatCurrency(total)}
        />
        <Figure
          tone={counts.duplicates > 0 ? 'warning' : 'inert'}
          label="Already on this account"
          value={`${counts.duplicates.toLocaleString()} skipped`}
          detail={counts.repeatedReferences > 0
            ? `${counts.repeatedReferences.toLocaleString()} on a repeated reference`
            : 'No duplicates will be created'}
        />
        <Figure
          tone="inert"
          label="Period covered"
          value={period.length
            ? `${formatPlainDay(period[0])} – ${formatPlainDay(period[period.length - 1])}`
            : '—'}
          detail={`${counts.incoming.toLocaleString()} row${counts.incoming === 1 ? '' : 's'} read from the file`}
        />
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn(MICRO, 'text-muted-foreground')}>
              The {rows.length.toLocaleString()} payment{rows.length === 1 ? '' : 's'} to be imported
            </span>
            <span className="text-xs text-muted-foreground">Duplicates already removed</span>
          </div>
          {/*
            Capped in height, not in rows. Every payment is in the DOM and
            reachable by scrolling — and by the browser's own find, which is
            how somebody checks that one particular credit is in here.
          */}
          <div className="max-h-[22rem] overflow-auto rounded-lg border border-foreground/15">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Depositor</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.bankRef}-${i}`}>
                    <TableCell className="text-right text-xs text-muted-foreground/70">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatPlainDay(r.txnDate)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="block max-w-[22rem] break-words">{r.depositor || '—'}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-normal break-all">{r.bankRef || '—'}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      ₦{Number(r.amount).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/*
        The rows that will NOT be imported, with the reason on each. Saying
        only "412 skipped" is the silence that let an account shed a month of
        credits without anybody noticing.
      */}
      {skipped.length > 0 && (
        <details className="rounded-lg border border-foreground/15">
          <summary className="cursor-pointer px-4 py-2.5 text-sm">
            <span className="font-medium">{skipped.length.toLocaleString()}</span>
            {' '}payment{skipped.length === 1 ? '' : 's'} will not be imported — see why
          </summary>
          <div className="max-h-[18rem] overflow-auto border-t border-foreground/15">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Depositor</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skipped.map((r: PreviewRow, i) => {
                  const reason = SKIP_REASON[r.reason || ''] ?? {
                    label: r.reason || 'Already on record', tone: 'inert' as const,
                  }
                  return (
                    <TableRow key={`${r.bankRef}-skip-${i}`} className="bg-muted/20">
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatPlainDay(r.txnDate)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        <span className="block max-w-[18rem] break-words">{r.depositor || '—'}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-normal break-all text-muted-foreground">
                        {r.bankRef || '—'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-muted-foreground">
                        ₦{Number(r.amount).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={reason.tone}>{reason.label}</StatusChip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
    </div>
  )
}

/**
 * The last screen before the money lands.
 *
 * It restates the account, because by now the file has been on screen long
 * enough to stop being read, and the account is the one thing that must never
 * be wrong. The acknowledgement is deliberate friction: an Import button on
 * its own gets clicked, and this has no undo — once a line here is matched to
 * an order, the upload can no longer be deleted.
 */
function ConfirmStage({
  preflight, filename, bankLabel, accountName, acknowledged, onAcknowledge,
  onBack, onImport, importing,
}: {
  preflight: StatementPreview
  filename: string
  bankLabel: string
  accountName?: string
  acknowledged: boolean
  onAcknowledge: (v: boolean) => void
  onBack: () => void
  onImport: () => void
  importing: boolean
}) {
  const { rows, counts, total } = preflight
  const period = rows.map((r) => String(r.txnDate).slice(0, 10)).sort()

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">You are about to credit</p>
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(total)}</p>
              <p className="text-sm text-muted-foreground">
                across {counts.importing.toLocaleString()} payment
                {counts.importing === 1 ? '' : 's'}
                {period.length > 0 && (
                  <> dated {formatPlainDay(period[0])} – {formatPlainDay(period[period.length - 1])}</>
                )}
              </p>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className={cn(MICRO, 'text-muted-foreground')}>To the account</dt>
                <dd className="mt-0.5 font-medium uppercase">{accountName || bankLabel}</dd>
                {accountName && <dd className="text-xs text-muted-foreground">{bankLabel}</dd>}
              </div>
              <div className="min-w-0">
                <dt className={cn(MICRO, 'text-muted-foreground')}>From the file</dt>
                <dd className="mt-0.5 truncate font-medium" title={filename}>{filename || '—'}</dd>
                <dd className="text-xs text-muted-foreground">
                  {counts.duplicates > 0
                    ? `${counts.duplicates.toLocaleString()} duplicate${counts.duplicates === 1 ? '' : 's'} already removed`
                    : 'No duplicates found'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-foreground/15 px-4 py-3 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          I have checked these payments and the account they are going to.
          <span className="block text-xs text-muted-foreground">
            Once a payment here is matched to an order, this upload can no longer be deleted.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onImport} disabled={!acknowledged || importing}>
          {importing ? <Loader2 className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
          Import {counts.importing.toLocaleString()} payment
          {counts.importing === 1 ? '' : 's'} · {formatCurrency(total)}
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={importing}>
          <ArrowLeft data-icon="inline-start" />
          Back to the list
        </Button>
      </div>
    </div>
  )
}

function Figure({
  label, value, detail, tone,
}: {
  label: string
  value: string
  detail?: string
  tone: 'accent' | 'warning' | 'inert'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        tone === 'accent' && 'border-accent/30 bg-accent/5',
        tone === 'warning' && 'border-warning/30 bg-warning/5',
        tone === 'inert' && 'border-foreground/15',
      )}
    >
      <span className={cn(MICRO, 'block text-muted-foreground')}>{label}</span>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
