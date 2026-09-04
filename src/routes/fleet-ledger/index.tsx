import { useMemo, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Plus, Pencil, Trash2, Search, Loader2, FileSpreadsheet, FileText,
  TrendingDown, TrendingUp, Truck, Wallet, Scale, Tags, Download, ChevronDown, Layers,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { PageLoader } from '#/components/PageLoader'
import { PageEmpty } from '#/components/PageEmpty'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { SummaryCards } from '#/components/SummaryCards'
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
import {
  byDate, computeTotals, groupByTruck, highlights, isExpense,
  type LedgerRow, type TruckGroup,
} from './-fleet-ledger-data'
import { exportFleetLedgerExcel, exportFleetLedgerPdf } from './-fleet-ledger-export'
import { BatchEntryDialog } from './-batch-entry-dialog'

export const Route = createFileRoute('/fleet-ledger/')({
  beforeLoad: () => routeGuard('/fleet-ledger'),
  component: FleetLedgerPage,
})

const ALL = 'all'
const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString('en-NG')}`
/** Money whose sign carries meaning — the one place red and green are allowed. */
const signedTone = (n: number) =>
  n > 0 ? 'text-accent' : n < 0 ? 'text-destructive' : 'text-muted-foreground'
const signedNaira = (n: number) => (n < 0 ? `(${naira(Math.abs(n))})` : naira(n))

/** Truck first, then date — see -fleet-ledger-data.ts for why. */
type Arrangement = 'truck' | 'date'

/**
 * How a truck block is set apart from the one above it.
 *
 * Three cues, none of them a font size. The block's own rows are stepped in
 * from the left, so the plate and its closing subtotal sit proud of the
 * entries they bracket; an accent rail runs down the block's left edge, which
 * is what makes the boundary visible at a glance while scrolling; and the two
 * summary rows are shaded, the opening one more strongly than the close.
 *
 * Everything in the table is text-sm. Hierarchy is carried by weight, colour
 * and indent — the summary rows used to be a size smaller than the entries
 * they totalled, which read as a footnote rather than as the block's answer.
 */
const ENTRY_INDENT = 'pl-7'
const SUMMARY_INDENT = 'pl-3'
/** Drawn on the first cell of every row, so it reads as one unbroken edge. */
const BLOCK_RAIL = '[&>tr>td:first-child]:border-l-2 [&>tr>td:first-child]:border-l-accent/30'

function FleetLedgerPage() {
  const [preset, setPreset] = useState<DatePreset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [truckFilter, setTruckFilter] = useState(ALL)
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [arrangement, setArrangement] = useState<Arrangement>('truck')
  const [editing, setEditing] = useState<LedgerEntry | null | 'new'>(null)
  const [batching, setBatching] = useState(false)
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
  const categoryOptions = useMemo(() => {
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

  // The same arrangement and the same arithmetic the exports use — one module
  // answers for both, so the sheet can never group or total differently from
  // the page it was run from.
  const totals = useMemo(() => computeTotals(filtered), [filtered])
  const { groups, categories, worstTruck, topExpense } = useMemo(() => highlights(filtered), [filtered])
  const flatRows = useMemo(() => {
    // Date-only view still carries each truck's running balance, worked out
    // per truck rather than down the mixed list — a cumulative figure across
    // several vehicles would be a number about nothing.
    const balances = new Map<number, number>()
    for (const g of groupByTruck(filtered)) {
      for (const r of g.rows) balances.set(r.id, r.runningBalance)
    }
    return [...filtered].sort(byDate).reverse()
      .map((e) => ({ ...e, runningBalance: balances.get(e.id) ?? 0 }) as LedgerRow)
  }, [filtered])

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense').slice(0, 6),
    [categories],
  )

  const cards = useMemo(() => [
    {
      title: 'Total spend', value: naira(totals.debits), icon: <TrendingDown />, tone: 'red' as const,
      description: `${totals.entries} entr${totals.entries === 1 ? 'y' : 'ies'} across ${totals.trucks} truck${totals.trucks === 1 ? '' : 's'}`,
    },
    {
      title: 'Total earned', value: naira(totals.credits), icon: <TrendingUp />, tone: 'green' as const,
      description: 'Income credited to the fleet',
    },
    {
      title: 'Net position', value: signedNaira(totals.balance), icon: <Scale />,
      tone: (totals.balance < 0 ? 'red' : 'green') as 'red' | 'green',
      className: signedTone(totals.balance),
      description: totals.balance < 0 ? 'The fleet cost more than it earned' : 'The fleet earned more than it cost',
    },
    {
      title: 'Cost per truck', value: naira(totals.trucks ? totals.debits / totals.trucks : 0),
      icon: <Truck />, tone: 'blue' as const,
      description: 'Average spend, this selection',
    },
    {
      title: 'Heaviest cost', value: topExpense ? topExpense.category : '—',
      icon: <Tags />, tone: 'amber' as const,
      description: topExpense
        ? `${naira(topExpense.amount)} · ${Math.round(topExpense.share * 100)}% of all spend`
        : 'No expenses in this selection',
    },
    {
      title: 'Watch this truck', value: worstTruck ? worstTruck.plate : '—',
      icon: <Wallet />, tone: 'red' as const,
      className: worstTruck ? 'text-destructive' : undefined,
      description: worstTruck
        ? `${signedNaira(worstTruck.balance)} over ${worstTruck.entries} entr${worstTruck.entries === 1 ? 'y' : 'ies'}`
        : 'Nothing is running at a loss',
    },
  ], [totals, topExpense, worstTruck])

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
        <div className="flex flex-wrap gap-2">
          {/* One export control. Excel or PDF is a question about the file,
              not two different reports, so it belongs inside the button
              rather than beside it. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!filtered.length || exporting !== null}>
                {exporting
                  ? <Loader2 data-icon="inline-start" className="animate-spin" />
                  : <Download data-icon="inline-start" />}
                Export
                <ChevronDown data-icon="inline-end" className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="gap-2 text-sm" onClick={() => runExport('excel')}>
                <FileSpreadsheet className="size-3.5 text-accent" /> Excel workbook
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-sm" onClick={() => runExport('pdf')}>
                <FileText className="size-3.5 text-muted-foreground" /> PDF report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => setBatching(true)}>
            <Layers data-icon="inline-start" />
            Batch entry
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus data-icon="inline-start" />
            Add entry
          </Button>
        </div>
      }
    />

      {/* The summary answers the two questions a fleet ledger is opened with —
          what is this costing, and which truck is the problem — before any
          scrolling. It moves with the filters, so it always describes exactly
          the rows below it. */}
      {!isLoading && filtered.length > 0 && <SummaryCards cards={cards} />}

      {expenseCategories.length > 0 && (
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Where the money goes</span>
            <span className="text-xs text-muted-foreground">
              Top {expenseCategories.length} of {categories.filter((c) => c.type === 'expense').length} expense categories
            </span>
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-x-8 gap-y-3 sm:grid-cols-2')}>
            {expenseCategories.map((c) => (
              <div key={c.category} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{c.category}</span>
                  <span className="shrink-0 tabular-nums">
                    {naira(c.amount)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {Math.round(c.share * 100)}%
                    </span>
                  </span>
                </div>
                {/* Width carries the share; the tint is the same destructive
                    hue the debit column uses, so the bar and the money agree. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive/70"
                    style={{ width: `${Math.max(c.share * 100, 1.5)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </div>

          {/* Arrangement, not a filter — it changes how the same rows read,
              and it is what the exports follow. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-foreground/10 pt-3">
            <span className={cn(MICRO, 'text-muted-foreground')}>Arrange by</span>
            {([
              ['truck', 'Truck, then date'],
              ['date', 'Date only'],
            ] as Array<[Arrangement, string]>).map(([value, label]) => (
              <button
                key={value} type="button" onClick={() => setArrangement(value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  arrangement === value
                    ? 'border-accent/40 bg-accent/10 font-medium text-accent'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">
              {arrangement === 'truck'
                ? 'Each truck in its own block, oldest entry first, with a running balance.'
                : 'One flat list, newest first.'}
            </span>
          </div>
        </div>
      </section>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}</span>
          {filtered.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              <span className="text-destructive">{naira(totals.debits)} debit</span>
              {' · '}
              <span className="text-accent">{naira(totals.credits)} credit</span>
              {' · '}
              <span className={cn('font-semibold', signedTone(totals.balance))}>
                {signedNaira(totals.balance)}
              </span>
            </span>
          )}
        </div>
        {isLoading ? (
          <PageLoader message="Loading ledger…" />
        ) : filtered.length === 0 ? (
          <PageEmpty title="No entries yet" description="Add an expense or income entry to begin." />
        ) : (
          <div className="px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow className="border-foreground/15 hover:bg-transparent">
                  {/* Indented in step with the entry rows below it, so the
                      column heading sits over its own column rather than over
                      the block header's margin. */}
                  <TableHead className={cn('text-sm font-medium', arrangement === 'truck' && ENTRY_INDENT)}>
                    Date
                  </TableHead>
                  {arrangement === 'date' && <TableHead className="text-sm font-medium">Truck</TableHead>}
                  <TableHead className="text-sm font-medium">Description</TableHead>
                  <TableHead className="text-sm font-medium">Category</TableHead>
                  <TableHead className="text-right text-sm font-medium text-destructive">Debit</TableHead>
                  <TableHead className="text-right text-sm font-medium text-accent">Credit</TableHead>
                  <TableHead className="text-right text-sm font-medium">Balance</TableHead>
                  <TableHead className="text-sm font-medium">Entered by</TableHead>
                  <TableHead className="text-right text-sm font-medium">Actions</TableHead>
                </TableRow>
              </TableHeader>

              {arrangement === 'truck' ? (
                groups.map((group) => (
                  <TruckBlock
                    key={group.truckId}
                    group={group}
                    onEdit={setEditing}
                    onDelete={setDeleting}
                  />
                ))
              ) : (
                <TableBody>
                  {flatRows.map((e, i) => (
                    <EntryRow
                      key={e.id} entry={e} index={i} showTruck
                      onEdit={setEditing} onDelete={setDeleting}
                    />
                  ))}
                </TableBody>
              )}

              {/* The fleet's own bottom line, closed off the way a ledger
                  closes: a rule above it and the balance carrying its sign. */}
              <tfoot>
                <TableRow className="border-t-2 border-foreground/25 bg-muted/70 hover:bg-muted/70">
                  <TableCell className="py-3 pl-3 font-semibold" colSpan={arrangement === 'date' ? 4 : 3}>
                    Fleet total
                    <span className="ml-2 font-normal text-muted-foreground">
                      {totals.entries} entr{totals.entries === 1 ? 'y' : 'ies'} ·{' '}
                      {totals.trucks} truck{totals.trucks === 1 ? '' : 's'}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular-nums text-destructive">
                    {naira(totals.debits)}
                  </TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular-nums text-accent">
                    {naira(totals.credits)}
                  </TableCell>
                  <TableCell className={cn('py-3 text-right font-semibold tabular-nums', signedTone(totals.balance))}>
                    {signedNaira(totals.balance)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </tfoot>
            </Table>
          </div>
        )}
      </section>

      <BatchEntryDialog
        open={batching}
        trucks={trucks}
        onOpenChange={setBatching}
      />

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

