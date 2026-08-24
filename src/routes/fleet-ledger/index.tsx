import { useMemo, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import { Plus, Pencil, Trash2, Search, Loader2, FileSpreadsheet, FileText } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageEmpty } from '#/components/PageEmpty'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  useFleetTrucks, useFleetLedger, useSaveLedgerEntry, useDeleteLedgerEntry,
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, ALL_CATEGORIES,
  type LedgerEntry,
} from '#/lib/hooks/useFleet'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { routeGuard } from '#/lib/route-guard'
import { useToast } from '#/lib/hooks/useToast'
import { exportFleetLedgerExcel, exportFleetLedgerPdf } from './-fleet-ledger-export'

export const Route = createFileRoute('/fleet-ledger/')({
  beforeLoad: () => routeGuard('/fleet-ledger'),
  component: FleetLedgerPage,
})

const ALL = 'all'
const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString('en-NG')}`

function FleetLedgerPage() {
  const [preset, setPreset] = useState<DatePreset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [truckFilter, setTruckFilter] = useState(ALL)
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [editing, setEditing] = useState<LedgerEntry | null | 'new'>(null)
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null)

  const { data: trucks = [] } = useFleetTrucks()
  const { data: entries = [], isLoading } = useFleetLedger()
  const removeEntry = useDeleteLedgerEntry()

  const range = useMemo(
    () => resolveRange(preset, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    }),
    [preset, from, to],
  )

  // Historical values outside the hard-coded lists stay filterable.
  const categories = useMemo(() => {
    const seen = entries.map((e) => e.category).filter(Boolean)
    return [...new Set([...ALL_CATEGORIES, ...seen])].sort()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (range && !isWithinInterval(new Date(e.entry_date), { start: range.from, end: range.to })) return false
      if (truckFilter !== ALL && String(e.truck_id) !== truckFilter) return false
      if (typeFilter !== ALL && e.entry_type !== typeFilter) return false
      if (categoryFilter !== ALL && e.category !== categoryFilter) return false
      if (!q) return true
      return [e.description, e.category, e.truck_plate, e.truck_driver, e.entered_by]
        .some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [entries, range, truckFilter, typeFilter, categoryFilter, search])

  // ── Export ─────────────────────────────────────────────────────────
  // Whatever is on screen, filters and all — a report that silently covers a
  // different set than the page it was run from is worse than none.
  const toast = useToast()
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const runExport = async (kind: 'excel' | 'pdf') => {
    if (!filtered.length) return
    const filters = {
      periodLabel: preset === 'custom'
        ? `${from || '?'} – ${to || '?'}`
        : DATE_PRESETS.find((p) => p.value === preset)?.label ?? 'All time',
      truck: truckFilter === ALL
        ? 'All trucks'
        : (trucks.find((t) => String(t.id) === truckFilter)?.plateNumber ?? truckFilter),
      type: typeFilter,
      category: categoryFilter,
      search,
    }
    setExporting(kind)
    try {
      if (kind === 'excel') await exportFleetLedgerExcel(filtered, filters)
      else await exportFleetLedgerPdf(filtered, filters)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
      eyebrow="Transport"
      title="Trucks Ledger"
      description="Add, edit, and manage all truck expense and income entries."
      actions={
        <>
          <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => runExport('excel')}
            disabled={!filtered.length || exporting !== null}
          >
          {exporting === 'excel'
            ? <Loader2 data-icon="inline-start" className="animate-spin" />
            : <FileSpreadsheet data-icon="inline-start" />}
          Export Excel
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => runExport('pdf')}
            disabled={!filtered.length || exporting !== null}
          >
          {exporting === 'pdf'
            ? <Loader2 data-icon="inline-start" className="animate-spin" />
            : <FileText data-icon="inline-start" />}
          Export PDF
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
          <Plus data-icon="inline-start" />
          Add entry
          </Button>
          </div>
        </>
      }
    />

      {/* Summary cards are deliberately not rendered here — the Directory is
          where the per-truck money view lives. */}

      <section className={PANEL}>
        <div className={PANEL_RAIL}><span className={MICRO}>Filters</span></div>
        <div className={cn(PANEL_BODY, 'space-y-4')}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, category, truck or driver…" className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value} type="button" onClick={() => setPreset(p.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  preset === p.value
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1.5">
              <Input type="date" value={from} aria-label="From"
                onChange={(e) => { setFrom(e.target.value); setPreset('custom') }}
                className="h-7 w-[9.5rem] text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={to} aria-label="To"
                onChange={(e) => { setTo(e.target.value); setPreset('custom') }}
                className="h-7 w-[9.5rem] text-xs" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NativeSelect value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}>
              <option value={ALL}>All trucks</option>
              {trucks.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.plateNumber}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value={ALL}>All types</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </NativeSelect>
            <NativeSelect value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value={ALL}>All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </div>
        </div>
      </section>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}</span>
        </div>
        {isLoading ? (
          <PageLoader message="Loading ledger…" />
        ) : filtered.length === 0 ? (
          <PageEmpty title="No entries yet" description="Add an expense or income entry to begin." />
        ) : (
          <div className="px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right text-destructive">Debit</TableHead>
                  <TableHead className="text-right text-accent">Credit</TableHead>
                  <TableHead>Entered By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      {format(new Date(e.entry_date), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell className="font-mono">{e.truck_plate}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{e.description || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{e.category}</TableCell>
                    {/* One entry occupies exactly one column — the split is the
                        whole point, since the model only has type and amount. */}
                    <TableCell className="text-right font-semibold text-destructive">
                      {e.entry_type === 'expense' ? naira(e.amount) : ''}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-accent">
                      {e.entry_type === 'income' ? naira(e.amount) : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.entered_by || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(e)}>
                          <Pencil /><span className="sr-only">Edit entry</span>
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(e)}>
                          <Trash2 /><span className="sr-only">Delete entry</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <EntryDialog
        entry={editing === 'new' ? null : editing}
        open={editing !== null}
        trucks={trucks}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title="Delete this entry?"
        description={deleting ? `${deleting.category} · ${naira(deleting.amount)} on ${deleting.truck_plate}` : ''}
        variant="destructive"
        confirmLabel="Delete"
        loading={removeEntry.isPending}
        onConfirm={async () => {
          if (deleting) await removeEntry.mutateAsync(deleting.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}

/** Handles both add and edit, keyed off whether an entry was passed. */
function EntryDialog({
  entry, open, trucks, onOpenChange,
}: {
  entry: LedgerEntry | null
  open: boolean
  trucks: any[]
  onOpenChange: (o: boolean) => void
}) {
  const save = useSaveLedgerEntry()
  const today = format(new Date(), 'yyyy-MM-dd')
  const known = entry ? ALL_CATEGORIES.includes(entry.category) : true

  const [form, setForm] = useState(() => ({
    truckId: entry ? String(entry.truck_id) : '',
    entryType: entry?.entry_type ?? 'expense',
    category: entry ? (known ? entry.category : 'Other') : '',
    customCategory: entry && !known ? entry.category : '',
    amount: entry ? String(Number(entry.amount)) : '',
    entryDate: entry ? entry.entry_date.slice(0, 10) : today,
    description: entry?.description ?? '',
  }))

  // Re-seed whenever a different entry is opened.
  const [seeded, setSeeded] = useState(entry?.id ?? 'new')
  const key = entry?.id ?? 'new'
  if (seeded !== key) {
    setSeeded(key)
    setForm({
      truckId: entry ? String(entry.truck_id) : '',
      entryType: entry?.entry_type ?? 'expense',
      category: entry ? (known ? entry.category : 'Other') : '',
      customCategory: entry && !known ? entry.category : '',
      amount: entry ? String(Number(entry.amount)) : '',
      entryDate: entry ? entry.entry_date.slice(0, 10) : today,
      description: entry?.description ?? '',
    })
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const list = form.entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const resolved = form.category === 'Other' ? form.customCategory.trim() : form.category
  const ready = form.truckId && resolved && Number(form.amount) > 0 && form.entryDate

  const submit = async () => {
    await save.mutateAsync({
      id: entry?.id,
      truckId: Number(form.truckId),
      data: {
        entryType: form.entryType,
        category: resolved,
        amount: Number(form.amount),
        entryDate: form.entryDate,
        description: form.description.trim(),
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit entry' : 'Add entry'}</DialogTitle>
          <DialogDescription>An expense debits the truck; income credits it.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Truck</label>
            <NativeSelect value={form.truckId} onChange={(e) => set('truckId', e.target.value)}>
              <option value="">Choose a truck…</option>
              {trucks.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.plateNumber} — {t.driverName}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Type</label>
            <NativeSelect
              value={form.entryType}
              onChange={(e) => setForm((f) => ({ ...f, entryType: e.target.value as any, category: '' }))}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Category</label>
            <NativeSelect value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Choose…</option>
              {list.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </div>

          {form.category === 'Other' && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className={cn(MICRO, 'block text-muted-foreground')}>Name the category</label>
              <Input value={form.customCategory} onChange={(e) => set('customCategory', e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Amount</label>
            <Input
              type="number" inputMode="decimal"
              value={form.amount} onChange={(e) => set('amount', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Date</label>
            <Input type="date" value={form.entryDate} onChange={(e) => set('entryDate', e.target.value)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Description</label>
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {entry ? 'Save changes' : 'Add entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
