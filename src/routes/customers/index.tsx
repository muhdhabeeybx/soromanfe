import { useState, useEffect } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { Users, Search, Plus, UserCheck, UserX, Phone, Mail, Building2, X, Wallet, Banknote } from 'lucide-react'
import { useCustomerList } from '#/lib/hooks/useCustomers'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/customers/')({
  beforeLoad: () => routeGuard('/customers'),
  component: CustomerDashboard,
})

function getStatusBadge(status: string) {
  switch (status) {
    case 'Active': return <Badge className="bg-success text-success-foreground">{status}</Badge>
    case 'Inactive': return <Badge className="bg-warning text-warning-foreground">{status}</Badge>
    case 'Pending': return <Badge variant="outline" className="border-warning text-warning">{status}</Badge>
    default: return <Badge variant="outline">{status}</Badge>
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

function CustomerDashboard() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)

  const POLL_INTERVAL = 30_000
  const { data, isLoading, isError, error, refetch } = useCustomerList({
    page: currentPage,
    limit: pageSize,
    search: searchTerm || undefined,
    status: selectedStatus !== 'all' ? selectedStatus : undefined,
    refetchInterval: POLL_INTERVAL,
  })
  const customers = data?.customers || []

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedStatus])

  const totalItems = data?.pagination?.total ?? customers.length
  const totalPages = data?.pagination?.pages ?? Math.ceil(totalItems / pageSize)

  const stats = {
    total: data?.summary?.total ?? data?.pagination?.total ?? 0,
    active: data?.summary?.active ?? customers.filter((c: any) => c.status === 'Active').length,
    inactive: data?.summary?.inactive ?? customers.filter((c: any) => c.status === 'Inactive').length,
    totalBalance: data?.summary?.totalBalance ?? customers.reduce((sum: number, c: any) => sum + (Number(c.balance) || 0), 0),
  }
  const getInitials = (name: string) => { const parts = (name || '').split(' '); return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() }

  const hasFilters = Boolean(searchTerm || selectedStatus !== 'all')

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Orders"
        title="Customers"
        description="Manage customer profiles, deposits, balances, and account status."
        actions={
          <>
            <Button size="sm" onClick={() => navigate({ to: '/customers/form' })}>
              <Plus className="size-4 mr-2" />Add New Customer
            </Button>
          </>
        }
      />

      {!isLoading && !isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
          <StatCard icon={<Users />} label="Total Customers" value={stats.total} />
          <StatCard icon={<UserCheck />} label="Active" value={stats.active} />
          <StatCard tone="amber" icon={<UserX />} label="Inactive" value={stats.inactive} />
          <StatCard icon={<Wallet />} label="Total Balance" value={formatCurrency(stats.totalBalance)} />
        </div>
      )}

      <FilterBar>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
            <Input type="text" placeholder="Search by name, company, phone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors duration-250 ease-luxe" aria-label="Clear search"><X className="size-2.5" /></button>}
          </div>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      <Card>

        <CardContent>
          {isLoading ? (
            <PageLoader message="Loading customers..." />
          ) : isError ? (
            <PageError message={(error as any)?.message || 'Failed to load customers'} onRetry={() => refetch()} />
          ) : customers.length === 0 ? (
            <PageEmpty
              icon={<Users className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No customers match your filters' : 'No customers yet'}
              description={hasFilters ? 'Try adjusting your search or filter criteria.' : 'Get started by adding your first customer.'}
              actionLabel={hasFilters ? undefined : 'Add Customer'}
              onAction={hasFilters ? undefined : () => navigate({ to: '/customers/form' })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setSelectedStatus('all') }}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="hidden md:table-cell">Contact</TableHead>
                      <TableHead>Balance</TableHead>
                      {/* <TableHead className="hidden lg:table-cell">Deposit</TableHead> */}
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer: any) => (
                      <TableRow key={customer._id || customer.id} tabIndex={0} role="link" aria-label={`View ${customer.name}`} className="cursor-pointer hover:bg-muted transition" onClick={() => navigate({ to: '/customers/details' as any, search: { id: customer._id || customer.id } as any, state: { customer } } as any)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate({ to: '/customers/details' as any, search: { id: customer._id || customer.id } as any, state: { customer } } as any) } }}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {/* <div className="size-10 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-normal">{getInitials(customer.name)}</div> */}
                            <p className="font-normal uppercase">{customer.name}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Building2 className="size-3.5 text-muted-foreground" />
                            <span className="font-normal uppercase">{customer.companyName || '—'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                          <div className="flex items-center gap-1"><Mail className="size-3" /><span className="truncate max-w-[160px]">{customer.email || '—'}</span></div>
                          <div className="flex items-center gap-1 mt-0.5"><Phone className="size-3" />{customer.phone}</div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">{formatCurrency(customer.balance || 0)}</span>
                        </TableCell>
                        {/* <TableCell className="hidden lg:table-cell">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1 text-sm"><Banknote className="size-3 text-success" /><span className="font-normal">{formatCurrency(customer.deposit || 0)}</span></div>
                            <div className="text-xs text-muted-foreground">Prev: {formatCurrency(customer.previousDeposit || 0)}</div>
                          </div>
                        </TableCell> */}
                        <TableCell>{getStatusBadge(customer.status)}</TableCell>
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
