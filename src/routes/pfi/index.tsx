import { useState, useMemo, useEffect } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Search, Plus, Package, Banknote, Droplets, TriangleAlert,
  ArrowUpDown, Lock, Pencil, Download, X, TrendingUp, TrendingDown,
  FileSpreadsheet, Gauge,
} from 'lucide-react'

import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { PfiDetailDialog } from '#/components/PfiDetailDialog'
import { PfiCloseDialog } from '#/components/PfiCloseDialog'
import { MICRO, PANEL, PANEL_RAIL, PANEL_FOOTER } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import {
  naira, litres, qty, unitNames, moneyTone, profitTint, SurplusDeficit, SellThroughBar,
} from '#/routes/pfi/-pfi-utils'
// The PDF builder stays exported for anyone who wants it; the card offers
// one report, the workbook.
import { downloadPfiReport, downloadMasterReport } from '#/routes/pfi/-pfi-report'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/pfi/')({
  beforeLoad: () => routeGuard('/pfi'),
  component: PFIDashboard,
})

type SortKey = 'serial' | 'pfiNumber' | 'cost' | 'revenue' | 'profit' | 'remaining' | 'sellThrough'

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'serial', label: 'Serial (active first)' },
  { key: 'profit', label: 'Profit/Loss' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'cost', label: 'Total cost' },
  { key: 'remaining', label: 'Stock remaining' },
  { key: 'sellThrough', label: 'Sell-through' },
  { key: 'pfiNumber', label: 'PFI number' },
]

/**
 * The serial out of a PFI number, for ordering the book the way it is spoken
 * about: 43, 41, 36B, 25B.
 *
 * A PFI number carries its serial first and then a description —
 * "PFI/43/26/DANGOTE/PMS/3ML/AUG", "PFI 36B/26/MT STELLAR/CALABAR" — so a
 * plain string sort puts 41 above 5 and reads as random. This pulls out the
 * leading number and the letter that sometimes follows it, and sorts on those.
 *
 * @returns [number, letter] — letter is "" when there is none
 */
function serialOf(pfiNumber: string | null | undefined): [number, string] {
  const m = String(pfiNumber || '').match(/(\d+)\s*([A-Za-z]?)/)
  return m ? [Number(m[1]), (m[2] || '').toUpperCase()] : [-1, '']
}

/**
 * Active batches first, then finished; newest serial first within each.
 *
 * Two groups rather than one list because they are read for different reasons:
 * an active batch is something to act on, a finished one is something to look
 * up. Mixing them by serial alone buries the live batches among the closed
 * ones the moment the numbering wraps.
 */
function compareSerial(a: PfiWithFinancials, b: PfiWithFinancials): number {
  const aActive = a.status === 'active' ? 0 : 1
  const bActive = b.status === 'active' ? 0 : 1
  if (aActive !== bActive) return aActive - bActive

  const [an, al] = serialOf(a.pfiNumber)
  const [bn, bl] = serialOf(b.pfiNumber)
  if (an !== bn) return bn - an
  if (al !== bl) return bl.localeCompare(al)
  // Same serial and suffix — fall back to the full string so the order is at
  // least stable rather than left to the sort's own discretion.
  return String(b.pfiNumber || '').localeCompare(String(a.pfiNumber || ''))
}

/**
 * The trading name for a product, so stock can be totalled per fuel.
 *
 * The product table calls petrol "Petrol"; the desk calls it PMS, and asks
 * "how much PMS is left" rather than "how much Petrol". Matching on what is
 * actually stored and answering in the name people use is the whole job here.
 * Anything unrecognised keeps its own name rather than being lumped into an
 * "Other" bucket that hides which fuel it was.
 */
function fuelLabel(productName: string | null | undefined): string {
  const t = String(productName || '').trim()
  if (!t) return 'Unnamed product'
  if (/pms|petrol|premium motor/i.test(t)) return 'PMS'
  if (/ago|diesel|gas\s*oil/i.test(t)) return 'AGO'
  if (/lpg|cooking gas|propane/i.test(t)) return 'LPG'
  if (/dpk|kerosene/i.test(t)) return 'DPK'
  return t
}

/**
 * Null for an unpriced batch, which is not the same as a low value — sorting
 * one as if it were the worst loss in the book would put the batches nobody
 * has costed at the top of a list about money.
 */
