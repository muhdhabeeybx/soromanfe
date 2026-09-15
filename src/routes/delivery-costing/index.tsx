import { Fragment, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Banknote, Calculator, ChevronRight, Download, FileSpreadsheet, FileText, Fuel, Loader2,
  Search, Truck, TrendingUp, X,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageError } from '#/components/PageError'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { PANEL, PANEL_RAIL, PANEL_BODY, MICRO } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'
import { useDeliveryInventoryList } from '#/lib/hooks/useDeliveryInventory'
import { TripCostDialog, type CostableTruck } from '#/components/delivery-operations/TripCostDialog'
import { routeGuard } from '#/lib/route-guard'
import {
  exportCostingWorkbook, exportCostingPdf, type CostingBatch,
} from './-costing-export'
import { useToast } from '#/lib/hooks/useToast'

export const Route = createFileRoute('/delivery-costing/')({
  beforeLoad: () => routeGuard('/delivery-costing'),
  component: DeliveryCostingPage,
})

/**
 * What each truck on a batch cost to run, and what it made.
 *
 * The delivery inventory answers where a load went and who bought it. This
 * answers whether it was worth running: diesel, feeding, what the product cost
 * us, against what it sold for — per truck, because that is how the money is
 * actually spent. Two trucks on one batch can take different AGO at different
 * prices, and a batch-level average hides exactly the trip that lost money.
 *
 * ── Deliberately not the same table ────────────────────────────────────────
 *
 * No customer, no split, no driver. Those belong to the sale; this is about the
 * trip. Carrying them would double the width of an already wide table and
 * invite reading a margin as a customer's rather than a truck's.
 *
 * ── Four figures entered, five worked out ──────────────────────────────────
 *
 * Only AGO litres, AGO price, feeding and product price are stored. AGO value,
 * total expenses, cost per litre, landing cost and margin are computed on the
 * server wherever they are read, so correcting a price cannot leave a stale
 * total behind it.
 */

const n = (v: unknown) => (v == null ? null : Number(v))
const money = (v: unknown) => (v == null ? '—' : naira(Number(v)))
const qty = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en-NG'))

interface Row extends CostableTruck {
  allocationCode?: string | null
  pfiNumber?: string | null
  depot?: string | null
  agoValue?: number | null
  totalExpenses?: number | null
  costPerLitre?: number | null
  landingCost?: number | null
  margin?: number | null
  marginValue?: number | null
  missing?: string[]
}

