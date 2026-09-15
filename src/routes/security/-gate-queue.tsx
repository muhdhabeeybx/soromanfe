import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { Clock, Droplets, FileText, Loader2, LogIn, Search, Warehouse, X } from 'lucide-react'

import api from '#/lib/api/http'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * The gate's own queue: everything it is waiting on, not one order at a time.
 *
 * Both gate pages could only be used by searching for an order, which assumes
 * the officer already knows which order the truck in front of them belongs to.
 * At the entry gate that is backwards — a truck arrives and they have a plate —
 * and it left the day's workload invisible: nobody could say how many were
 * still expected without opening orders one by one.
 *
 * The search stays. It is the right tool when the paperwork is in hand; this is
 * the right one when it is not.
 */

export interface GateTruck {
  id: number
  truckNumber: string | null
  truckIndex: number | null
  truckStatus: string
  quantity: number | null
  driverName: string | null
  driverPhone: string | null
  enteredAt: string | null
  orderId: number
  orderNumber: string | null
  orderStatus: string
  customerName: string | null
  depotId: number | null
  depotName: string | null
  pfiId: number | null
  pfiNumber: string | null
  productUnit: string | null
  waitingSince: string | null
  hoursWaiting: number
}

interface GateQueueResponse {
  stage: 'entry' | 'exit'
  trucks: GateTruck[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: {
    /** What the live-batch filter is leaving out, so the toggle can say. */
    offLiveBatches: number
    trucks: number
    orders: number
    customers: number
    litres: number
    oldestHours: number
    overADay: number
    byDepot: Array<{ depotName: string; trucks: number }>
  }
  options: {
    depots: Array<{ id: number; name: string }>
    pfis: Array<{ id: number; pfiNumber: string }>
  }
}

interface Filters {
  from: string
  to: string
  depotId: string
  pfiId: string
  search: string
}

const EMPTY: Filters = { from: '', to: '', depotId: 'all', pfiId: 'all', search: '' }

function useGateQueue(stage: 'entry' | 'exit', f: Filters, page: number) {
  return useQuery({
    queryKey: ['gate-queue', stage, f, page],
    // The gate is worked live; a stale list sends somebody to a truck that has
    // already gone through.
    staleTime: 15_000,
    queryFn: async (): Promise<GateQueueResponse> => {
      const res = await api.get(`/orders/gate-queue/${stage}`, {
        params: {
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
          ...(f.depotId !== 'all' ? { depotId: f.depotId } : {}),
          ...(f.pfiId !== 'all' ? { pfiId: f.pfiId } : {}),
          ...(f.search.trim() ? { search: f.search.trim() } : {}),
          page,
          limit: 100,
        },
      })
      return res.data.data as GateQueueResponse
    },
  })
}

/** "3 days" reads better than "72 hours" on a queue this old. */
const waited = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} days` : `${h}h`)

const num = (n: number) => Number(n || 0).toLocaleString('en-NG')

export function GateQueue({
  stage, onPick,
}: {
  stage: 'entry' | 'exit'
  /** Clicking a row hands the order to the page's existing search-and-act flow. */
  onPick: (t: GateTruck) => void
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching } = useGateQueue(stage, filters, page)

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [k]: v }))
    setPage(1)
  }

  const s = data?.summary
  const dirty = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(EMPTY),
    [filters],
  )

  const noun = stage === 'entry' ? 'Awaiting entry' : 'On the yard'
  const unit = data?.trucks[0]?.productUnit || 'Litres'

  return (
    <div className="space-y-4">
      <StatCardGrid count={4}>
        <StatCard
          // The icon says which gate this is at a glance — arriving, or still
          // standing on the yard.
          icon={stage === 'entry' ? <LogIn /> : <Warehouse />}
          label={noun}
          value={num(s?.trucks ?? 0)}
          tone={s?.trucks ? 'amber' : 'green'}
        />
        <StatCard icon={<FileText />} label="Orders" value={num(s?.orders ?? 0)} tone="neutral" />
        {/* Customers was the fifth card and is the one the gate does not act
            on: an officer needs to know how many trucks, carrying how much,
            and how long they have stood — not how many accounts they span.
            The figure is still on the payload if it is ever wanted. */}
        <StatCard icon={<Droplets />} label={unit} value={num(s?.litres ?? 0)} tone="blue" />
        {/* Age is the thing that decides whether a queue is a queue or a
            problem. Twenty trucks that arrived this morning is a normal
            shift; twenty that have been standing a week is not. */}
        <StatCard
          icon={<Clock />}
          label="Over a day"
          value={num(s?.overADay ?? 0)}
          tone={s?.overADay ? 'red' : 'green'}
          description={s?.oldestHours ? `oldest ${waited(s.oldestHours)}` : undefined}
        />
      </StatCardGrid>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Filters</span>
          {dirty && (
            <Button
              variant="ghost" size="sm" className="ml-auto"
              onClick={() => { setFilters(EMPTY); setPage(1) }}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
        <div className={cn(PANEL_BODY, 'space-y-3')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Plate, order, customer, driver…"
                value={filters.search}
                onChange={(e) => set('search', e.target.value)}
              />
            </div>
            <Input
              type="date" value={filters.from} max={filters.to || undefined}
              onChange={(e) => set('from', e.target.value)}
            />
            <Input
              type="date" value={filters.to} min={filters.from || undefined}
              onChange={(e) => set('to', e.target.value)}
            />
            <NativeSelect value={filters.depotId} onChange={(e) => set('depotId', e.target.value)}>
              <option value="all">All locations</option>
              {data?.options.depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect value={filters.pfiId} onChange={(e) => set('pfiId', e.target.value)}>
              <option value="all">All PFIs</option>
              {data?.options.pfis.map((p) => (
                <option key={p.id} value={p.id}>{p.pfiNumber}</option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: 'Today', from: format(new Date(), 'yyyy-MM-dd') },
              { label: 'Last 7 days', from: format(subDays(new Date(), 6), 'yyyy-MM-dd') },
              { label: 'Last 30 days', from: format(subDays(new Date(), 29), 'yyyy-MM-dd') },
            ].map((p) => (
              <Button
                key={p.label}
                variant={filters.from === p.from && !filters.to ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setFilters((f) => ({ ...f, from: p.from, to: '' })); setPage(1) }}
              >
                {p.label}
              </Button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {isFetching && <Loader2 className="mr-1 inline size-3 animate-spin" />}
              {num(data?.pagination.total ?? 0)} truck{data?.pagination.total === 1 ? '' : 's'}
            </span>
          </div>

          {/* Where the queue actually is. Chips rather than a run-on sentence,
              and each one filters — the depot breakdown was the thing a
              supervisor read first and then had to go and set the dropdown to
              act on, so it may as well be the control. */}
          {(s?.byDepot?.length ?? 0) > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {s?.byDepot.map((d) => {
                const id = data?.options.depots.find((x) => x.name === d.depotName)?.id
                const active = id != null && String(id) === filters.depotId
                return (
                  <button
                    key={d.depotName}
                    type="button"
                    disabled={id == null}
                    onClick={() => set('depotId', active ? 'all' : String(id))}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-transparent bg-foreground text-background'
                        : 'border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      id == null && 'cursor-default opacity-60',
                    )}
                  >
                    {d.depotName}
                    <span className={cn('font-semibold', !active && 'text-foreground')}>
                      {d.trucks}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>{noun}</span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin" /></div>
        ) : !data?.trucks.length ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {dirty
              ? 'Nothing matches these filters.'
              : stage === 'entry'
                ? 'No trucks are expected at the gate.'
                : 'The yard is clear.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>PFI</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Waiting</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trucks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {t.truckNumber || '—'}
                        {t.truckIndex ? (
                          <span className="ml-1 text-xs text-muted-foreground">#{t.truckIndex}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{t.orderNumber || '—'}</TableCell>
                      <TableCell className="max-w-[16rem] truncate" title={t.customerName || undefined}>
                        {t.customerName || '—'}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate" title={t.depotName || undefined}>
                        {t.depotName || '—'}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate" title={t.pfiNumber || undefined}>
                        {t.pfiNumber || '—'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {t.quantity == null ? '—' : num(t.quantity)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right whitespace-nowrap',
                          t.hoursWaiting >= 24 && 'font-medium text-amber-600 dark:text-amber-500',
                        )}
                        title={t.waitingSince ? format(new Date(t.waitingSince), 'd MMM yyyy, HH:mm') : undefined}
                      >
                        {waited(t.hoursWaiting)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => onPick(t)}>
                          {stage === 'entry' ? 'Record entry' : 'Record exit'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data.pagination.pages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-foreground/10 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">
                  Page {data.pagination.page} of {data.pagination.pages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={page >= data.pagination.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