function sortValue(p: PfiWithFinancials, key: SortKey): number | string | null {
  const f = p.financials
  switch (key) {
    // Handled by compareSerial before this runs; here for exhaustiveness.
    case 'serial': return p.pfiNumber || ''
    case 'pfiNumber': return p.pfiNumber || ''
    // Sorting follows the displayed figure — after credit. See the note on
    // the Total cost card.
    case 'cost': return f.grandTotalCost
    case 'revenue': return f.revenue
    case 'profit': return f.profitLoss
    case 'remaining': return f.remaining
    case 'sellThrough': return f.sellThrough
  }
}

function PFIDashboard() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'serial', dir: 'desc' })
  const [detailId, setDetailId] = useState<number | null>(null)
  const [closing, setClosing] = useState<PfiWithFinancials | null>(null)

  /**
   * Every batch, not the first hundred.
   *
   * This page has no pagination — it renders whatever it is given as cards and
   * sums the same set into the summary tiles above them. The endpoint defaults
   * to `limit=100`, so past a hundred batches the list quietly stopped short
   * AND every total on this page was computed over that subset: the portfolio
   * cost, revenue, quantity remaining and profit were all understated with
   * nothing on screen to say so.
   *
   * 1,000 is the server's own ceiling (pfi.repository clamps there). If the
   * book ever passes it, `truncated` below says so out loud rather than
   * letting the totals go quietly wrong again.
   */
  const PAGE_LIMIT = 1000

  /**
   * The search box types locally and queries on a pause.
   *
   * Every keystroke used to become its own request, and because the query key
   * changed each time the cache had nothing for it — so the page dropped to a
   * full-screen spinner between letters. Typing four characters meant four
   * round trips and four blank screens. 300ms of quiet is enough to mean
   * "finished typing" without feeling laggy, and `placeholderData` in
   * usePfiList keeps the previous results visible while the new ones land.
   */
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isError, error, refetch, isFetching } = usePfiList({
    search: debouncedSearch || undefined,
    status: status !== 'all' ? status : undefined,
    type: type !== 'all' ? type : undefined,
    limit: PAGE_LIMIT,
  })

  const pfis = (data?.pfis || []) as PfiWithFinancials[]
  const totalMatching = Number(data?.pagination?.total ?? pfis.length)
  const truncated = totalMatching > pfis.length
  const hasFilters = !!search || status !== 'all' || type !== 'all'

  const rows = useMemo(() => {
    const list = [...pfis]

    // Serial ordering carries its own grouping rule and ignores the direction
    // toggle — "active first, newest serial first" is the whole point of it,
    // and letting it be reversed would just bury the live batches again.
    if (sort.key === 'serial') {
      list.sort(compareSerial)
      return list
    }

    list.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      // Unpriced batches sink to the bottom whichever way the column is sorted.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : av - (bv as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [pfis, sort])

  /**
   * Portfolio totals.
   *
   * Cost and profit skip batches with no BL or price — adding a null in as
   * zero would understate the portfolio cost and overstate its profit.
   */
  const stats = useMemo(() => {
    let cost = 0, revenue = 0, expenses = 0, remaining = 0, deficitCost = 0
    let costed = 0, uncosted = 0, active = 0, partSold = 0
    let sold = 0
    // The two halves of the portfolio landing cost, accumulated together.
    let landingCost = 0, landingQty = 0
    // Batches whose quantity is not in litres — LPG is bought in tonnes.
    let otherUnit = 0

    /**
     * Stock left, per fuel and in that fuel's own unit.
     *
     * One "quantity remaining" number across the whole book answers nothing
     * useful — PMS and AGO are bought, priced and sold separately, and the
     * question is always "how much PMS is left", never "how much product".
     * Kept per unit as well as per fuel so an LPG tonnage is never added to a
     * litre figure.
     */
    const byFuel = new Map<string, { qty: number; unit: string; batches: number }>()

    for (const p of pfis) {
      const f = p.financials
      revenue += f.revenue
      expenses += f.totalExpenses
      if (f.deficitCost != null) deficitCost += f.deficitCost
      if (f.grandTotalCost != null) { cost += f.grandTotalCost; costed++ } else uncosted++
      if (p.status === 'active') active++
      if (!f.profitIsMeaningful && f.sellThrough != null) partSold++

      // Per-fuel stock, ACTIVE batches only.
      //
      // A finished batch is closed out — whatever its arithmetic still shows
      // as remaining is not stock anyone can sell, and folding it in would
      // answer "how much PMS could we ship today" with a number that includes
      // product from batches settled months ago.
      //
      // Grouped before the litres check below, because an LPG batch has a
      // perfectly good tonnage — it just cannot be added to a litre total.
      // Oversold batches clamp at zero: negative stock is a real signal on the
      // batch that has it and is named there, but subtracting it from another
      // batch's genuine stock would report less PMS on hand than there is.
      if (p.status === 'active') {
        const fuel = fuelLabel(p.productName)
        const bucket = byFuel.get(fuel) || { qty: 0, unit: p.productUnit || 'Litres', batches: 0 }
        bucket.qty += Math.max(0, f.remaining)
        bucket.batches += 1
        byFuel.set(fuel, bucket)
      }

      // A tonne cannot be added to a litre. LPG is bought and sold in metric
      // tonnes, and every quantity total on this page was summing them in
      // alongside litres and labelling the result "L" — a wrong number, not a
      // rounded one. Non-litre batches are counted out and disclosed instead.
      const inLitres = unitNames(p.productUnit).plural === 'Litres'
      if (!inLitres) { otherUnit++; continue }

      remaining += f.remaining
      sold += f.sold

      // Weighted — total cost over total billed quantity, NOT the average of
      // each batch's own landing cost. Averaging per-litre figures would let a
      // small expensive batch pull the portfolio figure as hard as a large
      // cheap one. Only costed batches contribute, and their quantity goes in
      // with their cost, so the numerator and denominator always describe the
      // same set of batches.
      if (f.grandTotalCost != null && f.costQtyLitres) {
        landingCost += f.grandTotalCost
        landingQty += f.costQtyLitres
      }
    }

    // The fuels people actually ask after, in the order they ask — then
    // anything else by how much is left. A fuel with no ACTIVE batch at all
    // does not get a tile; one whose active batches are empty does, because
    // "PMS: 0" is an answer and a missing tile is not.
    const ORDER = ['PMS', 'AGO', 'LPG', 'DPK']
    const fuels = [...byFuel.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => {
        const ai = ORDER.indexOf(a.label)
        const bi = ORDER.indexOf(b.label)
        if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        return b.qty - a.qty
      })

    return {
      cost, revenue, expenses, remaining, deficitCost, costed, uncosted, active, partSold,
      sold, otherUnit, fuels,
      landing: landingQty > 0 ? landingCost / landingQty : null,
      landingQty,
      profit: costed > 0 ? revenue - cost : null,
      count: pfis.length,
    }
  }, [pfis])

  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? s : { key, dir: 'desc' }))
  const toggleSortDir = () => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))

  if (isLoading) return <PageLoader />
  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
      eyebrow="Admin"
      title="PFI Tracking"
      description="Everything about each PFI - what it cost, what you spent moving it, and what it sold for."
      actions={
        <>
          <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadMasterReport(pfis)} disabled={pfis.length === 0}>
          <Download data-icon="inline-start" />
          Full report
          </Button>
          <Button onClick={() => navigate({ to: '/pfi/form', search: { id: '' } as any })}>
          <Plus data-icon="inline-start" />
          New PFI
          </Button>
          </div>
        </>
      }
    />

      {/* The totals below are only as complete as what was fetched. If the
          book ever outgrows the server's own ceiling, that is said here rather
          than left to be discovered by someone reconciling a figure by hand. */}
      {truncated && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Showing <strong>{pfis.length.toLocaleString()}</strong> of{' '}
            <strong>{totalMatching.toLocaleString()}</strong> batches — the totals below cover
            only what is shown. Narrow the filters to bring the rest into view.
          </span>
        </div>
      )}

      <StatCardGrid count={5 + stats.fuels.length}>
        <StatCard
          icon={<Package />} label="Active PFIs" value={stats.active}
          tone="blue"
          description={`of ${stats.count} batch${stats.count === 1 ? '' : 'es'}${hasFilters ? ' matching' : ''}`}
        />
        {/* Stock per fuel, not one number across the book. PMS and AGO are
            bought, priced and sold separately, and the question is always
            "how much PMS is left" — never "how much product". Each is shown
            in its own unit, so an LPG tonnage is never dressed up as litres. */}
        {stats.fuels.map((fuel) => (
          <StatCard
            key={fuel.label}
            icon={<Droplets />}
            label={`${fuel.label} remaining`}
            value={qty(fuel.qty, fuel.unit)}
            tone={fuel.qty > 0 ? 'amber' : 'green'}
            // Says "active" out loud. Without it the figure invites the
            // question of whether closed batches are in there, which is
            // exactly the doubt these tiles exist to remove.
            description={`across ${fuel.batches} active batch${fuel.batches === 1 ? '' : 'es'}`}
          />
        ))}
        {/* <StatCard
          icon={<Lock />} label="Finished batches" value={stats.count - stats.active}
          tone="neutral"
          description={stats.count > 0 ? `${Math.round(((stats.count - stats.active) / stats.count) * 100)}% of portfolio` : 'None yet'}
        /> */}
        <StatCard
          icon={<Banknote />} label="Total cost" value={naira(stats.cost)}
          tone="neutral"
          // An unpriced batch is left out rather than counted as ₦0, so the
          // figure understates the book unless it says how many are missing.
          description={
            stats.uncosted > 0
              ? `${stats.uncosted} batch${stats.uncosted === 1 ? '' : 'es'} not yet priced — excluded`
              : `Cargo + ${naira(stats.expenses)} expenses`
          }
          // description={
          //   stats.uncosted > 0
          //     ? `${stats.uncosted} batch${stats.uncosted === 1 ? '' : 'es'} not yet priced — excluded`
          //     : `Cargo + ${naira(stats.expenses)} expenses`
          // }
        />
        <StatCard
          icon={<Banknote />} label="Total Revenue" value={naira(stats.revenue)}
          tone="blue"
          // description="Invoiced on paid, released, loading and completed orders"
        />
        {/* Sold means payment confirmed, not loaded out — the same rule the
            finance report uses, so this and the Confirmed Orders total are the
            same number by construction. */}
        <StatCard
          icon={<Droplets />} label="Total litres sold" value={litres(stats.sold)}
          tone="blue"
          description={
            stats.otherUnit > 0
              ? `${stats.otherUnit} non-litre batch${stats.otherUnit === 1 ? '' : 'es'} excluded`
              : 'Across every batch, on confirmed-paid orders'
          }
        />
        {/* Weighted across the portfolio — total cost over total billed
            quantity — not the average of each batch's own figure. */}
        <StatCard
          icon={<Gauge />} label="Landing cost / litre" value={naira(stats.landing)}
          tone="neutral"
          description={
            stats.landing == null
              ? 'No batch is priced yet'
              : stats.uncosted > 0
                ? `Over ${litres(stats.landingQty)} billed · ${stats.uncosted} unpriced excluded`
                : `Over ${litres(stats.landingQty)} billed`
          }
        />
        {/* <StatCard
          icon={stats.profit == null || stats.profit === 0 ? <Banknote /> : stats.profit > 0 ? <TrendingUp /> : <TrendingDown />}
          label="Profit / loss" value={naira(stats.profit)}
          tone={stats.profit == null || stats.profit === 0 ? 'neutral' : stats.profit > 0 ? 'green' : 'red'}
          description={stats.uncosted > 0 ? `Across ${stats.costed} costed batch${stats.costed === 1 ? '' : 'es'}` : 'Across the whole portfolio'}
        /> */}
        
      </StatCardGrid>

      {/* A deficit is money paid for product that never arrived, and nothing
          else in the system reports it as a cost. */}
      {/* {stats.deficitCost > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">
            <span className="font-normal text-destructive">{naira(stats.deficitCost)}</span> across this
            portfolio was paid for product that never landed — cargo billed on the BL quantity that did
            not measure into the tank. It is already inside the loss figures, but nothing else names it.
          </p>
        </div>
      )} */}

      <FilterBar>
        <div className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
        className="pl-8" placeholder="Search PFI number, vessel, location…"
        value={search} onChange={(e) => setSearch(e.target.value)}
        />
        </div>
        <NativeSelect className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="finished">Finished</option>
        </NativeSelect>
        {/* Coastal and gantry rows read nothing alike — one has a BL and a
            surplus, the other tickets — so a mixed list needs separating. */}
        <NativeSelect className="w-40" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="all">All types</option>
        <option value="coastal">Coastal</option>
        <option value="gantry">Gantry</option>
        </NativeSelect>
        <div className="flex items-center gap-1">
        <NativeSelect className="w-44" value={sort.key} onChange={(e) => setSortKey(e.target.value as SortKey)}>
        {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
        </NativeSelect>
        <Button
        variant="outline" size="icon" onClick={toggleSortDir}
        title={sort.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        >
        <ArrowUpDown />
        <span className="sr-only">Toggle sort direction</span>
        </Button>
        </div>
        {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus('all'); setType('all') }}>
        <X data-icon="inline-start" />
        Clear
        </Button>
        )}
      </FilterBar>

      {rows.length === 0 ? (
        <div className={cn(PANEL)}>
          <PageEmpty
            icon={<Package />}
            title={hasFilters ? 'No PFIs match those filters' : 'No PFIs yet'}
            description={
              hasFilters
                ? 'Try a different search or status.'
                : 'Create one to start tracking a cargo batch.'
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {/* <p className={cn(MICRO, 'text-muted-foreground')}>
            {rows.length} batch{rows.length === 1 ? '' : 'es'}
            {stats.partSold > 0 && <> · * profit not yet meaningful on {stats.partSold}</>}
          </p> */}

          {/* Dimmed, not replaced. A refetch used to unmount the whole list
              into a spinner; fading it keeps the results readable and makes
              the update obvious without the page appearing to reload. */}
          <div className={cn(
            'grid grid-cols-1 gap-4 transition-opacity duration-250 ease-luxe sm:grid-cols-2 xl:grid-cols-3',
            isFetching && 'opacity-60',
          )}>
            {rows.map((p) => {
              const f = p.financials
              const finished = p.status === 'finished'
              const gantry = f.isGantry
              const uncosted = f.grandTotalCost == null
              const heroLabel = uncosted
                ? 'Cost'
                : f.profitLoss == null || f.profitLoss === 0 ? 'Profit / loss'
                  : f.profitLoss > 0 ? 'Profit' : 'Loss'

              return (
                <div key={p.id} className={cn(PANEL, 'flex flex-col transition-colors duration-250 ease-luxe hover:border-foreground/30')}>
                  <div className="cursor-pointer" onClick={() => setDetailId(Number(p.id))}>
                    <div className={cn(PANEL_RAIL, 'items-start')}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold tracking-tight">{p.pfiNumber}</span>
                          {/* Filled rather than outlined. Two chips sit here
                              side by side and a pair of outlines reads as
                              clutter around the number rather than as state. */}
                          <StatusChip fill="solid" tone={finished ? 'inert' : 'accent'}>
                            {finished ? 'Finished' : 'Active'}
                          </StatusChip>
                          <StatusChip fill="solid" tone="inert">
                            {gantry ? 'Gantry' : 'Coastal'}
                          </StatusChip>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {[p.productName, p.locationName].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 px-6 pt-5 pb-4">
                      <div className={cn('rounded-lg border p-3', profitTint(uncosted ? null : f.profitLoss))}>
                        <p className={cn(MICRO, 'text-muted-foreground')}>{heroLabel}</p>
                        <p
                          className={cn(
                            'mt-1 text-2xl leading-tight font-semibold tracking-tight break-words',
                            uncosted ? 'text-muted-foreground' : moneyTone(f.profitLoss),
                          )}
                        >
                          {uncosted ? 'Awaiting cost data' : naira(f.profitLoss)}
                        </p>
                        {/* A part-sold batch charges full cost against partial
                            revenue, so the figure above is not yet real. */}
                        {/* {!uncosted && !f.profitIsMeaningful && f.sellThrough != null && (
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            Only {Math.round(f.sellThrough * 100)}% sold — full cost is charged against
                            partial revenue, so this is not a real figure yet.
                          </p>
                        )} */}
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                        {/* After any credit note — the figure the landing cost
                            below divides, so the two reconcile by eye. The
                            credit is named underneath rather than folded in
                            silently, or the number would look wrong to anyone
                            holding the invoice. */}
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Total cost</p>
                          <p className="truncate text-sm font-normal">{naira(f.grandTotalCost)}</p>
                          {f.creditBalance > 0 && (
                            <p className="truncate text-xs text-accent">
                              after {naira(f.creditBalance)} credit
                            </p>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{gantry ? 'Sales value' : 'Revenue'}</p>
                          <p className="truncate text-sm font-normal">{naira(f.revenue)}</p>
                        </div>
                        {/* Gantry has one quantity and no papers to differ from
                            it, so the BL and surplus slots go to what it does
                            have: the tickets it was split into. */}
                        {gantry ? (
                          <>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">Quantity</p>
                              <p className="truncate text-sm font-normal">
                                {qty(f.tankQtyLitres, p.productUnit)}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">Tickets</p>
                              <p className="truncate text-sm font-normal">
                                {p.ticketCount == null ? '—' : p.ticketCount.toLocaleString('en-NG')}
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">BL Quantity</p>
                              <p className="truncate text-sm font-normal">{qty(f.blQtyLitres, p.productUnit)}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">Tank Quantity</p>
                              <p className="truncate text-sm font-normal">{qty(f.tankQtyLitres, p.productUnit)}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">Surplus/Deficit</p>
                              <SurplusDeficit
                                litres={f.surplusDeficitLitres} unit={p.productUnit} className="text-sm"
                              />
                            </div>
                          </>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Total Expenses</p>
                          <p className="truncate text-sm font-normal">{naira(f.totalExpenses)}</p>
                        </div>
                        {/* The price the batch was bought at. On gantry there
                            are no shipping papers and the landing cost can
                            read "—" on an unpriced batch, so the rate actually
                            paid is the figure to have in front of you. */}
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            Price / {unitNames(p.productUnit).singular.toLowerCase()}
                          </p>
                          <p className="truncate text-sm font-normal">{naira(f.pricePerLitre)}</p>
                        </div>
                        {/* What one unit of this batch cost, all in — Total
                            Cost ÷ the quantity billed. The number to price
                            against: sell below it and the batch loses money,
                            which is why it is the one figure here in bold. */}
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            Landing cost / {unitNames(p.productUnit).singular.toLowerCase()}
                          </p>
                          <p className="truncate text-sm font-bold text-foreground">
                            {naira(f.landingCostPerLitre)}
                          </p>
                        </div>
                        {/* Sold means payment confirmed, not loaded out. */}
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            Total {unitNames(p.productUnit).plural.toLowerCase()} sold
                          </p>
                          <p className="truncate text-sm font-semibold">
                            {qty(f.sold, p.productUnit)}
                          </p>
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Sales Progress</span>
                          {/* A negative balance is a batch that sold MORE than
                              it held, and printing it as "-754,391 L left"
                              reads as leftover stock to anyone scanning the
                              card — the opposite of what it means. It is named
                              instead. */}
                          {f.remaining < 0 ? (
                            <span className="font-semibold text-destructive">
                              Oversold by {qty(Math.abs(f.remaining), p.productUnit)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {qty(f.remaining, p.productUnit)} left
                            </span>
                          )}
                        </div>
                        <SellThroughBar value={f.sellThrough} />
                        {f.remaining < 0 && (
                          <p className="mt-1.5 text-xs text-destructive">
                            Paid orders exceed what this batch held. Either stock was drawn from
                            elsewhere, or orders belonging to another batch were booked here.
                          </p>
                        )}
                        {/* The balance above counts anything unpaid as unsold,
                            because "sold" means the money landed. Without this
                            line a batch shows stock that is in fact spoken
                            for, and nothing on the card says why. */}
                        {f.remaining >= 0 && f.awaitingPayment > 0 && (
                          <p className="mt-1.5 text-xs text-warning">
                            {qty(f.awaitingPayment, p.productUnit)} of that is on{' '}
                            {f.awaitingPaymentOrders} order{f.awaitingPaymentOrders === 1 ? '' : 's'}{' '}
                            awaiting payment — only {qty(f.trulyUnsold, p.productUnit)} is truly unsold.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(PANEL_FOOTER, 'mt-auto flex-wrap gap-2')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Coloured by what each one does, so the row is scanned
                        by hue rather than read word by word: editing is the
                        ordinary action, closing a batch is irreversible and
                        wears the warning tone, and the report is the one you
                        reach for most so it carries the filled primary. */}
                    <Button
                      variant="secondary" size="sm"
                      onClick={() => navigate({ to: '/pfi/form', search: { id: String(p.id) } as any })}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit details
                    </Button>
                    {!finished && (
                      <Button
                        variant="outline" size="sm"
                        className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                        onClick={() => setClosing(p)}
                      >
                        <Lock data-icon="inline-start" />
                        Close PFI
                      </Button>
                    )}
                    {/* One report, the workbook. The PDF was a second button
                        off the same data for a file nobody asked for twice. */}
                    <Button
                      size="sm" className="ml-auto"
                      onClick={() => downloadPfiReport(Number(p.id))}
                    >
                      <FileSpreadsheet data-icon="inline-start" />
                      Report
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <PfiDetailDialog
        pfiId={detailId}
        open={detailId != null}
        onOpenChange={(o) => !o && setDetailId(null)}
        onDownloadReport={downloadPfiReport}
      />
      <PfiCloseDialog
        pfi={closing}
        open={closing != null}
        onOpenChange={(o) => !o && setClosing(null)}
      />
    </div>
  )
}