function DeliveryCostingPage() {
  const toast = useToast()
  const { data: inventory = [], isLoading, isError, error, refetch } = useDeliveryInventoryList()

  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState('all')
  const [depot, setDepot] = useState('all')
  const [costedFilter, setCostedFilter] = useState<'all' | 'costed' | 'uncosted'>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Row[] | null>(null)
  /**
   * Which batch is open, by code. One at a time, deliberately — the point of
   * the summary rows is that batches can be compared down a column, and every
   * batch expanded at once is the flat table this replaced.
   */
  const [openBatch, setOpenBatch] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)
  /**
   * What a download was asked for, waiting on a format.
   *
   * One button that then asks, rather than two side by side: the choice is
   * Excel-or-PDF, and putting both in the header made the same decision twice
   * — once in the toolbar of every page, once again on every batch row.
   */
  const [exportFor, setExportFor] = useState<{ batches: CostingBatch[]; label: string } | null>(null)

  const rows: Row[] = useMemo(
    () => (Array.isArray(inventory) ? inventory : []).map((r: any) => ({
      ...r,
      id: Number(r.id ?? r._id),
      allocationCode: (r.allocationCode || r.allocation_code || '').trim().toUpperCase(),
    })),
    [inventory],
  )

  const options = useMemo(() => {
    const uniq = (v: (string | null | undefined)[]) =>
      [...new Set(v.map((x) => (x || '').trim()).filter(Boolean))].sort()
    return {
      batches: uniq(rows.map((r) => r.allocationCode)),
      depots: uniq(rows.map((r) => r.depot)),
    }
  }, [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (batch !== 'all' && r.allocationCode !== batch) return false
    if (depot !== 'all' && (r.depot || '') !== depot) return false
    if (costedFilter === 'costed' && !r.costed) return false
    if (costedFilter === 'uncosted' && r.costed) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [r.truckNumber, r.allocationCode, r.pfiNumber, r.depot]
      .some((f) => String(f ?? '').toLowerCase().includes(q))
  }), [rows, batch, depot, costedFilter, search])

  /**
   * The cards, from the filtered rows.
   *
   * Margin is averaged over the litres it applies to, not over the trucks: a
   * 10,000-litre truck and a 50,000-litre one do not weigh the same, and a
   * plain mean of two per-litre margins would say the wrong thing about the
   * batch. Trucks with no margin yet are left out of the average entirely
   * rather than counted as zero.
   */
  const summary = useMemo(() => {
    let litres = 0
    let expenses = 0
    let marginValue = 0
    let marginLitres = 0
    let uncosted = 0
    for (const r of filtered) {
      litres += Number(r.quantityAllocated || 0)
      expenses += Number(r.totalExpenses || 0)
      if (r.margin != null) {
        marginValue += Number(r.marginValue || 0)
        marginLitres += Number(r.quantityAllocated || 0)
      }
      if (!r.costed) uncosted++
    }
    return {
      trucks: filtered.length,
      litres,
      expenses,
      marginValue,
      avgMargin: marginLitres > 0 ? marginValue / marginLitres : null,
      uncosted,
    }
  }, [filtered])

  /**
   * The rows grouped by batch, each with its own totals.
   *
   * The flat table was fourteen columns of per-truck detail with no way to
   * compare one batch against another — and comparing batches is the question
   * this page exists to answer. Each batch now reads as one line that can be
   * scanned down a column, and opens into its trucks.
   *
   * Batch totals are computed here rather than summed from what is rendered,
   * so a collapsed batch shows the same figures as an open one.
   */
  const groups = useMemo(() => {
    const byCode = new Map<string, Row[]>()
    for (const r of filtered) {
      const code = r.allocationCode || 'No batch code'
      if (!byCode.has(code)) byCode.set(code, [])
      byCode.get(code)!.push(r)
    }

    return [...byCode.entries()]
      .map(([code, list]) => {
        let litres = 0
        let expenses = 0
        let marginValue = 0
        let marginLitres = 0
        let uncosted = 0
        for (const r of list) {
          litres += Number(r.quantityAllocated || 0)
          expenses += Number(r.totalExpenses || 0)
          if (r.margin != null) {
            marginValue += Number(r.marginValue || 0)
            marginLitres += Number(r.quantityAllocated || 0)
          }
          if (!r.costed) uncosted++
        }
        return {
          code,
          rows: list,
          litres,
          expenses,
          marginValue,
          // Weighted by the litres it applies to, and blind to uncosted
          // trucks: averaging them in as zero would drag a good batch down
          // for no reason but that nobody has typed the diesel in yet.
          avgMargin: marginLitres > 0 ? marginValue / marginLitres : null,
          uncosted,
          pfiNumber: list.find((r) => r.pfiNumber)?.pfiNumber || null,
          depot: list.find((r) => r.depot)?.depot || null,
        }
      })
      .sort((a, b) => b.rows.length - a.rows.length || a.code.localeCompare(b.code))
  }, [filtered])

  const pickedRows = filtered.filter((r) => picked.has(r.id))

  const toggle = (id: number) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  /**
   * Tick or clear a whole batch.
   *
   * Clears only when every truck on it is already ticked — a half-ticked batch
   * means somebody chose those trucks, and wiping their selection to "tidy" it
   * would throw that away.
   */
  const toggleGroup = (list: Row[]) => setPicked((prev) => {
    const next = new Set(prev)
    const all = list.every((r) => next.has(r.id))
    for (const r of list) {
      if (all) next.delete(r.id)
      else next.add(r.id)
    }
    return next
  })

  const dirty = search !== '' || batch !== 'all' || depot !== 'all' || costedFilter !== 'all'

  /**
   * What the file is a view of, printed on it.
   *
   * A costing sheet filtered to one depot and mailed on is indistinguishable
   * from the whole company's unless it says so, and that is the kind of
   * mistake that gets a margin quoted at the wrong meeting.
   */
  const scope = [
    batch !== 'all' ? `Batch: ${batch}` : 'All batches',
    depot !== 'all' ? `Location: ${depot}` : null,
    costedFilter !== 'all' ? (costedFilter === 'costed' ? 'Costed only' : 'Not costed only') : null,
    search.trim() ? `Search: ${search.trim()}` : null,
  ].filter(Boolean).join('   ·   ')

  const download = async (kind: 'xlsx' | 'pdf') => {
    const target = exportFor
    if (!target || !target.batches.length) return
    setExporting(kind)
    try {
      /**
       * Totalled over what is being exported, not over the page.
       *
       * A single batch's file must foot to that batch. Handing it the page's
       * totals would print the company's margin under one batch's trucks,
       * which is the kind of figure that gets read out of context and
       * believed.
       */
      const t = target.batches.reduce(
        (acc, b) => {
          acc.trucks += b.rows.length
          acc.expenses += b.expenses
          acc.marginValue += b.marginValue
          for (const r of b.rows) {
            if (r.margin != null) acc.marginLitres += Number(r.quantityAllocated || 0)
          }
          return acc
        },
        { trucks: 0, expenses: 0, marginValue: 0, marginLitres: 0 },
      )

      const meta = {
        scope: target.label,
        trucks: t.trucks,
        expenses: t.expenses,
        marginValue: t.marginValue,
        avgMargin: t.marginLitres > 0 ? t.marginValue / t.marginLitres : null,
      }
      if (kind === 'xlsx') await exportCostingWorkbook(target.batches, meta)
      else await exportCostingPdf(target.batches, meta)
      setExportFor(null)
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setExporting(null)
    }
  }

  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Truck Sales"
        title="Delivery costing"
        description="What each truck cost to run, and what it made."
        actions={(
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={groups.length === 0}
              onClick={() => setExportFor({ batches: groups, label: scope })}
            >
              <Download data-icon="inline-start" />
              Export
            </Button>
            <Button
              size="sm"
              disabled={pickedRows.length === 0}
              onClick={() => setEditing(pickedRows)}
            >
              <Calculator data-icon="inline-start" />
              {pickedRows.length > 0 ? `Cost ${pickedRows.length} trucks` : 'Bulk enter'}
            </Button>
          </div>
        )}
      />

      {/* Litres was the fifth card and the one nothing is decided on here —
          every row carries its own, and this page is about money. The two
          margin figures stay: one says how the rate is doing, the other how
          much it actually earned, and they are not the same question. */}
      <StatCardGrid count={4}>
        <StatCard icon={<Truck />} label="Trucks" value={qty(summary.trucks)} tone="neutral" />
        <StatCard icon={<Fuel />} label="Trip expenses" value={money(summary.expenses)} tone="amber" />
        <StatCard
          icon={<TrendingUp />}
          label="Margin per litre"
          value={summary.avgMargin == null ? '—' : naira(summary.avgMargin)}
          tone={summary.avgMargin == null ? 'neutral' : summary.avgMargin >= 0 ? 'green' : 'red'}
        />
        <StatCard
          icon={<Banknote />}
          label="Margin earned"
          value={money(summary.marginValue)}
          tone={summary.marginValue >= 0 ? 'green' : 'red'}
        />
      </StatCardGrid>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Filters</span>
          {dirty && (
            <Button
              variant="ghost" size="sm" className="ml-auto"
              onClick={() => { setSearch(''); setBatch('all'); setDepot('all'); setCostedFilter('all') }}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
        <div className={cn(PANEL_BODY, 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4')}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8" placeholder="Truck, batch, PFI…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <NativeSelect value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="all">All batches</option>
            {options.batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </NativeSelect>
          <NativeSelect value={depot} onChange={(e) => setDepot(e.target.value)}>
            <option value="all">All locations</option>
            {options.depots.map((d) => <option key={d} value={d}>{d}</option>)}
          </NativeSelect>
          <NativeSelect
            value={costedFilter}
            onChange={(e) => setCostedFilter(e.target.value as 'all' | 'costed' | 'uncosted')}
          >
            <option value="all">Costed and not</option>
            <option value="uncosted">Not costed yet</option>
            <option value="costed">Costed</option>
          </NativeSelect>
        </div>
      </section>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>
            {groups.length} batch{groups.length === 1 ? '' : 'es'} · {filtered.length} truck{filtered.length === 1 ? '' : 's'}
          </span>
          {pickedRows.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {pickedRows.length} selected
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {dirty ? 'Nothing matches these filters.' : 'No loads recorded yet. Start with New batch.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Batch</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Trucks</TableHead>
                  <TableHead className="text-right">Litres</TableHead>
                  <TableHead className="text-right">Trip expenses</TableHead>
                  <TableHead className="text-right">Margin / litre</TableHead>
                  <TableHead className="text-right">Margin earned</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const isOpen = openBatch === g.code
                  const groupPicked = g.rows.filter((r) => picked.has(r.id))
                  return (
                    <Fragment key={g.code}>
                      {/* The summary line. Clicking anywhere on it opens the
                          batch — there is only one thing to do with a row that
                          is a heading. */}
                      <TableRow
                        className="cursor-pointer bg-card"
                        onClick={() => setOpenBatch(isOpen ? null : g.code)}
                      >
                        <TableCell className="pr-0 text-muted-foreground">
                          <ChevronRight
                            className={cn(
                              'size-4 transition-transform duration-250 ease-luxe',
                              isOpen && 'rotate-90',
                            )}
                          />
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {g.code}
                          {g.uncosted > 0 && (
                            <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                              {g.uncosted} not costed
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[16rem] truncate" title={g.depot || undefined}>
                          {g.depot || '—'}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">{g.rows.length}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{qty(g.litres)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{money(g.expenses)}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-medium whitespace-nowrap tabular-nums',
                            g.avgMargin != null && (g.avgMargin >= 0
                              ? 'text-emerald-600 dark:text-emerald-500'
                              : 'text-destructive'),
                          )}
                          title={g.avgMargin != null ? 'Weighted by litres, uncosted trucks excluded' : undefined}
                        >
                          {g.avgMargin == null ? '—' : naira(g.avgMargin)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-medium whitespace-nowrap tabular-nums',
                            g.marginValue >= 0
                              ? 'text-emerald-600 dark:text-emerald-500'
                              : 'text-destructive',
                          )}
                        >
                          {money(g.marginValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* This batch on its own — the file most often
                                wanted, since a batch is what gets discussed. */}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={`Download ${g.code}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setExportFor({ batches: [g], label: `Batch: ${g.code}` })
                              }}
                            >
                              <Download className="size-3.5" />
                              <span className="sr-only">Download {g.code}</span>
                            </Button>
                            {/* Cost the whole batch in one go — the normal
                                case, since trucks on a batch usually take the
                                same diesel at the same price on the same day. */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditing(groupPicked.length > 0 ? groupPicked : g.rows)
                              }}
                            >
                              <Calculator className="size-3.5" />
                              {groupPicked.length > 0 ? `Cost ${groupPicked.length}` : 'Cost batch'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="bg-muted/20 p-0">
                            <div className="overflow-x-auto px-3 py-2">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-10">
                                      <Checkbox
                                        checked={g.rows.every((r) => picked.has(r.id))}
                                        onCheckedChange={() => toggleGroup(g.rows)}
                                        aria-label={`Select every truck on ${g.code}`}
                                      />
                                    </TableHead>
                                    <TableHead>Truck</TableHead>
                                    <TableHead className="text-right">Loaded</TableHead>
                                    <TableHead className="text-right">AGO (L)</TableHead>
                                    <TableHead className="text-right">AGO price</TableHead>
                                    <TableHead className="text-right">AGO value</TableHead>
                                    <TableHead className="text-right">Feeding</TableHead>
                                    <TableHead className="text-right">Total expenses</TableHead>
                                    <TableHead className="text-right">Cost / litre</TableHead>
                                    <TableHead className="text-right">Product price</TableHead>
                                    <TableHead className="text-right">Landing cost</TableHead>
                                    <TableHead className="text-right">Rate sold</TableHead>
                                    <TableHead className="text-right">Margin</TableHead>
                                    <TableHead />
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {g.rows.map((r) => (
                                    <TableRow
                                      key={r.id}
                                      className={picked.has(r.id) ? 'bg-accent/5' : undefined}
                                    >
                                      <TableCell>
                                        <Checkbox
                                          checked={picked.has(r.id)}
                                          onCheckedChange={() => toggle(r.id)}
                                          aria-label={`Select ${r.truckNumber}`}
                                        />
                                      </TableCell>
                                      <TableCell className="font-medium whitespace-nowrap">
                                        {r.truckNumber || '—'}
                                      </TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{qty(r.quantityAllocated)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{qty(r.agoLitres)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.agoPrice)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.agoValue)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.feedingAllowance)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.totalExpenses)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.costPerLitre)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.productPrice)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{money(r.landingCost)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">
                                        {n(r.rate) ? money(r.rate) : '—'}
                                      </TableCell>
                                      {/* A blank margin is a fact, not a gap:
                                          the product price or the selling rate
                                          is still missing, and the tooltip says
                                          which. A 0 there would report the whole
                                          rate as profit. */}
                                      <TableCell
                                        className={cn(
                                          'text-right font-medium whitespace-nowrap tabular-nums',
                                          r.margin != null && (r.margin >= 0
                                            ? 'text-emerald-600 dark:text-emerald-500'
                                            : 'text-destructive'),
                                        )}
                                        title={r.margin == null && r.missing?.length
                                          ? `Needs ${r.missing.join(' and ')}`
                                          : r.marginValue != null
                                            ? `${naira(r.marginValue)} on this load`
                                            : undefined}
                                      >
                                        {r.margin == null ? '—' : naira(r.margin)}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => setEditing([r])}>
                                          {r.costed ? 'Edit' : 'Add'}
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Asked after the download, not before it.
          The decision is only ever Excel-or-PDF, and putting both in the
          toolbar made the same choice twice — once in the header, then again
          on every batch row. One control, then the question. */}
      <Dialog open={exportFor !== null} onOpenChange={(o) => { if (!o) setExportFor(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Download</DialogTitle>
            <DialogDescription>{exportFor?.label}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="h-auto flex-col gap-1.5 py-4"
              disabled={exporting !== null}
              onClick={() => download('xlsx')}
            >
              {exporting === 'xlsx'
                ? <Loader2 className="size-5 animate-spin" />
                : <FileSpreadsheet className="size-5" />}
              <span>Excel</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Figures you can total
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-1.5 py-4"
              disabled={exporting !== null}
              onClick={() => download('pdf')}
            >
              {exporting === 'pdf'
                ? <Loader2 className="size-5 animate-spin" />
                : <FileText className="size-5" />}
              <span>PDF</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                To print or send on
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TripCostDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        trucks={editing ?? []}
      />

    </div>
  )
}
