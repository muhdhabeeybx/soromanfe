import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Search, X, RefreshCw, Pencil, Eye, Trash2, Wallet, Fuel, Package,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { FilterBar } from '#/components/FilterBar'
import { PANEL, PANEL_RAIL, MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useAllOrders, useDeleteOrder } from '#/lib/hooks/useOrders'
import { useRoles } from '#/lib/hooks/useRoles'
import { routeGuard } from '#/lib/route-guard'
import {
  DATE_PRESETS, resolveRange, toNumber, formatNaira, formatQty, type DatePreset,
} from '#/routes/orders/-orders-utils'
import { OrderStatusBadge, PaymentBadge } from '#/routes/orders/-order-status'
import { OrderDetailsDialog, OrderEditDialog } from '#/routes/orders/-order-dialogs'

export const Route = createFileRoute('/order-management/')({
  beforeLoad: () => routeGuard('/order-management'),
  component: OrderManagementPage,
})

const ALL = 'all'

/**
 * All Orders, but built for correcting them rather than reading them.
 *
 * The list page next door is a register — it opens on the month, groups by
 * day, carries subtotals and exports. This one exists for the other job:
 * finding one order that is wrong and fixing it. So it opens on everything,
 * leads with what usually needs correcting (customer, PFI, date, quantity,
 * price) and puts Edit on every row rather than behind a details page.
 *
 * The editing itself is the same OrderEditDialog the register uses — one
 * form, one set of rules about what may change at which status, and one
 * place the wallet-hold and stock-reservation consequences are explained.
 */
