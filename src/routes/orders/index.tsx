import { Fragment, useMemo, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Package, CheckCircle2, Clock, DollarSign, Droplets, Truck, Hourglass,
  Search, Plus, X, RefreshCw, FileSpreadsheet, FileText, Eye, Pencil,
  Trash2,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '#/components/ui/select'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { PANEL, MICRO, PANEL_RAIL } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useAllOrders } from '#/lib/hooks/useOrders'
import { routeGuard } from '#/lib/route-guard'

import {
  DATE_PRESETS, resolveRange, toNumber, formatNaira, formatQty, isPaid, isVoidOrder, groupByDay,
  type DatePreset,
} from './-orders-utils'
import { OrderStatusBadge } from './-order-status'
import { OrderExpiryBadge } from './-order-expiry'
import { useDeleteOrder } from '#/lib/hooks/useOrders'
import { useRoles } from '#/lib/hooks/useRoles'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { OrderDetailsDialog, OrderEditDialog } from './-order-dialogs'
import { exportOrdersExcel, exportOrdersPdf } from './-order-exports'

export const Route = createFileRoute('/orders/')({
  beforeLoad: () => routeGuard('/orders'),
  component: OrdersDashboard,
})

const ALL = 'all'

/** A removable active-filter chip. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs uppercase">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-250 ease-luxe outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-2.5" />
        <span className="sr-only">Remove {label} filter</span>
      </button>
    </span>
  )
}

function OrdersDashboard() {
  const navigate = useNavigate()

  const [searchTerm, setSearchTerm] = useState('')
  // Opens on the month, not the day: order volume is low enough that
  // "Today" is usually empty, which reads as a broken page rather than a
  // quiet day. Change to 'today' if you'd rather it open narrow.
  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const deleteOrderMutation = useDeleteOrder()
  // Deleting an order destroys its payment trail, so the server restricts it
  // to super_admin; the button follows the same rule rather than offering
  // something that will 403.
  const { isSuperAdmin: canDelete } = useRoles()
  const [deleteTarget, setDeleteTarget] = useState<any>(null)

  const [locationFilter, setLocationFilter] = useState(ALL)
  const [productFilter, setProductFilter] = useState(ALL)
  const [pfiFilter, setPfiFilter] = useState(ALL)

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [detailsOrder, setDetailsOrder] = useState<any | null>(null)
  const [editOrder, setEditOrder] = useState<any | null>(null)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  // Filtering and the summary totals run client-side so the cards can
  // recalculate against the filtered set, which needs the whole result.
  const { data, isLoading, isError, error, refetch, isFetching } = useAllOrders()
  const orders: any[] = data?.orders || []
  const isTruncated = data?.truncated === true
  const totalAvailable = data?.totalAvailable ?? orders.length

  // Dropdowns are populated from the data actually present.
  const options = useMemo(() => {
    const uniq = (vals: (string | undefined | null)[]) =>
      [...new Set(vals.filter((v): v is string => Boolean(v)))].sort()
    return {
      statuses: uniq(orders.map((o) => o.status)),
      locations: uniq(orders.map((o) => o.depotName || o.state)),
      products: uniq(orders.map((o) => o.productName)),
      pfis: uniq(orders.map((o) => o.pfiNumber)),
    }
  }, [orders])

  const range = useMemo(
    () =>
      resolveRange(datePreset, {
        from: customFrom ? new Date(customFrom) : undefined,
        to: customTo ? new Date(customTo) : undefined,
      }),
    [datePreset, customFrom, customTo],
  )

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return orders.filter((o) => {
      if (range) {
        if (!o.createdAt) return false
        if (!isWithinInterval(new Date(o.createdAt), { start: range.from, end: range.to })) return false
      }
      if (statusFilter !== ALL && o.status !== statusFilter) return false
      if (locationFilter !== ALL && (o.depotName || o.state) !== locationFilter) return false
      if (productFilter !== ALL && o.productName !== productFilter) return false
      if (pfiFilter !== ALL && o.pfiNumber !== pfiFilter) return false
      if (!q) return true
      return [
        o.orderNumber, o.customerName, o.companyName, o.customerCompanyName, o.customerPhone,
        o.depotName, o.state, o.productName, o.pfiNumber, o.id, o._id,
      ].some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [orders, range, statusFilter, locationFilter, productFilter, pfiFilter, searchTerm])

  // Every figure below recalculates against the filtered set.
  const totals = useMemo(() => {
    const paid = filtered.filter(isPaid)
    // Released and everything past it counts as released — once stock leaves
    // the depot it does not come back to Paid.
    const released = filtered.filter((o) =>
      ['Released', 'Loading', 'Completed'].includes(String(o.status)),
    )
    const loading = filtered.filter((o) => String(o.status) === 'Loading')
    const expired = filtered.filter((o) => String(o.status) === 'Expired')
    // Cancelled and expired orders are dead — their litres were never going
    // to move, so counting them inflated "total qty ordered" against a
    // volume that no depot will ever release.
    const live = filtered.filter((o) => !isVoidOrder(o))
    return {
      count: filtered.length,
      paidCount: paid.length,
      unpaidCount: filtered.length - paid.length,
      expiredCount: expired.length,
      voidCount: filtered.length - live.length,
      qty: live.reduce((s, o) => s + toNumber(o.quantity), 0),
      amount: filtered.reduce((s, o) => s + toNumber(o.totalAmount), 0),
      amountPaid: paid.reduce((s, o) => s + toNumber(o.totalAmount), 0),
      releasedCount: released.length,
      releasedQty: released.reduce((s, o) => s + toNumber(o.quantity), 0),
      releasedValue: released.reduce((s, o) => s + toNumber(o.totalAmount), 0),
      loadingCount: loading.length,
      loadingQty: loading.reduce((s, o) => s + toNumber(o.quantity), 0),
    }
  }, [filtered])

  const activeChips = [
    searchTerm && { label: `Search: ${searchTerm}`, clear: () => setSearchTerm('') },
    datePreset !== 'all' && {
      label: DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? 'Custom range',
      clear: () => setDatePreset('all'),
    },
    statusFilter !== ALL && { label: statusFilter, clear: () => setStatusFilter(ALL) },
    locationFilter !== ALL && { label: locationFilter, clear: () => setLocationFilter(ALL) },
    productFilter !== ALL && { label: productFilter, clear: () => setProductFilter(ALL) },
    pfiFilter !== ALL && { label: `PFI ${pfiFilter}`, clear: () => setPfiFilter(ALL) },
  ].filter(Boolean) as { label: string; clear: () => void }[]

  const clearAll = () => {
    setSearchTerm(''); setDatePreset('all'); setStatusFilter(ALL)
    setLocationFilter(ALL); setProductFilter(ALL); setPfiFilter(ALL)
    setCustomFrom(''); setCustomTo(''); setCurrentPage(1)
  }

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1)
  const page = Math.min(currentPage, totalPages)
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Subtotal rows only earn their place when more than one day is on screen —
  // with a single day they would just restate the summary cards.
  const dayGroups = useMemo(() => groupByDay(paginated), [paginated])
  const showSubtotals = dayGroups.size > 1

  const runExport = async (kind: 'excel' | 'pdf') => {
    setExporting(kind)
    try {
      const filters = { pfi: pfiFilter, location: locationFilter }
      if (kind === 'excel') await exportOrdersExcel(filtered, filters)
      else await exportOrdersPdf(filtered, filters)
    } finally {
      setExporting(null)
    }
  }

  let serial = (page - 1) * pageSize

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
      eyebrow="Orders"
      title="Orders Overview"
      description="Every customer product order, its payment status and fulfilment status."
      actions={
        <>
          <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
          Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => runExport('excel')} disabled={exporting !== null}>
          <FileSpreadsheet />
          {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => runExport('pdf')} disabled={exporting !== null}>
          <FileText />
          {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </Button>
          <Button size="sm" onClick={() => navigate({ to: '/admin-order' as any })}>
          <Plus data-icon="inline-start" />
          Place new order
          </Button>
          </div>
        </>
      }
    />

      {isLoading ? (
        <PageLoader message="Loading orders…" />
      ) : isError ? (
        <PageError message={(error as any)?.message || 'Could not load orders.'} onRetry={() => refetch()} />
      ) : (
        <>
          <StatCardGrid count={7}>
            <StatCard
              icon={<Package />} label="Total orders" value={formatQty(totals.count)}
              // description={`${formatQty(totals.paidCount)} paid & ${formatQty(totals.releasedCount)} released`}
            />
            <StatCard
              // Goes amber the moment anything is unconfirmed.
              tone={totals.unpaidCount > 0 ? 'amber' : 'green'}
              icon={<Clock />} label="Payment not confirmed" value={formatQty(totals.unpaidCount)}
              // description={totals.unpaidCount > 0 ? 'Awaiting confirmation' : 'All confirmed'}
            />
            <StatCard
              tone={totals.expiredCount > 0 ? 'red' : undefined}
              icon={<Hourglass />} label="Expired Orders" value={formatQty(totals.expiredCount)}
              // description={totals.expiredCount > 0 ? 'Unpaid & lapsed' : 'None'}
            />
            <StatCard
              icon={<Droplets />} label="Total qty ordered"
              value={
                <>
                  {formatQty(totals.qty)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">L</span>
                </>
              }
              // Says so on the card rather than leaving a reader to wonder why
              // the litres do not add up to the rows on screen.
              description={totals.voidCount > 0
                ? `Excludes ${formatQty(totals.voidCount)} cancelled/expired`
                : undefined}
            />
            <StatCard
              icon={<DollarSign />} label="Total revenue" value={formatNaira(totals.amount)}
              // description={`${formatNaira(totals.amountPaid)} paid`}
            />
            {/* Loading is a status, not a truck-ticket count — see the note in
                -orders-utils. It is the closest honest figure available. */}
            <StatCard
              icon={<Truck />} label="Currently Loading" 
              value={
                <>
                  {formatQty(totals.loadingQty)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">L</span>
                </>
              }
              // description={`${formatQty(totals.loadingQty)} L on trucks`}
            />
            {/* <StatCard
              icon={<CheckCircle2 />} label="Released qty"
              value={
                <>
                  {formatQty(totals.releasedQty)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">L</span>
                </>
              }
              description={`${formatNaira(totals.releasedValue)} released`}
            /> */}
          </StatCardGrid>

          {/* {isTruncated && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
              <p className="font-semibold">Showing {orders.length.toLocaleString()} of {totalAvailable.toLocaleString()} orders</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Data is capped at 5,000 orders. Use filters to narrow results or export the full dataset from the backend.
              </p>
            </div>
          )} */}

          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>Filters</span>
              {activeChips.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-accent underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="space-y-4 px-6 pt-5 pb-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                  placeholder="Search order reference, customer or location…"
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {DATE_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => { setDatePreset(p.value); setCurrentPage(1) }}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        datePreset === p.value
                          ? 'border-accent/40 bg-accent/10 text-accent'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Input
                    type="date" value={customFrom} aria-label="Custom range start"
                    onChange={(e) => { setCustomFrom(e.target.value); setDatePreset('custom'); setCurrentPage(1) }}
                    className="h-7 w-[9.5rem] text-xs"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date" value={customTo} aria-label="Custom range end"
                    onChange={(e) => { setCustomTo(e.target.value); setDatePreset('custom'); setCurrentPage(1) }}
                    className="h-7 w-[9.5rem] text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ['All statuses', statusFilter, setStatusFilter, options.statuses],
                  ['All locations', locationFilter, setLocationFilter, options.locations],
                  ['All products', productFilter, setProductFilter, options.products],
                  ['All PFIs', pfiFilter, setPfiFilter, options.pfis],
                ] as const).map(([label, value, setter, list]) => (
                  <Select
                    key={label}
                    value={value}
                    onValueChange={(v) => { (setter as (s: string) => void)(v); setCurrentPage(1) }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={label} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{label}</SelectItem>
                      {list.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
              </div>

              {activeChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {activeChips.map((c) => (
                    <FilterChip key={c.label} label={c.label} onClear={c.clear} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>
                {formatQty(filtered.length)} order{filtered.length === 1 ? '' : 's'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatNaira(totals.amount)}
              </span>
            </div>

            {filtered.length === 0 ? (
              <PageEmpty
                title="No orders match these filters"
                description="Widen the date range or clear a filter to see more."
                hasFilters={activeChips.length > 0}
                onClearFilters={clearAll}
              />
            ) : (
              <div className="px-2 pb-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">S/N</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Qty (L)</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>PFI</TableHead>
                      <TableHead>Status</TableHead>
                      {/* <TableHead className="text-right">Actions</TableHead> */}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...dayGroups.entries()].map(([day, rows]) => (
                      <Fragment key={day}>
                        {rows.map((o: any) => {
                          serial += 1
                          return (
                            <TableRow key={o.id ?? o._id}>
                              <TableCell className="text-muted-foreground">{serial}</TableCell>
                              <TableCell className="font-semibold text-accent">{o.orderNumber}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {o.createdAt ? format(new Date(o.createdAt), 'd MMM yyyy') : '—'}
                              </TableCell>
                              <TableCell>
                                <span className="block max-w-[14rem] truncate font-medium uppercase">{o.customerName || '—'}</span>
                                {(o.companyName || o.customerCompanyName) && (
                                  <span className="block max-w-[14rem] truncate uppercase text-xs text-muted-foreground">
                                    {o.companyName || o.customerCompanyName}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{o.customerPhone || '—'}</TableCell>
                              <TableCell>{o.depotName || o.state || '—'}</TableCell>
                              <TableCell className="text-right font-medium">{formatQty(toNumber(o.quantity))}</TableCell>
                              <TableCell className="text-right">{formatNaira(toNumber(o.price))}</TableCell>
                              <TableCell className="text-right font-semibold">{formatNaira(toNumber(o.totalAmount))}</TableCell>
                              <TableCell className="text-muted-foreground max-w-[14rem] truncate ">{o.pfiNumber || '—'}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <OrderStatusBadge status={o.status} />
                                  <OrderExpiryBadge status={o.status} expiresAt={o.expiresAt} expiredAt={o.expiredAt} />
                                </div>
                              </TableCell>
                              
                              {/* <TableCell>
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button variant="ghost" size="icon-sm" onClick={() => setDetailsOrder(o)}>
                                    <Eye />
                                    <span className="sr-only">View {o.orderNumber}</span>
                                  </Button>
                                  {canDelete && (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      onClick={() => setDeleteTarget(o)}
                                    >
                                      <Trash2 />
                                      <span className="sr-only">Delete {o.orderNumber}</span>
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon-sm" onClick={() => setEditOrder(o)}>
                                    <Pencil />
                                    <span className="sr-only">Edit {o.orderNumber}</span>
                                  </Button>
                                </div>
                              </TableCell> */}
                            </TableRow>
                          )
                        })}

                        {showSubtotals && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={6} className={cn(MICRO, 'text-xs text-muted-foreground')}>
                              {day} · {rows.length} order{rows.length === 1 ? '' : 's'}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatQty(rows.reduce((s: number, r: any) => s + toNumber(r.quantity), 0))}
                            </TableCell>
                            <TableCell />
                            <TableCell className="text-right font-semibold">
                              {formatNaira(rows.reduce((s: number, r: any) => s + toNumber(r.totalAmount), 0))}
                            </TableCell>
                            <TableCell colSpan={3} />
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>

                <div className="px-4">
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    totalItems={filtered.length}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(s) => { setPageSize(s); setCurrentPage(1) }}
                  />
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <OrderDetailsDialog
        order={detailsOrder}
        open={detailsOrder !== null}
        onOpenChange={(o) => { if (!o) setDetailsOrder(null) }}
      />
      <OrderEditDialog
        order={editOrder}
        open={editOrder !== null}
        onOpenChange={(o) => { if (!o) setEditOrder(null) }}
      />
      {/* Names what goes with it. This is not a cancel — nothing is recoverable
          afterwards except the audit entry. */}
      <Dialog open={deleteTarget != null} onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.orderNumber}?</DialogTitle>
            <DialogDescription>
              <span className="block space-y-2">
                <span className="block">
                  This permanently removes the order and everything attached to it — its
                  tickets, allocated trucks, commissions, wallet holds and stock movements.
                </span>
                {deleteTarget?.paymentStatus === 'Paid' && (
                  <span className="mt-2 block rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-destructive">
                    This order is paid. Deleting it also removes its payment trail, so any
                    wallet debit behind it can no longer be reconciled.
                  </span>
                )}
                <span className="block">Only the audit entry survives. This cannot be undone.</span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={deleteOrderMutation.isPending}
              onClick={async () => {
                await deleteOrderMutation.mutateAsync(deleteTarget.id ?? deleteTarget._id)
                setDeleteTarget(null)
              }}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
