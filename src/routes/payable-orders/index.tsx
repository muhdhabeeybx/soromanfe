import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Building2, Package, Search, X, Wallet, CheckCircle2, AlertTriangle, MapPin } from 'lucide-react'
import { useAllOrders } from '#/lib/hooks/useOrders'
import { ConfirmOrderPaymentDialog } from '#/components/ConfirmOrderPaymentDialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/payable-orders/')({
  beforeLoad: () => routeGuard('/payable-orders'),
  component: PendingOrdersPage,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

/**
 * A unit price, always to the kobo.
 *
 * formatCurrency rounds to whole naira, which is right for a ₦60m total and
 * wrong for the rate behind it: a price of ₦1,210.50 would read ₦1,210.5, and
 * against 50,000 litres that missing half-kobo is ₦25,000 of the total it is
 * supposed to explain.
 */
function formatRate(value: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

function PendingOrdersPage() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [pfiFilter, setPfiFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  /** Untouched orders vs. ones part-paid and waiting on a balance — two different piles of work. */
  const [coverFilter, setCoverFilter] = useState<'' | 'partpaid' | 'untouched'>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [confirmingOrder, setConfirmingOrder] = useState<any | null>(null)

  // Every unpaid order awaiting a decision. Wallet balance no longer has any
  // bearing on which orders appear here or on what can be confirmed — an order
  // is paid by matching the bank statement line that paid for it.
  const { data, isLoading, isError, error, refetch } = useAllOrders({ status: 'Pending' })
  const orders: any[] = (data?.orders || []).filter((o: any) => o.paymentStatus !== 'Paid')

  // Declared before the filter that uses it — a const arrow function is in
  // the temporal dead zone until its own line, so referencing it above would
  // throw at render, not fail to compile.
  /**
   * What the order is still owed — its own value less what has been received
   * against it.
   *
   * This used to be order total less the customer's WALLET BALANCE, which
   * answered a different question entirely ("could this customer's balance
   * cover it") and, now that nothing funds a wallet, would report every order
   * as fully short forever.
   */
  const shortfallOf = (o: any) =>
    Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0))

  const options = useMemo(() => {
    const uniq = (v: (string | null | undefined)[]) =>
      [...new Set(v.filter((x): x is string => Boolean(x)))].sort()
    return {
      locations: uniq(orders.map((o: any) => o.depotName || o.state)),
      pfis: uniq(orders.map((o: any) => o.pfiNumber)),
      products: uniq(orders.map((o: any) => o.productName)),
    }
  }, [orders])

  const filteredOrders = orders.filter((order: any) => {
    if (locationFilter && (order.depotName || order.state) !== locationFilter) return false
    if (pfiFilter && order.pfiNumber !== pfiFilter) return false
    if (productFilter && order.productName !== productFilter) return false
    if (coverFilter) {
      const partPaid = Number(order.amountPaid) > 0
      if (coverFilter === 'partpaid' && !partPaid) return false
      if (coverFilter === 'untouched' && partPaid) return false
    }
    if (!searchTerm) return true
    const s = searchTerm.toLowerCase()
    return (
      (order.orderNumber || '').toLowerCase().includes(s) ||
      (order.customerName || '').toLowerCase().includes(s) ||
      (order.companyName || '').toLowerCase().includes(s) ||
      (order.customerCompanyName || '').toLowerCase().includes(s) ||
      (order.customerPhone || '').toLowerCase().includes(s) ||
      (order.depotName || '').toLowerCase().includes(s) ||
      (order.pfiNumber || '').toLowerCase().includes(s) ||
      (order.productName || '').toLowerCase().includes(s)
    )
  })

  const hasFilters = !!(searchTerm || locationFilter || pfiFilter || productFilter || coverFilter)
  const clearFilters = () => {
    setSearchTerm(''); setLocationFilter(''); setPfiFilter('')
    setProductFilter(''); setCoverFilter(''); setCurrentPage(1)
  }

  const totalItems = filteredOrders.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  const partPaidCount = filteredOrders.filter((o) => Number(o.amountPaid) > 0).length
  const totalShortfall = filteredOrders.reduce((sum, o) => sum + shortfallOf(o), 0)

  if (isLoading) return <PageLoader message="Loading pending orders..." />
  if (isError) return <PageError message={(error as any)?.message || 'Failed to load pending orders'} onRetry={refetch} />

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Finance"
        title="Pending Orders"
        description="Every order awaiting payment. Confirm one against the bank statement line that paid for it — anything beyond the order's value stays recorded against that order as surplus."
      />

      <StatCardGrid count={3}>
        <StatCard
          icon={<Package />} label="Awaiting payment" value={totalItems}
        />
        <StatCard
          icon={<CheckCircle2 />} label="Part paid" value={partPaidCount}
          description="Money received, a balance still expected"
        />
        <StatCard
          tone={totalShortfall > 0 ? 'amber' : 'green'}
          icon={<AlertTriangle />} label="Still owed" value={formatCurrency(totalShortfall)}
          description="Across every order awaiting payment"
        />
      </StatCardGrid>

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
          <Input
            type="text"
            placeholder="Search order no, customer..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
            className="pl-10"
          />
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(''); setCurrentPage(1) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Clear search"
            >
              <X className="size-2.5" />
            </button>
          )}
        </div>

        <NativeSelect
          className="w-44"
          value={locationFilter}
          onChange={(e) => { setLocationFilter(e.target.value); setCurrentPage(1) }}
        >
          <option value="">All locations</option>
          {options.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </NativeSelect>
        <NativeSelect
          className="w-44"
          value={pfiFilter}
          onChange={(e) => { setPfiFilter(e.target.value); setCurrentPage(1) }}
        >
          <option value="">All PFIs</option>
          {options.pfis.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <NativeSelect
          className="w-40"
          value={productFilter}
          onChange={(e) => { setProductFilter(e.target.value); setCurrentPage(1) }}
        >
          <option value="">All products</option>
          {options.products.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <NativeSelect
          className="w-44"
          value={coverFilter}
          onChange={(e) => { setCoverFilter(e.target.value as '' | 'partpaid' | 'untouched'); setCurrentPage(1) }}
        >
          <option value="">Any progress</option>
          <option value="partpaid">Part paid</option>
          <option value="untouched">Nothing received yet</option>
        </NativeSelect>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <Card>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <PageEmpty
              icon={<Wallet className="size-6 text-muted-foreground" />}
              title="No pending orders"
              description={hasFilters ? 'No orders match these filters.' : 'Every order has been paid or resolved.'}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order No.</TableHead>
                      {/* How long an order has been waiting is the thing this
                          desk is actually triaging on, and the row said
                          nothing about it. Time as well as date: several
                          orders land on the same day and the clock is what
                          orders them. */}
                      <TableHead>Date Placed</TableHead>
                      <TableHead>Customer / Company</TableHead>
                      {/* Location and PFI were filterable from the bar above
                          but nowhere on the row, so a filtered list gave no
                          way to see which depot or PFI a given order was
                          actually against. */}
                      <TableHead>Location</TableHead>
                      <TableHead>PFI</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      {/* Sits between the two figures it reconciles, so the
                          row reads quantity × unit price = total. */}
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Still Owed</TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOrders.map((order: any) => {
                      const custName = order.customerName || 'Unknown'
                      const compName = order.companyName
                      const pName = order.productName || 'Unknown'
                      const received = Number(order.amountPaid) || 0
                      const total = Number(order.totalAmount) || 0
                      const unitPrice = Number(order.price) || 0
                      const shortfall = shortfallOf(order)
                      return (
                        <TableRow
                          key={order.id}
                          className="hover:bg-muted/50 transition cursor-pointer"
                          onClick={() => navigate({ to: '/orders/details' as any, search: { id: order.id } as any })}
                        >
                          <TableCell className="font-mono font-semibold whitespace-nowrap text-primary">
                            {order.orderNumber}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {order.createdAt ? (
                              <>
                                <span className="block">{format(new Date(order.createdAt), 'd MMM yyyy')}</span>
                                <span className="block text-xs text-muted-foreground/70">
                                  {format(new Date(order.createdAt), 'h:mm a')}
                                </span>
                              </>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="font-medium text-foreground">{custName}</p>
                              {compName && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Building2 className="size-3" />
                                  <span>{compName}</span>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="size-3.5" />
                              <span>{order.depotName || order.state || '—'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {order.pfiNumber || '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm font-normal">
                              <Package className="size-3.5 text-muted-foreground" />
                              <span>{pName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-normal">
                            {Number(order.quantity)?.toLocaleString()} {order.productUnit || 'Liters'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-normal text-muted-foreground">
                            {unitPrice > 0 ? formatRate(unitPrice) : '—'}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {formatCurrency(total)}
                          </TableCell>
                          <TableCell>
                            <span className={received > 0 ? 'font-semibold text-accent' : 'font-semibold text-muted-foreground'}>
                              {formatCurrency(received)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {shortfall > 0 ? (
                              <span className="font-semibold text-warning">{formatCurrency(shortfall)}</span>
                            ) : (
                              <span className="text-xs text-success">Settled</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {/* One button, one flow. A wallet-covered order
                                used to get a green confirm-and-go treatment,
                                which read as a one-click deduction — every
                                payment is a statement match now. */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmingOrder(order)
                              }}
                            >
                              <Wallet className="size-4 mr-1" />
                              Confirm Payment
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1) }}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmOrderPaymentDialog
        order={confirmingOrder}
        open={confirmingOrder !== null}
        onOpenChange={(o) => { if (!o) setConfirmingOrder(null) }}
      />
    </div>
  )
}