function OrderManagementPage() {
  const [search, setSearch] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [paymentFilter, setPaymentFilter] = useState(ALL)
  const [locationFilter, setLocationFilter] = useState(ALL)
  const [pfiFilter, setPfiFilter] = useState(ALL)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)

  const [editing, setEditing] = useState<any | null>(null)
  const [viewing, setViewing] = useState<any | null>(null)
  const [deleting, setDeleting] = useState<any | null>(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useAllOrders()
  const { isSuperAdmin: canDelete } = useRoles()
  const deleteOrder = useDeleteOrder()

  const orders: any[] = useMemo(() => data?.orders || [], [data])

  const options = useMemo(() => {
    const uniq = (v: (string | null | undefined)[]) =>
      [...new Set(v.filter((x): x is string => Boolean(x)))].sort()
    return {
      statuses: uniq(orders.map((o) => o.status)),
      locations: uniq(orders.map((o) => o.depotName || o.state)),
      pfis: uniq(orders.map((o) => o.pfiNumber)),
    }
  }, [orders])

  const range = useMemo(() => resolveRange(datePreset), [datePreset])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (range) {
        if (!o.createdAt) return false
        if (!isWithinInterval(new Date(o.createdAt), { start: range.from, end: range.to })) return false
      }
      if (statusFilter !== ALL && o.status !== statusFilter) return false
      if (paymentFilter !== ALL && o.paymentStatus !== paymentFilter) return false
      if (locationFilter !== ALL && (o.depotName || o.state) !== locationFilter) return false
      if (pfiFilter !== ALL && o.pfiNumber !== pfiFilter) return false
      if (!q) return true
      return [
        o.orderNumber, o.customerName, o.companyName, o.customerCompanyName,
        o.customerPhone, o.depotName, o.state, o.productName, o.pfiNumber,
      ].some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [orders, range, statusFilter, paymentFilter, locationFilter, pfiFilter, search])

  const hasFilters =
    !!search || datePreset !== 'all' || statusFilter !== ALL ||
    paymentFilter !== ALL || locationFilter !== ALL || pfiFilter !== ALL

  const clearAll = () => {
    setSearch(''); setDatePreset('all'); setStatusFilter(ALL)
    setPaymentFilter(ALL); setLocationFilter(ALL); setPfiFilter(ALL); setPage(1)
  }

  // What is actually correctable right now, so the desk can see at a glance
  // how much of the book is still open to change. Mirrors the rules the edit
  // dialog enforces (see order.service.js's updateOrder).
  const totals = useMemo(() => {
    const locked = filtered.filter((o) => ['Completed', 'Cancelled', 'Expired'].includes(String(o.status)))
    const stockEditable = filtered.filter((o) => ['Pending', 'Paid'].includes(String(o.status)))
    return {
      count: filtered.length,
      editable: filtered.length - locked.length,
      stockEditable: stockEditable.length,
      value: filtered.reduce((s, o) => s + toNumber(o.totalAmount), 0),
    }
  }, [filtered])

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1)
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize)

  if (isLoading) return <PageLoader message="Loading orders…" />
  if (isError) {
    return <PageError message={(error as any)?.message || 'Could not load orders.'} onRetry={() => refetch()} />
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Orders"
        title="Manage Orders"
        description="Find an order and correct it — reassign the customer or PFI, change the date, quantity or price. Changes carry through to the wallet hold and the batch's stock."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <StatCardGrid count={4}>
        <StatCard icon={<Package />} label="Orders in view" value={formatQty(totals.count)} />
        <StatCard icon={<Pencil />} label="Still editable" value={formatQty(totals.editable)} description="Not completed, cancelled or expired" />
        <StatCard icon={<Fuel />} label="Quantity / PFI editable" value={formatQty(totals.stockEditable)} description="Not yet released for loading" />
        <StatCard icon={<Wallet />} label="Value in view" value={formatNaira(totals.value)} />
      </StatCardGrid>

      <FilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search reference, customer, company, phone, location or PFI…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <NativeSelect className="w-36" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value={ALL}>All statuses</option>
          {options.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
        <NativeSelect className="w-36" value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(1) }}>
          <option value={ALL}>Any payment</option>
          <option value="Paid">Paid</option>
          <option value="Part Paid">Part Paid</option>
          <option value="Unpaid">Unpaid</option>
        </NativeSelect>
        <NativeSelect className="w-44" value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1) }}>
          <option value={ALL}>All locations</option>
          {options.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </NativeSelect>
        <NativeSelect className="w-44" value={pfiFilter} onChange={(e) => { setPfiFilter(e.target.value); setPage(1) }}>
          <option value={ALL}>All PFIs</option>
          {options.pfis.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <div className="flex flex-wrap items-center gap-1.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => { setDatePreset(p.value); setPage(1) }}
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
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            {formatQty(filtered.length)} order{filtered.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-muted-foreground">{formatNaira(totals.value)}</span>
        </div>

        {filtered.length === 0 ? (
          <PageEmpty
            title="No orders match these filters"
            description="Widen the date range or clear a filter to see more."
            hasFilters={hasFilters}
            onClearFilters={clearAll}
          />
        ) : (
          <div className="px-2 pb-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">S/N</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>PFI</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty (L)</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o, i) => {
                    const locked = ['Completed', 'Cancelled', 'Expired'].includes(String(o.status))
                    return (
                      <TableRow key={o.id ?? o._id}>
                        <TableCell className="text-muted-foreground">
                          {(current - 1) * pageSize + i + 1}
                        </TableCell>
                        <TableCell className="font-semibold whitespace-nowrap text-accent">{o.orderNumber}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {o.createdAt ? format(new Date(o.createdAt), 'd MMM yyyy') : '—'}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate font-medium">{o.customerName || '—'}</TableCell>
                        <TableCell className="max-w-[11rem] truncate text-muted-foreground">
                          {o.customerCompanyName || ''}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{o.depotName || o.state || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{o.pfiNumber || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{o.productName || '—'}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {formatQty(toNumber(o.quantity))}
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">
                          {formatNaira(toNumber(o.totalAmount))}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <OrderStatusBadge status={o.status} />
                            <PaymentBadge paymentStatus={o.paymentStatus} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="ghost" size="icon-sm" title="View details" onClick={() => setViewing(o)}>
                              <Eye />
                              <span className="sr-only">View {o.orderNumber}</span>
                            </Button>
                            <Button
                              variant={locked ? 'ghost' : 'outline'}
                              size="sm"
                              disabled={locked}
                              title={locked ? `A ${String(o.status).toLowerCase()} order can no longer be edited` : 'Edit this order'}
                              onClick={() => setEditing(o)}
                            >
                              <Pencil data-icon="inline-start" />
                              Edit
                            </Button>
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                title="Delete permanently"
                                onClick={() => setDeleting(o)}
                              >
                                <Trash2 />
                                <span className="sr-only">Delete {o.orderNumber}</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="px-4">
              <Pagination
                currentPage={current}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
              />
            </div>
          </div>
        )}
      </section>

      <OrderEditDialog
        order={editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
      />
      <OrderDetailsDialog
        order={viewing}
        open={viewing !== null}
        onOpenChange={(o) => { if (!o) setViewing(null) }}
      />

      {/* Names what goes with it. Not a cancel — nothing survives but the
          audit entry. */}
      <Dialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.orderNumber}?</DialogTitle>
            <DialogDescription>
              <span className="block space-y-2">
                <span className="block">
                  This permanently removes the order and everything attached to it — its
                  tickets, allocated trucks, commissions, wallet holds and stock movements.
                </span>
                {deleting?.paymentStatus === 'Paid' && (
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
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={deleteOrder.isPending}
              onClick={async () => {
                await deleteOrder.mutateAsync(deleting.id ?? deleting._id)
                setDeleting(null)
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
