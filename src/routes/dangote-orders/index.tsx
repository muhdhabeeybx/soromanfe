import { useState, useEffect } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Package, Clock, CheckCircle, DollarSign, Search, Plus, X, Eye,
  FileText, MapPin, Truck, Hourglass, XCircle, Wallet,
} from 'lucide-react'
import { useDangoteOrderRequests, usePayDangoteOrder } from '#/lib/hooks/useDangoteOrders'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { OrderExpiryBadge } from '../orders/-order-expiry'
import { routeGuard } from '#/lib/route-guard'
import { cn } from '#/lib/utils'
import { isDangoteOrderPayable, formatCurrency } from './-dangote-orders-utils'

export const Route = createFileRoute('/dangote-orders/')({
  beforeLoad: () => routeGuard('/dangote-orders'),
  component: DangoteOrdersDashboard,
})

function formatDate(dateString: string) {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function paymentStatusBadge(status: string) {
  switch (status) {
    case 'Paid':
      return <Badge className="bg-accent/15 text-accent border-accent/20 gap-1"><CheckCircle className="size-3" /> Paid</Badge>
    case 'Unpaid':
      return <Badge className="bg-warning/15 text-warning border-warning/20 gap-1"><Clock className="size-3" /> Unpaid</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function collectionStatusBadge(status: string) {
  switch (status) {
    case 'Collected':
      return <Badge className="bg-accent/15 text-accent border-accent/20 gap-1"><CheckCircle className="size-3" /> Collected</Badge>
    case 'Dispatched':
      return <Badge className="bg-muted/15 text-muted-foreground border-border/20 gap-1"><Truck className="size-3" /> Dispatched</Badge>
    case 'Pending':
      return <Badge className="bg-warning/15 text-warning border-warning/20 gap-1"><Clock className="size-3" /> Pending</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function DangoteOrdersDashboard() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [payableOnly, setPayableOnly] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [payTargetOrder, setPayTargetOrder] = useState<any | null>(null)

  const payDangoteOrderMutation = usePayDangoteOrder()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, statusFilter, paymentFilter, collectionFilter, payableOnly])

  const { data, isLoading, isError, error, refetch } = useDangoteOrderRequests({
    search: debouncedSearch || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: 1000,
  })

  const requests = data?.requests || []
  const payableCount = requests.filter(isDangoteOrderPayable).length
  const hasFilters = !!(debouncedSearch || statusFilter !== 'all' || paymentFilter !== 'all' || collectionFilter !== 'all' || payableOnly)

  // Filter by status, payment, collection status, and payable
  const filteredRequests = requests.filter((req: any) => {
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter
    const matchesPayment = paymentFilter === 'all' || req.paymentStatus === paymentFilter
    const matchesCollection = collectionFilter === 'all' || req.collectionStatus === collectionFilter
    const matchesPayable = !payableOnly || isDangoteOrderPayable(req)
    return matchesStatus && matchesPayment && matchesCollection && matchesPayable
  })

  const handleConfirmPayment = async () => {
    if (!payTargetOrder) return
    try {
      await payDangoteOrderMutation.mutateAsync(payTargetOrder.id)
      setPayTargetOrder(null)
    } catch {
      // Handled by usePayDangoteOrder toast
    }
  }

  // Stats
  const totalOrders = filteredRequests.length
  const paidOrders = filteredRequests.filter((r: any) => r.paymentStatus === 'Paid').length
  const unpaidOrders = filteredRequests.filter((r: any) => r.paymentStatus === 'Unpaid').length
  const totalValue = filteredRequests.reduce((sum: number, r: any) => sum + (Number(r.totalAmount) || 0), 0)

  // Pagination
  const totalItems = filteredRequests.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  if (isLoading) {
    return <PageLoader message="Loading Dangote delivery orders..." />
  }

  if (isError) {
    return <PageError message={(error as any)?.message || 'Failed to load orders'} onRetry={refetch} />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Dangote Delivery"
        title="Dangote Delivery Orders"
        description="View and track all Dangote delivery orders, payment, and collection status."
        actions={
          <>
            <Button size="sm" onClick={() => navigate({ to: '/admin-order' as any })}>
              <Plus data-icon="inline-start" />
              Place Dangote order
            </Button>
          </>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<FileText />} label="Total Orders" value={totalOrders} />
        <StatCard icon={<CheckCircle />} label="Paid" value={paidOrders} />
        <StatCard tone="amber" icon={<Clock />} label="Unpaid" value={unpaidOrders} />
        <StatCard icon={<DollarSign />} label="Total Value" value={formatCurrency(totalValue)} />
      </div>

      {/* Orders Table */}
      <FilterBar>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
            <Input
              type="text"
              placeholder="Search request ID, customer, product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors duration-250 ease-luxe"
                aria-label="Clear search"
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Cancelled">Cancelled</SelectItem>
              <SelectItem value="Expired">Expired</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
              <SelectItem value="Pending Review">Pending Review</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payment</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={collectionFilter} onValueChange={setCollectionFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Collection</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Dispatched">Dispatched</SelectItem>
              <SelectItem value="Collected">Collected</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={payableOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setPayableOnly((v) => !v); setCurrentPage(1) }}
            aria-pressed={payableOnly}
            className={cn(
              'h-9 gap-1.5 font-medium transition-all duration-150 cursor-pointer',
              payableOnly
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                : 'border-emerald-600/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-500/15',
            )}
          >
            <Wallet className="size-3.5" />
            Ready to pay from wallet
            {payableCount > 0 && (
              <span className={cn(
                'ml-1 rounded-full px-1.5 py-0.2 text-[11px] font-semibold',
                payableOnly ? 'bg-white/20 text-white' : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300'
              )}>
                {payableCount}
              </span>
            )}
            {payableOnly && <X className="size-3" />}
          </Button>
        </div>
      </FilterBar>

      <Card>
        <CardContent>
          {filteredRequests.length === 0 ? (
            <PageEmpty
              icon={<FileText className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No orders match your filters' : 'No approved Dangote delivery orders yet'}
              description={hasFilters ? 'Try adjusting your search or filter criteria.' : 'Approved Dangote delivery orders will appear here once order requests are reviewed and approved.'}
              actionLabel={hasFilters ? undefined : 'View Order Requests'}
              onAction={hasFilters ? undefined : () => navigate({ to: '/dangote-order-request' as any })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setStatusFilter('all'); setPaymentFilter('all'); setCollectionFilter('all'); setPayableOnly(false) }}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRequests.map((req: any) => (
                      <TableRow
                        key={req.id}
                        className="hover:bg-muted/50 transition cursor-pointer"
                        onClick={() => navigate({ to: '/dangote-orders/details' as any, search: { id: String(req.id) } as any })}
                      >
                        <TableCell className="font-mono font-semibold text-primary">
                          {req.requestNumber}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-normal text-foreground">{req.customerName}</p>
                            {req.deliveryState && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="size-3" />
                                <span>{req.deliveryState}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm font-normal">
                            <Package className="size-3.5 text-muted-foreground" />
                            <span>{req.product}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-normal">
                          {Number(req.quantity).toLocaleString()} {req.quantityUnit}
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          {req.totalAmount ? formatCurrency(Number(req.totalAmount)) : '—'}
                        </TableCell>
                        <TableCell>{paymentStatusBadge(req.paymentStatus)}</TableCell>
                        <TableCell>{collectionStatusBadge(req.collectionStatus)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(req.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {req.status === 'Cancelled' ? (
                              <Badge variant="outline" className="gap-1 w-fit"><XCircle className="size-3" /> Cancelled</Badge>
                            ) : req.status === 'Expired' ? (
                              <Badge className="bg-muted/50 text-muted-foreground border-muted/20 gap-1 w-fit"><Hourglass className="size-3" /> Expired</Badge>
                            ) : req.status === 'Rejected' ? (
                              <Badge variant="destructive" className="gap-1 w-fit"><XCircle className="size-3" /> Rejected</Badge>
                            ) : req.status === 'Pending Review' ? (
                              <Badge className="bg-warning/15 text-warning border-warning/20 gap-1 w-fit"><Clock className="size-3" /> Pending Review</Badge>
                            ) : (
                              <Badge className="bg-accent/15 text-accent border-accent/20 gap-1 w-fit"><CheckCircle className="size-3" /> Active</Badge>
                            )}
                            <OrderExpiryBadge status={req.status} expiresAt={req.expiresAt} expiredAt={req.expiredAt} />
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {isDangoteOrderPayable(req) && (
                              <Button
                                size="sm"
                                className="h-7 gap-1 bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 shadow-none cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPayTargetOrder(req)
                                }}
                                disabled={payDangoteOrderMutation.isPending && payTargetOrder?.id === req.id}
                              >
                                <Wallet className="size-3" />
                                <span>Pay Now</span>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate({ to: '/dangote-orders/details' as any, search: { id: String(req.id) } as any })
                              }}
                            >
                              <Eye />
                              <span className="sr-only">View {req.requestNumber}</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
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

      <ConfirmDialog
        open={payTargetOrder !== null}
        onOpenChange={(open) => { if (!open) setPayTargetOrder(null) }}
        title={`Pay Order ${payTargetOrder?.requestNumber || ''}`}
        description="Process payment directly from the customer's available wallet balance."
        confirmLabel="Confirm & Pay"
        cancelLabel="Cancel"
        loading={payDangoteOrderMutation.isPending}
        onConfirm={handleConfirmPayment}
      >
        {payTargetOrder && (
          <div className="my-2 space-y-3 rounded-lg border border-foreground/10 bg-muted/30 p-3.5 text-sm">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Customer:</span>
              <span className="font-medium text-foreground">
                {payTargetOrder.customerName || payTargetOrder.companyName || payTargetOrder.customerCompanyName || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Order Total:</span>
              <span className="font-semibold text-foreground">
                {formatCurrency(Number(payTargetOrder.totalAmount) || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Wallet Balance:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(Number(payTargetOrder.customerBalance) || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-foreground/10 pt-2 text-xs">
              <span className="text-muted-foreground">Balance After Payment:</span>
              <span className="font-semibold text-foreground">
                {formatCurrency(Math.max(0, (Number(payTargetOrder.customerBalance) || 0) - (Number(payTargetOrder.totalAmount) || 0)))}
              </span>
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

