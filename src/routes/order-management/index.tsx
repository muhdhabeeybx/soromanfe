import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Search, X, RefreshCw, Pencil, Eye, Trash2, Wallet, Fuel, Package,
  Ban, Loader2, AlertTriangle,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Checkbox } from '#/components/ui/checkbox'
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
import { OrderDestination } from '#/components/OrderDestination'
import { cn } from '#/lib/utils'
import {
  useAllOrders, useDeleteOrder, useBulkCancelOrders, useBulkDeleteOrders,
} from '#/lib/hooks/useOrders'
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
 * What may still be done to an order, by status.
 *
 * Both lists mirror the server: LOCKED is what OrderEditDialog refuses (see
 * order.service.js's updateOrder), and CANCELLABLE is the set of states with
 * "Cancelled" in their transition table (orderStatus.service.js) — cancel is
 * allowed through Released and stops the moment a truck gates in. They are
 * checked here so a bulk action can say up front how much of a selection it
 * will actually touch, rather than firing twenty requests to find out.
 */
const LOCKED_STATUSES = ['Completed', 'Cancelled', 'Expired']
const CANCELLABLE_STATUSES = ['Pending', 'Paid', 'Released']

const isLocked = (o: { status?: unknown }) => LOCKED_STATUSES.includes(String(o.status))
const isCancellable = (o: { status?: unknown }) => CANCELLABLE_STATUSES.includes(String(o.status))
const orderId = (o: { id?: string | number; _id?: string }) => String(o.id ?? o._id ?? '')

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

  /**
   * The selection, by order id.
   *
   * A Set rather than an array of orders: the rows are re-created on every
   * refetch, so holding the objects would keep a selection pointing at stale
   * copies of them — and the figures a confirm dialog reads off the selection
   * would then be the ones from before the refetch.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'cancel' | 'delete' | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const { data, isLoading, isError, error, refetch, isFetching } = useAllOrders()
  const { isSuperAdmin: canDelete } = useRoles()
  const deleteOrder = useDeleteOrder()
  const bulkCancel = useBulkCancelOrders(cancelReason)
  const bulkDelete = useBulkDeleteOrders()

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

  /**
   * The selected orders, resolved against what is on screen.
   *
   * Derived from `filtered` rather than from every order, so narrowing a
   * filter narrows the selection with it. An id that has scrolled out of view
   * behind a filter simply stops counting — which is the point: nobody should
   * be able to delete twelve orders when the screen says eight are selected.
   *
   * Nothing prunes the Set itself. Clearing a filter brings its ids back, and
   * an effect that deleted them on every filter change would make widening
   * the view silently lose work.
   */
  const selectedOrders = useMemo(
    () => filtered.filter((o) => selected.has(orderId(o))),
    [filtered, selected],
  )
  const cancellable = useMemo(() => selectedOrders.filter(isCancellable), [selectedOrders])
  const deletable = selectedOrders

  const pageIds = rows.map(orderId)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someOnPageSelected = pageIds.some((id) => selected.has(id))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** The header box acts on this page only — never on rows nobody can see. */
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })

  const selectAllFiltered = () => setSelected(new Set(filtered.map(orderId)))
  const clearSelection = () => setSelected(new Set())

  const bulkBusy = bulkCancel.isPending || bulkDelete.isPending

  const runBulk = async () => {
    const targets = bulkAction === 'cancel' ? cancellable : deletable
    if (targets.length === 0) return
    const result = bulkAction === 'cancel'
      ? await bulkCancel.mutateAsync(targets)
      : await bulkDelete.mutateAsync(targets)
    // Only the ones that went through leave the selection. What was refused
    // stays ticked, so a second attempt does not mean re-finding them.
    setSelected((prev) => {
      const next = new Set(prev)
      result.ok.forEach((id) => next.delete(String(id)))
      return next
    })
    setBulkAction(null)
    setCancelReason('')
  }

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
        {/* The rail carries the count until something is ticked, and then it
            carries the actions instead. A separate bar that appears above the
            table would push the whole thing down by its own height every time
            a checkbox was clicked. */}
        <div className={cn(PANEL_RAIL, 'gap-3')}>
          {selectedOrders.length === 0 ? (
            <>
              <span className={MICRO}>
                {formatQty(filtered.length)} order{filtered.length === 1 ? '' : 's'}
              </span>
              <span className="text-xs text-muted-foreground">{formatNaira(totals.value)}</span>
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn(MICRO, 'font-semibold')}>
                  {formatQty(selectedOrders.length)} selected
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatNaira(selectedOrders.reduce((sum, o) => sum + toNumber(o.totalAmount), 0))}
                </span>
                {/* Offered only when there is more behind the pagination than
                    the page could tick, so it never reads as a second way to
                    do what the header box just did. */}
                {selectedOrders.length < filtered.length && (
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="text-xs text-accent underline-offset-4 hover:underline"
                  >
                    Select all {formatQty(filtered.length)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* The eligible count is on the button, not discovered in a
                    dialog: a selection of twelve where only five can be
                    cancelled should say five before it is pressed. */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancellable.length === 0 || bulkBusy}
                  title={
                    cancellable.length === 0
                      ? 'Nothing selected can still be cancelled'
                      : `Cancel ${cancellable.length} order${cancellable.length === 1 ? '' : 's'}`
                  }
                  onClick={() => setBulkAction('cancel')}
                >
                  <Ban data-icon="inline-start" />
                  Cancel {cancellable.length > 0 ? cancellable.length : ''}
                </Button>
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={bulkBusy}
                    onClick={() => setBulkAction('delete')}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete {deletable.length}
                  </Button>
                )}
              </div>
            </>
          )}
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
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label={allOnPageSelected ? 'Clear this page' : 'Select this page'}
                        // Indeterminate when the page is part-ticked, so the
                        // box reports a partial selection instead of reading
                        // as empty over eight ticked rows.
                        checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
                        onCheckedChange={togglePage}
                      />
                    </TableHead>
                    <TableHead className="w-10">S/N</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>PFI</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty (L)</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o, i) => {
                    const locked = isLocked(o)
                    const id = orderId(o)
                    const ticked = selected.has(id)
                    return (
                      <TableRow key={o.id ?? o._id} data-state={ticked ? 'selected' : undefined}>
                        <TableCell>
                          {/* Every order can be ticked, including a completed
                              one. What a selection may then have DONE to it is
                              the buttons' business — hiding the box would make
                              a locked order look unselectable rather than
                              uncancellable, and a super admin can still
                              delete it. */}
                          <Checkbox
                            checked={ticked}
                            onCheckedChange={() => toggleOne(id)}
                            aria-label={`Select ${o.orderNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {(current - 1) * pageSize + i + 1}
                        </TableCell>
                        <TableCell className="font-semibold whitespace-nowrap text-accent">{o.orderNumber}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {o.createdAt ? format(new Date(o.createdAt), 'd MMM yyyy') : '—'}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate font-medium">{o.customerName || '—'}</TableCell>
                        {/* The company on the ORDER first — one customer can
                            order under several, and their saved company is
                            only the fallback. Same precedence as All Orders,
                            which these two pages were showing differently. */}
                        <TableCell className="max-w-[11rem] truncate text-muted-foreground">
                          {o.companyName || o.customerCompanyName || ''}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="block">{o.depotName || o.state || '—'}</span>
                          <OrderDestination
                            deliveryType={o.deliveryType}
                            deliveryAddress={o.deliveryAddress}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{o.pfiNumber || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{o.productName || '—'}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {formatQty(toNumber(o.quantity))}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                          {formatNaira(toNumber(o.price))}
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

      {/* ── The same two questions, asked of a selection ──────────────── */}
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => { if (!open && !bulkBusy) { setBulkAction(null); setCancelReason('') } }}
      >
        <DialogContent className="max-w-lg">
          {(() => {
            const isCancel = bulkAction === 'cancel'
            const targets = isCancel ? cancellable : deletable
            const skipped = selectedOrders.length - targets.length
            const paid = targets.filter((o) => o.paymentStatus === 'Paid').length
            const value = targets.reduce((sum, o) => sum + toNumber(o.totalAmount), 0)

            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {isCancel ? 'Cancel' : 'Delete'} {formatQty(targets.length)}{' '}
                    order{targets.length === 1 ? '' : 's'}?
                  </DialogTitle>
                  <DialogDescription>
                    {isCancel
                      ? 'Each one returns its reserved quantity to its PFI and releases its wallet hold. The orders stay on the books as cancelled.'
                      : 'This permanently removes each order and everything attached to it — tickets, allocated trucks, commissions, wallet holds and stock movements. Only the audit entries survive.'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Orders</span>
                      <span className="font-semibold tabular-nums">{formatQty(targets.length)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-muted-foreground">Value</span>
                      <span className="font-semibold tabular-nums">{formatNaira(value)}</span>
                    </div>
                    {paid > 0 && (
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground">Already paid</span>
                        <span className="font-semibold tabular-nums text-warning">{formatQty(paid)}</span>
                      </div>
                    )}
                  </div>

                  {/* Said before the button, not after the run. A selection of
                      twelve that only touches five is the single most likely
                      way to think this did less than it did. */}
                  {skipped > 0 && (
                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      {formatQty(skipped)} of the {formatQty(selectedOrders.length)} selected
                      {skipped === 1 ? ' is' : ' are'} already completed, cancelled or expired and
                      {skipped === 1 ? ' will be' : ' will be'} left alone. They stay ticked.
                    </p>
                  )}

                  {paid > 0 && !isCancel && (
                    <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-xs text-destructive">
                      {formatQty(paid)} of these {paid === 1 ? 'is' : 'are'} paid. Deleting
                      {paid === 1 ? ' it' : ' them'} also removes the payment trail, so the wallet
                      debits behind {paid === 1 ? 'it' : 'them'} can no longer be reconciled.
                    </p>
                  )}

                  {isCancel && (
                    <div className="space-y-1.5">
                      <label htmlFor="bulk-reason" className="text-sm font-medium">
                        Reason <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <Textarea
                        id="bulk-reason"
                        rows={2}
                        placeholder="Recorded against every order in this run."
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={() => { setBulkAction(null); setCancelReason('') }}
                  >
                    Keep them
                  </Button>
                  <Button
                    variant={isCancel ? 'default' : 'destructive'}
                    disabled={bulkBusy || targets.length === 0}
                    onClick={runBulk}
                  >
                    {bulkBusy && <Loader2 className="animate-spin" />}
                    {isCancel
                      ? `Cancel ${formatQty(targets.length)}`
                      : `Delete ${formatQty(targets.length)} permanently`}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

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
