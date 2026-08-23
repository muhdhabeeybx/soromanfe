import { useMemo, useState } from 'react'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Building2, Package, Search, X, Wallet, CheckCircle2, AlertTriangle } from 'lucide-react'
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

function PendingOrdersPage() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [pfiFilter, setPfiFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  /** Orders the wallet already covers vs. ones still short — the two piles a desk works differently. */
  const [coverFilter, setCoverFilter] = useState<'' | 'covered' | 'short'>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [confirmingOrder, setConfirmingOrder] = useState<any | null>(null)

  // Every unpaid order awaiting a decision, not just the ones already fully
  // covered by wallet balance — a shortfall is something staff act on here,
  // not a reason to hide the order.
  const { data, isLoading, isError, error, refetch } = useAllOrders({ status: 'Pending' })
  const orders: any[] = (data?.orders || []).filter((o: any) => o.paymentStatus !== 'Paid')

  // Declared before the filter that uses it — a const arrow function is in
  // the temporal dead zone until its own line, so referencing it above would
  // throw at render, not fail to compile.
  const shortfallOf = (o: any) => Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.customerBalance) || 0))

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
      const short = shortfallOf(order) > 0
      if (coverFilter === 'short' && !short) return false
      if (coverFilter === 'covered' && short) return false
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

  const fundedCount = filteredOrders.filter((o) => shortfallOf(o) <= 0).length
  const totalShortfall = filteredOrders.reduce((sum, o) => sum + shortfallOf(o), 0)

  if (isLoading) return <PageLoader message="Loading pending orders..." />
  if (isError) return <PageError message={(error as any)?.message || 'Failed to load pending orders'} onRetry={refetch} />

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Finance"
        title="Pending Orders"
        description="Every order awaiting payment. Confirm payment on one to match a bank statement (or record it manually) — wallet balance applies first, and anything beyond what's needed stays with the customer."
      />

      <StatCardGrid count={3}>
        <StatCard
          icon={<Package />} label="Awaiting payment" value={totalItems}
        />
        <StatCard
          icon={<CheckCircle2 />} label="Already covered by wallet" value={fundedCount}
          description="Ready to confirm with no new matching"
        />
        <StatCard
          tone={totalShortfall > 0 ? 'amber' : 'green'}
          icon={<AlertTriangle />} label="Total shortfall" value={formatCurrency(totalShortfall)}
          description="Across every order still short"
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
          onChange={(e) => { setCoverFilter(e.target.value as '' | 'covered' | 'short'); setCurrentPage(1) }}
        >
          <option value="">Covered & short</option>
          <option value="covered">Wallet covers it</option>
          <option value="short">Still short</option>
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
                      <TableHead>Customer / Company</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Wallet Balance</TableHead>
                      <TableHead>Shortfall</TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOrders.map((order: any) => {
                      const custName = order.customerName || 'Unknown'
                      const compName = order.companyName
                      const pName = order.productName || 'Unknown'
                      const balance = Number(order.customerBalance) || 0
                      const total = Number(order.totalAmount) || 0
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
                            <div className="flex items-center gap-1.5 text-sm font-normal">
                              <Package className="size-3.5 text-muted-foreground" />
                              <span>{pName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-normal">
                            {Number(order.quantity)?.toLocaleString()} {order.productUnit || 'Liters'}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {formatCurrency(total)}
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold text-accent">
                              {formatCurrency(balance)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {/* "Wallet covers it", not "covered" — the balance
                                is not applied until someone says to on the
                                confirm dialog, so this is what the wallet
                                could meet, not what it has. */}
                            {shortfall > 0 ? (
                              <span className="font-semibold text-warning">{formatCurrency(shortfall)}</span>
                            ) : (
                              <span className="text-xs text-success">Wallet covers it</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {/* Same button whatever the wallet holds. A
                                covered order used to get a green
                                confirm-and-go treatment, which read as a
                                one-click deduction — every payment goes
                                through the same statement match now. */}
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
