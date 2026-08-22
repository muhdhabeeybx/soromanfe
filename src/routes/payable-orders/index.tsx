import { useState } from 'react'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Building2, Package, Search, X, Wallet, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAllOrders } from '#/lib/hooks/useOrders'
import { ConfirmOrderPaymentDialog } from '#/components/ConfirmOrderPaymentDialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { cn } from '#/lib/utils'
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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [confirmingOrder, setConfirmingOrder] = useState<any | null>(null)

  // Every unpaid order awaiting a decision, not just the ones already fully
  // covered by wallet balance — a shortfall is something staff act on here,
  // not a reason to hide the order.
  const { data, isLoading, isError, error, refetch } = useAllOrders({ status: 'Pending' })
  const orders: any[] = (data?.orders || []).filter((o: any) => o.paymentStatus !== 'Paid')

  const filteredOrders = orders.filter((order: any) => {
    if (!searchTerm) return true
    const s = searchTerm.toLowerCase()
    return (
      (order.orderNumber || '').toLowerCase().includes(s) ||
      (order.customerName || '').toLowerCase().includes(s) ||
      (order.companyName || '').toLowerCase().includes(s) ||
      (order.productName || '').toLowerCase().includes(s)
    )
  })

  const totalItems = filteredOrders.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  const shortfallOf = (o: any) => Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.customerBalance) || 0))
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
      </FilterBar>

      <Card>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <PageEmpty
              icon={<Wallet className="size-6 text-muted-foreground" />}
              title="No pending orders"
              description={searchTerm ? 'No orders match your search.' : 'Every order has been paid or resolved.'}
              hasFilters={!!searchTerm}
              onClearFilters={() => setSearchTerm('')}
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
                            {shortfall > 0 ? (
                              <span className="font-semibold text-warning">{formatCurrency(shortfall)}</span>
                            ) : (
                              <span className="text-xs text-success">Covered</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="sm"
                              className={cn(shortfall > 0 ? '' : 'bg-accent text-accent-foreground hover:bg-accent/90')}
                              variant={shortfall > 0 ? 'outline' : 'default'}
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