/**
 * One truck's whole story: a banded header carrying its totals, its entries
 * oldest-first underneath, and a subtotal that closes the block.
 *
 * Its own <tbody> per truck, which is what carries the left rail and the
 * rule that opens the block, and what keeps striping from running across a
 * boundary.
 */
function TruckBlock({
  group, onEdit, onDelete,
}: {
  group: TruckGroup
  onEdit: (e: LedgerEntry) => void
  onDelete: (e: LedgerEntry) => void
}) {
  // Date + Description + Category, before the three money columns. The truck
  // column is absent in this arrangement — the block header names it once.
  const span = 3
  return (
    <TableBody className={cn('border-t-2 border-foreground/20', BLOCK_RAIL)}>
      <TableRow className="border-foreground/15 bg-muted/60 hover:bg-muted/60">
        <TableCell colSpan={span} className={cn('py-3', SUMMARY_INDENT)}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* The plate is the heading of the block, so it carries the weight. */}
            <span className="font-mono font-semibold">{group.plate}</span>
            <span className="text-muted-foreground">{group.driver || '—'}</span>
            <span className="text-muted-foreground">
              {group.entries} entr{group.entries === 1 ? 'y' : 'ies'}
              {group.firstDate && group.lastDate && (
                <> · {format(group.firstDate, 'd MMM yyyy')} – {format(group.lastDate, 'd MMM yyyy')}</>
              )}
            </span>
          </div>
        </TableCell>
        <TableCell className="py-3 text-right font-semibold tabular-nums text-destructive">
          {naira(group.debits)}
        </TableCell>
        <TableCell className="py-3 text-right font-semibold tabular-nums text-accent">
          {naira(group.credits)}
        </TableCell>
        <TableCell className={cn('py-3 text-right font-semibold tabular-nums', signedTone(group.balance))}>
          {signedNaira(group.balance)}
        </TableCell>
        <TableCell colSpan={2} />
      </TableRow>

      {group.rows.map((row, i) => (
        <EntryRow key={row.id} entry={row} index={i} indent onEdit={onEdit} onDelete={onDelete} />
      ))}

      <TableRow className="border-foreground/15 bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={span} className={cn('py-2.5 text-muted-foreground', SUMMARY_INDENT)}>
          Subtotal — <span className="font-mono text-foreground">{group.plate}</span>
        </TableCell>
        <TableCell className="py-2.5 text-right font-semibold tabular-nums text-destructive">
          {naira(group.debits)}
        </TableCell>
        <TableCell className="py-2.5 text-right font-semibold tabular-nums text-accent">
          {naira(group.credits)}
        </TableCell>
        <TableCell className={cn('py-2.5 text-right font-semibold tabular-nums', signedTone(group.balance))}>
          {signedNaira(group.balance)}
        </TableCell>
        <TableCell colSpan={2} />
      </TableRow>
    </TableBody>
  )
}

