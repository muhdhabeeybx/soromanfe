import { useState } from 'react'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { DollarSign, Search, X, Wallet, MapPin, Flame } from 'lucide-react'
import { usePayableLpgOrders, usePayLpgOrder } from '#/lib/hooks/useLpgOrders'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/lpg-payable-orders/')({
  beforeLoad: () => routeGuard('/lpg-payable-orders'),
  component: PayableLpgOrdersPage,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

function PayableLpgOrdersPage() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [payingId, setPayingId] = useState<number | null>(null)

  const { data: orders = [], isLoading, isError, error, refetch } = usePayableLpgOrders()
  const payOrder = usePayLpgOrder()

  const filteredOrders = orders.filter((order: any) => {
    if (!searchTerm) return true
    const s = searchTerm.toLowerCase()
    return (
      (order.requestNumber || '').toLowerCase().includes(s) ||
      (order.customerName || '').toLowerCase().includes(s) ||
      (order.stationName || '').toLowerCase().includes(s)
    )
  })

  const totalItems = filteredOrders.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const totalPayableValue = filteredOrders.reduce(
    (sum: number, o: any) => sum + (Number(o.totalAmount) || 0), 0
  )

  const handlePay = async (orderId: number) => {
    setPayingId(orderId)
    try {
      await payOrder.mutateAsync(orderId)
    } finally {
      setPayingId(null)
    }
  }

  if (isLoading) return <PageLoader message="Loading payable LPG orders..." />
  if (isError) return <PageError message={(error as any)?.message || 'Failed to load payable orders'} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <PageHeader
      eyebrow="LPG Home Delivery"
      title="Payable LPG Orders"
      description={`Approved LPG orders where the customer's wallet balance covers the total. Click "Pay Now" to process payment from the customer's wallet.`}
    />

      <StatCardGrid count={2}>
        <StatCard
          icon={<Flame />} label="Payable orders" value={totalItems}
          description="Wallet balance covers the full amount"
        />
        <StatCard
          icon={<DollarSign />} label="Total payable value"
          value={formatCurrency(totalPayableValue)}
          description="Ready to draw from customer wallets"
        />
      </StatCardGrid>
                <FilterBar>
              <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
              <Input
              type="text"
              placeholder="Search request ID, customer..."
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
                title="No payable LPG orders"
                description={searchTerm
                ? 'No orders match your search.'
                : 'There are no approved unpaid LPG orders where the customer has sufficient wallet balance.'}
                hasFilters={!!searchTerm}
                onClearFilters={() => setSearchTerm('')}
                />
                ) : (
                <>
                <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                <TableRow>
                <TableHead>Request ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Station</TableHead>
                <TableHead>Cylinders</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Wallet Balance</TableHead>
                <TableHead className="text-center">Action</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {paginatedOrders.map((order: any) => {
                const balance = Number(order.customerBalance) || 0
                const total = Number(order.totalAmount) || 0
                return (
                <TableRow
                key={order.id}
                className="hover:bg-muted/50 transition cursor-pointer"
                onClick={() => navigate({ to: '/lpg-orders/details' as any, search: { id: String(order.id) } as any })}
                >
                <TableCell className="font-mono font-semibold text-primary">
                {order.requestNumber}
                </TableCell>
                <TableCell>
                <div className="space-y-0.5">
                <p className="font-normal text-foreground">{order.customerName}</p>
                {order.deliveryState && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" />
                <span>{order.deliveryState}</span>
                </div>
                )}
                </div>
                </TableCell>
                <TableCell>
                <div className="flex items-center gap-1.5 text-sm font-normal">
                <Flame className="size-3.5 text-muted-foreground" />
                <span>{order.stationName}</span>
                </div>
                </TableCell>
                <TableCell className="font-normal">
                {Number(order.cylinderQuantity).toLocaleString()} x {order.cylinderSizeKg}Kg
                </TableCell>
                <TableCell className="font-semibold text-foreground">
                {formatCurrency(total)}
                </TableCell>
                <TableCell>
                <span className="font-semibold text-accent">
                {formatCurrency(balance)}
                </span>
                </TableCell>
                <TableCell className="text-center">
                <Button
                size="sm"
                className="bg-accent text-accent-foreground hover:bg-accent/90 cursor-pointer"
                disabled={payingId === order.id}
                onClick={(e) => {
                e.stopPropagation()
                handlePay(order.id)
                }}
                >
                <Wallet className="size-4 mr-1" />
                {payingId === order.id ? 'Paying...' : 'Pay Now'}
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
    </div>
  )
}
