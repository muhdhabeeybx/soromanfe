import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Banknote, Calculator, Droplets, Fuel, Loader2, Plus, Search, Trash2, Truck, TrendingUp, X,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageError } from '#/components/PageError'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Checkbox } from '#/components/ui/checkbox'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { PANEL, PANEL_RAIL, PANEL_BODY, MICRO } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'
import { useDeliveryInventoryList, useDeleteDeliveryBatch } from '#/lib/hooks/useDeliveryInventory'
import { NewBatchDialog } from '#/components/delivery-operations/NewBatchDialog'
import { TripCostDialog, type CostableTruck } from '#/components/delivery-operations/TripCostDialog'
import { routeGuard } from '#/lib/route-guard'
import { ConfirmDialog } from '#/components/ConfirmDialog'

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
  const { data: inventory = [], isLoading, isError, error, refetch } = useDeliveryInventoryList()

  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState('all')
  const [depot, setDepot] = useState('all')
  const [costedFilter, setCostedFilter] = useState<'all' | 'costed' | 'uncosted'>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Row[] | null>(null)
  const [newBatch, setNewBatch] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteBatch = useDeleteDeliveryBatch()

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

  const allPicked = filtered.length > 0 && filtered.every((r) => picked.has(r.id))
  const pickedRows = filtered.filter((r) => picked.has(r.id))

  const toggle = (id: number) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(filtered.map((r) => r.id)))

  const dirty = search !== '' || batch !== 'all' || depot !== 'all' || costedFilter !== 'all'

  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Truck Sales"
        title="Delivery costing"
        description="What each truck cost to run, and what it made."
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewBatch(true)}>
              <Plus data-icon="inline-start" />
              New batch
            </Button>
            {/* Only offered when a single batch is in view. "Delete what is
                on screen" is far too easy to fire at a filtered list that
                happens to span three batches. Renaming a code stays on
                Delivery Inventory — two places to rename one code is how the
                same batch ends up under two names. */}
            {batch !== 'all' && (
              <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
                <Trash2 data-icon="inline-start" />
                Delete batch
              </Button>
            )}
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

      <StatCardGrid count={5}>
        <StatCard icon={<Truck />} label="Trucks" value={qty(summary.trucks)} tone="neutral" />
        <StatCard icon={<Droplets />} label="Litres" value={qty(summary.litres)} tone="blue" />
        <StatCard icon={<Fuel />} label="Trip expenses" value={money(summary.expenses)} tone="amber" />
        <StatCard
          icon={<TrendingUp />}
          label="Margin per litre"
          value={summary.avgMargin == null ? '—' : naira(summary.avgMargin)}
          tone={summary.avgMargin == null ? 'neutral' : summary.avgMargin >= 0 ? 'green' : 'red'}
          description="Weighted by litres"
        />
        <StatCard
          icon={<Banknote />}
          label="Margin earned"
          value={money(summary.marginValue)}
          tone={summary.marginValue >= 0 ? 'green' : 'red'}
          description={summary.uncosted > 0 ? `${summary.uncosted} not costed yet` : undefined}
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
            {filtered.length} truck{filtered.length === 1 ? '' : 's'}
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
                  <TableHead className="w-10">
                    <Checkbox checked={allPicked} onCheckedChange={toggleAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Batch</TableHead>
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
                {filtered.map((r) => (
                  <TableRow key={r.id} className={picked.has(r.id) ? 'bg-accent/5' : undefined}>
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
                    <TableCell className="max-w-[12rem] truncate" title={r.allocationCode || undefined}>
                      {r.allocationCode || '—'}
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
                    {/* A blank margin is a fact, not a gap: it means the product
                        price or the selling rate is still missing, and the
                        tooltip says which. Showing 0 there would report the
                        whole rate as profit on every uncosted trip. */}
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
        )}
      </section>

      <NewBatchDialog
        open={newBatch}
        onOpenChange={setNewBatch}
        existingCodes={options.batches}
      />

      <TripCostDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        trucks={editing ?? []}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${batch}?`}
        description={
          `Every truck recorded under this code goes, along with the trip costs entered against `
          + `them. This cannot be undone.`
        }
        confirmLabel="Delete the batch"
        loading={deleteBatch.isPending}
        onConfirm={async () => {
          const inBatch = rows.filter((r) => r.allocationCode === batch)
          await deleteBatch.mutateAsync({
            // The PFI the loads hang off, if any. useDeleteDeliveryBatch takes
            // it first: DELETE /pfis refuses a batch an order references, and
            // that is the likely refusal — better it happens while nothing has
            // been touched than after the truck rows are gone.
            pfiId: (inBatch.find((x) => (x as any).pfiId) as any)?.pfiId ?? null,
            inventoryIds: inBatch.map((r) => String(r.id)),
            label: batch,
          })
          setBatch('all')
          setDeleting(false)
        }}
      />
    </div>
  )
}