function EntryRow({
  entry, index, showTruck = false, indent = false, onEdit, onDelete,
}: {
  entry: LedgerRow
  index: number
  showTruck?: boolean
  /** Stepped in under its truck's block header — see ENTRY_INDENT. */
  indent?: boolean
  onEdit: (e: LedgerEntry) => void
  onDelete: (e: LedgerEntry) => void
}) {
  const expense = isExpense(entry)
  return (
    <TableRow className={cn('border-foreground/10', index % 2 === 1 && 'bg-foreground/[0.02]')}>
      <TableCell className={cn('whitespace-nowrap tabular-nums', indent && ENTRY_INDENT)}>
        {format(new Date(entry.entry_date), 'd MMM yyyy')}
      </TableCell>
      {showTruck && <TableCell className="font-mono font-medium">{entry.truck_plate}</TableCell>}
      <TableCell className="max-w-[20rem] truncate" title={entry.description || undefined}>
        {entry.description || '—'}
      </TableCell>
      <TableCell className="text-muted-foreground">{entry.category}</TableCell>
      {/* One entry occupies exactly one column — the split is the whole point,
          since the model only has type and amount. */}
      <TableCell className="text-right font-medium tabular-nums text-destructive">
        {expense ? naira(entry.amount) : ''}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums text-accent">
        {expense ? '' : naira(entry.amount)}
      </TableCell>
      {/* Quieter than the two columns feeding it: it is a position, not a
          movement, and it should not compete with the entry itself. */}
      <TableCell className={cn('text-right tabular-nums', signedTone(entry.runningBalance))}>
        {signedNaira(entry.runningBalance)}
      </TableCell>
      <TableCell className="text-muted-foreground">{entry.entered_by || '—'}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(entry)}>
            <Pencil /><span className="sr-only">Edit entry</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onDelete(entry)}>
            <Trash2 /><span className="sr-only">Delete entry</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
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
