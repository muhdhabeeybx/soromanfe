import { useMemo, useRef, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Upload, FileSpreadsheet, Settings2, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import {
  useStatementMapping, useSaveStatementMapping, useBankStatements,
  useUploadStatement, useDeleteStatement,
} from '#/lib/hooks/useBankStatements'
import { StatementUploads } from './-statement-uploads'
import {
  readGrid, parseRows, type Grid, type ColumnMapping,
} from '#/lib/bank-statement-parser'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/bank-statements/')({
  beforeLoad: () => routeGuard('/bank-statements'),
  component: BankStatementsPage,
})

const NONE = -1

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean; hint?: string }[] = [
  { key: 'dateColumn', label: 'Date', required: true },
  { key: 'creditColumn', label: 'Credit', hint: 'If credits and debits are separate columns' },
  { key: 'amountColumn', label: 'Amount', hint: 'If one signed column holds both' },
  { key: 'depositorColumn', label: 'Depositor' },
  { key: 'referenceColumn', label: 'Reference' },
  { key: 'narrationColumn', label: 'Narration' },
]

function BankStatementsPage() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [bankAccountId, setBankAccountId] = useState('')
  const [grid, setGrid] = useState<Grid | null>(null)
  const [filename, setFilename] = useState('')
  const [reading, setReading] = useState(false)
  const [editingFormat, setEditingFormat] = useState(false)
  const [draft, setDraft] = useState<ColumnMapping>({
    headerRow: 0, dateColumn: 0, amountColumn: null, creditColumn: null,
    depositorColumn: null, referenceColumn: null, narrationColumn: null,
  })

  const { data: banks = [], isLoading: loadingBanks } = useBankAccounts()

  const { data: saved } = useStatementMapping(bankAccountId || undefined)
  const { data: statements = [] } = useBankStatements(bankAccountId || undefined)
  const saveMapping = useSaveStatementMapping()
  const upload = useUploadStatement()
  const remove = useDeleteStatement()

  // The saved format, if this account has one.
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

  // Column selects read from the freshly uploaded file when there is one, and
  // fall back to the headers captured the last time this account's format was
  // saved — so the format can be edited without uploading a file first.
  // Rows migrated from the legacy system store sample_headers as
  // `{ keys: [...], legacy: {...} }` rather than a flat array — handle both.
  const savedHeaders: string[] = Array.isArray(saved?.sample_headers)
    ? saved.sample_headers
    : (Array.isArray(saved?.sample_headers?.keys) ? saved.sample_headers.keys : [])
  const liveHeaders = grid?.[draft.headerRow] ?? []
  const headers = liveHeaders.length > 0 ? liveHeaders : savedHeaders
  const showFormatPanel = (grid && !mapping) || editingFormat
  const effectiveMapping = editingFormat ? draft : (mapping ?? draft)
  const preview = grid ? parseRows(grid, effectiveMapping) : null

  const handleFile = async (file: File) => {
    setReading(true)
    try {
      const g = await readGrid(file)
      setGrid(g)
      setFilename(file.name)
      if (!mapping) setDraft((d) => ({ ...d, headerRow: 0 }))
    } finally {
      setReading(false)
    }
  }

  const handleEditFormat = () => {
    if (mapping) setDraft(mapping)
    setEditingFormat(true)
  }

  const handleCancelEditFormat = () => {
    setEditingFormat(false)
    if (mapping) setDraft(mapping)
  }

  const handleUpload = async () => {
    if (!preview?.rows.length) return
    await upload.mutateAsync({ bankAccountId, filename, rows: preview.rows })
    setGrid(null); setFilename('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const totals = useMemo(() => ({
    statements: statements.length,
    lines: statements.reduce((s, x) => s + (x.row_count || 0), 0),
    matched: statements.reduce((s, x) => s + (x.matched_count || 0), 0),
    duplicates: statements.reduce((s, x) => s + (x.duplicate_count || 0), 0),
  }), [statements])

  return (
    <div className="space-y-6">
      <PageHeader
      eyebrow="Finance"
      title="Bank statements"
      description="Upload statements so Finance can match deposits instead of retyping them."
      />

      <StatCardGrid count={4}>
                <StatCard icon={<FileSpreadsheet />} label="Statements" value={totals.statements} />
                <StatCard icon={<Upload />} label="Credit rows" value={totals.lines.toLocaleString()} />
                <StatCard icon={<CheckCircle2 />} label="Matched" value={totals.matched.toLocaleString()} />
                <StatCard
                tone={totals.duplicates > 0 ? 'amber' : 'green'}
                icon={<AlertCircle />} label="Duplicates skipped" value={totals.duplicates.toLocaleString()}
                />
                </StatCardGrid>
                <section className={PANEL}>
                <div className={PANEL_RAIL}>
                <span className={MICRO}>Upload a statement</span>
                <div className="flex items-center gap-2">
                {mapping && !editingFormat && (
                <>
                <StatusChip tone="accent" size="rail">Format saved</StatusChip>
                <Button variant="ghost" size="xs" onClick={handleEditFormat}>
                <Settings2 data-icon="inline-start" />
                Edit format
                </Button>
                </>
                )}
                {editingFormat && mapping && (
                <Button variant="ghost" size="xs" onClick={handleCancelEditFormat}>
                Cancel
                </Button>
                )}
                </div>
                </div>
                <div className={cn(PANEL_BODY, 'space-y-5')}>
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor="bank">
                Bank account
                </label>
                <NativeSelect
                id="bank"
                value={bankAccountId}
                onChange={(e) => {
                  setBankAccountId(e.target.value); setGrid(null); setEditingFormat(false)
                }}
                >
                <option value="">
                {loadingBanks ? 'Loading…' : 'Choose an account'}
                </option>
                {banks.map((b: any) => (
                <option key={b.id} value={b.id}>
                {b.bankName} — {b.accountName} — {b.accountNumber}
                </option>
                ))}
                </NativeSelect>
                </div>
                <div className="space-y-2">
                <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor="file">
                Statement file
                </label>
                <input
                ref={fileInput}
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={!bankAccountId}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none file:mr-3 file:h-6 file:rounded-md file:border-0 file:bg-muted file:px-2 file:text-xs file:font-normal disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
                />
                </div>
                </div>
                {!bankAccountId && (
                <p className="text-sm text-muted-foreground">
                Pick an account to begin. Each bank's format is set up once, then every later
                upload for that account parses automatically.
                </p>
                )}
                {reading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading the file…
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
                  : "Tell us which row holds the headers and what each column means. Saved once, then reused for every future upload."}
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
                <option key={i} value={i}>
                {h?.trim() || `Column ${i + 1}`}
                </option>
                ))}
                </NativeSelect>
                {f.hint && <p className="text-xs text-muted-foreground/70">{f.hint}</p>}
                </div>
                ))}
                </div>
                <div className="flex items-center gap-2">
                <Button
                size="sm"
                disabled={saveMapping.isPending || (draft.amountColumn === null && draft.creditColumn === null)}
                onClick={() =>
                saveMapping.mutate(
                { bankAccountId, mapping: draft, sampleHeaders: headers },
                { onSuccess: () => setEditingFormat(false) },
                )
                }
                >
                {saveMapping.isPending && <Loader2 className="animate-spin" />}
                Save format
                </Button>
                {editingFormat && mapping && (
                <Button variant="ghost" size="sm" onClick={handleCancelEditFormat}>
                Cancel
                </Button>
                )}
                </div>
                {draft.amountColumn === null && draft.creditColumn === null && (
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
                <span className="text-xs text-muted-foreground">
                Debits, blanks, totals and repeated headers are skipped, not errors.
                </span>
                </div>
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
                <TableCell>{format(new Date(r.txnDate), 'd MMM yyyy')}</TableCell>
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
                </div>
                )}
                </div>
                </section>
      <StatementUploads
        statements={statements}
        onDelete={(id) => remove.mutate(id)}
        deleting={remove.isPending}
      />
    </div>
  )
}

