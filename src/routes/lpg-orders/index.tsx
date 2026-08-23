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
import { Flame, Clock, CheckCircle, Search, Plus, X, Eye, FileText, MapPin, Truck, DollarSign, Hourglass, XCircle } from 'lucide-react'
import { useLpgOrderRequests } from '#/lib/hooks/useLpgOrders'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { OrderExpiryBadge } from '../orders/-order-expiry'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/lpg-orders/')({
  beforeLoad: () => routeGuard('/lpg-orders'),
  component: LpgOrdersDashboard,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

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

function LpgOrdersDashboard() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, statusFilter, paymentFilter, collectionFilter])

  const { data, isLoading, isError, error, refetch } = useLpgOrderRequests({
    search: debouncedSearch || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: 1000,
  })

  const requests = data?.requests || []
  const hasFilters = !!(debouncedSearch || statusFilter !== 'all' || paymentFilter !== 'all' || collectionFilter !== 'all')

  const filteredRequests = requests.filter((req: any) => {
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter
    const matchesPayment = paymentFilter === 'all' || req.paymentStatus === paymentFilter
    const matchesCollection = collectionFilter === 'all' || req.collectionStatus === collectionFilter
    return matchesStatus && matchesPayment && matchesCollection
  })

  const totalOrders = filteredRequests.length
  const paidOrders = filteredRequests.filter((r: any) => r.paymentStatus === 'Paid').length
  const unpaidOrders = filteredRequests.filter((r: any) => r.paymentStatus === 'Unpaid').length
  const totalValue = filteredRequests.reduce((sum: number, r: any) => sum + (Number(r.totalAmount) || 0), 0)

  const totalItems = filteredRequests.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  if (isLoading) {
    return <PageLoader message="Loading LPG cooking gas orders..." />
  }

  if (isError) {
    return <PageError message={(error as any)?.message || 'Failed to load orders'} onRetry={refetch} />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
      eyebrow="LPG Home Delivery"
      title="LPG Cooking Gas Orders"
      description="View and track all LPG cooking gas orders, payment, and collection status."
      actions={
        <>
          <Button size="sm" onClick={() => navigate({ to: '/admin-order' as any })}>
          <Plus data-icon="inline-start" />
          Place LPG order
          </Button>
        </>
      }
    />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<FileText />} label="Total Orders" value={totalOrders} />
        <StatCard icon={<CheckCircle />} label="Paid" value={paidOrders} />
        <StatCard tone="amber" icon={<Clock />} label="Unpaid" value={unpaidOrders} />
        <StatCard icon={<DollarSign />} label="Total Value" value={formatCurrency(totalValue)} />
      </div>

      <FilterBar>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
        <Input
        type="text"
        placeholder="Search request ID, customer, station..."
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
        </div>
      </FilterBar>

      <Card>
        
        <CardContent>
          {filteredRequests.length === 0 ? (
            <PageEmpty
              icon={<Flame className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No orders match your filters' : 'No approved LPG orders yet'}
              description={hasFilters ? 'Try adjusting your search or filter criteria.' : 'Approved LPG cooking gas orders will appear here once order requests are reviewed and approved.'}
              actionLabel={hasFilters ? undefined : 'View Order Requests'}
              onAction={hasFilters ? undefined : () => navigate({ to: '/lpg-order-request' as any })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setPaymentFilter('all'); setCollectionFilter('all') }}
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
                      <TableHead>Payment</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRequests.map((req: any) => (
                      <TableRow
                        key={req.id}
                        className="hover:bg-muted/50 transition cursor-pointer"
                        onClick={() => navigate({ to: '/lpg-orders/details' as any, search: { id: String(req.id) } as any })}
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
                            <Flame className="size-3.5 text-muted-foreground" />
                            <span>{req.stationName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-normal">
                          {Number(req.cylinderQuantity).toLocaleString()} x {req.cylinderSizeKg}Kg
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
    </div>
  )
}
