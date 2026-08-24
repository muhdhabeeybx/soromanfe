import { useState, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Search, Plus, Package, Banknote, Droplets, TriangleAlert,
  ArrowUpDown, Lock, Pencil, Download, X, TrendingUp, TrendingDown,
  FileSpreadsheet, FileText,
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
  naira, litres, moneyTone, profitTint, SurplusDeficit, SellThroughBar,
} from '#/routes/pfi/-pfi-utils'
import { downloadPfiReport, downloadPfiReportPdf, downloadMasterReport } from '#/routes/pfi/-pfi-report'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/pfi/')({
  beforeLoad: () => routeGuard('/pfi'),
  component: PFIDashboard,
})

type SortKey = 'pfiNumber' | 'cost' | 'revenue' | 'profit' | 'remaining' | 'sellThrough'

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'profit', label: 'Profit / loss' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'cost', label: 'Total cost' },
  { key: 'remaining', label: 'Stock remaining' },
  { key: 'sellThrough', label: 'Sell-through' },
  { key: 'pfiNumber', label: 'PFI number' },
]

/**
 * Null for an unpriced batch, which is not the same as a low value — sorting
 * one as if it were the worst loss in the book would put the batches nobody
 * has costed at the top of a list about money.
 */
function sortValue(p: PfiWithFinancials, key: SortKey): number | string | null {
  const f = p.financials
  switch (key) {
    case 'pfiNumber': return p.pfiNumber || ''
    case 'cost': return f.totalCost
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'profit', dir: 'asc' })
  const [detailId, setDetailId] = useState<number | null>(null)
  const [closing, setClosing] = useState<PfiWithFinancials | null>(null)

  const { data, isLoading, isError, error, refetch } = usePfiList({
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
  })

  const pfis = (data?.pfis || []) as PfiWithFinancials[]
  const hasFilters = !!search || status !== 'all'

  const rows = useMemo(() => {
    const list = [...pfis]
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
    for (const p of pfis) {
      const f = p.financials
      revenue += f.revenue
      expenses += f.totalExpenses
      remaining += f.remaining
      if (f.deficitCost != null) deficitCost += f.deficitCost
      if (f.totalCost != null) { cost += f.totalCost; costed++ } else uncosted++
      if (p.status === 'active') active++
      if (!f.profitIsMeaningful && f.sellThrough != null) partSold++
    }
    return {
      cost, revenue, expenses, remaining, deficitCost, costed, uncosted, active, partSold,
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

      <StatCardGrid count={2}>
        <StatCard
          icon={<Package />} label="Active PFIs" value={stats.active}
          tone="blue"
          // description={`${stats.count} total`}
        />
        <StatCard
          icon={<Droplets />} label="Quantity remaining" value={litres(stats.remaining)}
          tone={stats.remaining > 0 ? 'amber' : 'green'}
          // description={
          //   stats.partSold > 0
          //     ? `${stats.partSold} batch${stats.partSold === 1 ? '' : 'es'} part-sold — profit not yet real`
          //     : 'Every batch fully sold'
          // }
        />
        {/* <StatCard
          icon={<Lock />} label="Finished batches" value={stats.count - stats.active}
          tone="neutral"
          description={stats.count > 0 ? `${Math.round(((stats.count - stats.active) / stats.count) * 100)}% of portfolio` : 'None yet'}
        /> */}
        <StatCard
          icon={<Banknote />} label="Total cost" value={naira(stats.cost)}
          tone="neutral"
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
        <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus('all') }}>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((p) => {
              const f = p.financials
              const finished = p.status === 'finished'
              const uncosted = f.totalCost == null
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
                          <span className="font-semibold">{p.pfiNumber}</span>
                          <StatusChip tone={finished ? 'inert' : 'accent'}>
                            {finished ? 'Finished' : 'Active'}
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
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Total cost</p>
                          <p className="truncate text-sm font-normal">{naira(f.totalCost)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Revenue</p>
                          <p className="truncate text-sm font-normal">{naira(f.revenue)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">BL Quantity</p>
                          <p className="truncate text-sm font-normal">{litres(f.blQtyLitres)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Tank Quantity</p>
                          <p className="truncate text-sm font-normal">{litres(f.tankQtyLitres)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Surplus/Deficit</p>
                          <SurplusDeficit litres={f.surplusDeficitLitres} className="text-sm" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Total Expenses</p>
                          <p className="truncate text-sm font-normal">{naira(f.totalExpenses)}</p>
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Sales Progress</span>
                          <span>{litres(f.remaining)} left</span>
                        </div>
                        <SellThroughBar value={f.sellThrough} />
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(PANEL_FOOTER, 'mt-auto flex-wrap gap-2')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="outline" size="sm"
                      onClick={() => navigate({ to: '/pfi/form', search: { id: String(p.id) } as any })}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit details
                    </Button>
                    {!finished && (
                      <Button variant="outline" size="sm" onClick={() => setClosing(p)}>
                        <Lock data-icon="inline-start" />
                        Close PFI
                      </Button>
                    )}
                    {/* Excel and PDF off the same data — the workbook is for
                        working with, the PDF for circulating. */}
                    <Button
                      variant="outline" size="sm" className="ml-auto"
                      onClick={() => downloadPfiReport(Number(p.id))}
                    >
                      <FileSpreadsheet data-icon="inline-start" />
                      Excel
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => downloadPfiReportPdf(Number(p.id))}
                    >
                      <FileText data-icon="inline-start" />
                      PDF
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
