import { useState, useEffect, useMemo } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'

import { Search, ArrowDownLeft, Eye, X, Banknote, Plus, Landmark, ArrowRightLeft, Filter, Repeat } from 'lucide-react'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { useDepositList } from '#/lib/hooks/useDeposits'
import type { Deposit } from '#/lib/hooks/useDeposits'
import { cn, toNum } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { TransferBalanceDialog } from './-transfer-balance-dialog'

export const Route = createFileRoute('/deposits/')({
  beforeLoad: () => routeGuard('/deposits'),
  component: DepositsDashboard,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

function isPaystackDeposit(d: Deposit): boolean {
  const ps = d.paystackDetails as Record<string, any> | null | undefined
  return Boolean(
    ps?.transactionId ||
    ps?.paystackCustomerCode ||
    (ps?.gatewayResponse && String(ps.gatewayResponse).toLowerCase() !== 'manual') ||
    (ps?.channel && ps.channel !== 'manual_bank_transfer' && ps.channel !== 'manual')
  )
}

function DepositsDashboard() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'manual' | 'paystack'>('all')
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [showTransfer, setShowTransfer] = useState(false)

  const POLL_INTERVAL = 30_000
  const { data, isLoading, isError, error, refetch } = useDepositList({ limit: 5000, refetchInterval: POLL_INTERVAL })
  const deposits = data?.deposits || []

  const hasFilters = !!searchTerm || filterType !== 'all' || timeFilter !== 'all'

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filterType, timeFilter])

  // Count metrics for manual and paystack deposits
  const manualDeposits = useMemo(() => deposits.filter(d => !isPaystackDeposit(d)), [deposits])
  const paystackDeposits = useMemo(() => deposits.filter(d => isPaystackDeposit(d)), [deposits])

  const totalCredits = useMemo(() => deposits.reduce((sum: number, d: Deposit) => sum + toNum(d.amount), 0), [deposits])
  const manualCredits = useMemo(() => manualDeposits.reduce((sum: number, d: Deposit) => sum + toNum(d.amount), 0), [manualDeposits])
  const paystackCredits = useMemo(() => paystackDeposits.reduce((sum: number, d: Deposit) => sum + toNum(d.amount), 0), [paystackDeposits])

  const filteredDeposits = useMemo(() => {
    return deposits.filter((d: Deposit) => {
      // 1. Text Search Filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const customerName = (d.customerName || '').toLowerCase()
        const desc = (d.description || '').toLowerCase()
        const ref = (d.reference || '').toLowerCase()
        const recorder = (d.recorderFirstName ? `${d.recorderFirstName} ${d.recorderSurname || ''}` : '').toLowerCase()
        
        const matches = customerName.includes(term) || desc.includes(term) || ref.includes(term) || recorder.includes(term)
        if (!matches) return false
      }

      // 2. Type Filter (All / Manual / Paystack)
      const isPs = isPaystackDeposit(d)
      if (filterType === 'manual' && isPs) return false
      if (filterType === 'paystack' && !isPs) return false

      // 3. Time Filter
      // Filtered on the BANKING date where there is one — "deposits this
      // week" means money that reached the bank this week, not rows keyed in
      // this week. They differ exactly when a statement is matched late.
      const bankedOn = d.depositDate || d.createdAt
      if (timeFilter !== 'all' && bankedOn) {
        const depositDate = new Date(bankedOn)
        const now = new Date()

        if (timeFilter === 'today') {
          const isToday = depositDate.toDateString() === now.toDateString()
          if (!isToday) return false
        } else if (timeFilter === 'week') {
          const startOfWeek = new Date(now)
          startOfWeek.setDate(now.getDate() - now.getDay())
          startOfWeek.setHours(0, 0, 0, 0)
          if (depositDate < startOfWeek) return false
        } else if (timeFilter === 'month') {
          const isThisMonth =
            depositDate.getMonth() === now.getMonth() &&
            depositDate.getFullYear() === now.getFullYear()
          if (!isThisMonth) return false
        }
      }

      return true
    })
  }, [deposits, searchTerm, filterType, timeFilter])

  const totalItems = filteredDeposits.length
  const totalPages = Math.ceil(totalItems / pageSize) || 1
  const paginatedDeposits = useMemo(() => {
    return filteredDeposits.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    )
  }, [filteredDeposits, currentPage, pageSize])

  const statsCards = [
    { title: 'Total deposits', value: formatCurrency(totalCredits), subtitle: `${deposits.length} transactions`, icon: ArrowDownLeft, tone: 'green' as const },
    { title: 'Manual transfers', value: formatCurrency(manualCredits), subtitle: `${manualDeposits.length} transactions`, icon: Landmark, tone: 'amber' as const },
    { title: 'Paystack automated', value: formatCurrency(paystackCredits), subtitle: `${paystackDeposits.length} transactions`, icon: ArrowRightLeft, tone: 'green' as const },
  ]

  const handleClearFilters = () => {
    setSearchTerm('')
    setFilterType('all')
    setTimeFilter('all')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
      eyebrow="Finance"
      title="Deposits Management"
      description="View and record customer deposit transactions."
      actions={
        <>
          <Button variant="outline" className="gap-2" onClick={() => setShowTransfer(true)}>
            <Repeat className="size-4" /> Transfer Balance
          </Button>
          <Button
          className="gap-2"
          onClick={() => navigate({ to: '/deposits/manual-deposit' as any })}
          >
          <Plus className="size-4" /> Record Manual Deposit
          </Button>
        </>
      }
    />

      <StatCardGrid count={statsCards.length}>
        {!isLoading && !isError && statsCards.map((card) => (
          <StatCard
            key={card.title}
            tone={card.tone}
            icon={<card.icon />}
            label={card.title}
            value={card.value}
            description={card.subtitle}
          />
        ))}
      </StatCardGrid>

      <FilterBar>
      <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      <Input
      type="text"
      placeholder="Search description, reference, or customer..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      className="pl-10 pr-8"
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
      {/* Time Filter Buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
      <span className="text-xs font-normal text-muted-foreground flex items-center gap-1 mr-1 shrink-0">
      <Filter className="size-3" /> Range:
      </span>
      {(['all', 'today', 'week', 'month'] as const).map((t) => (
      <Button
      key={t}
      variant={timeFilter === t ? 'default' : 'outline'}
      size="sm"
      className="h-8 text-xs capitalize whitespace-nowrap"
      onClick={() => setTimeFilter(t)}
      >
      {t === 'all' ? 'All Time' : t === 'week' ? 'This Week' : t === 'month' ? 'This Month' : 'Today'}
      </Button>
      ))}
      </div>
      </FilterBar>

      <Card>

        <CardContent className="pt-6">
          {/* Top Search & Time Filter Controls */}
          

          {/* Payment Method Tabs & Reset */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 mb-6">
            <div className="flex items-center gap-2 overflow-x-auto">
              <Button
                variant={filterType === 'all' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 gap-2 text-xs font-normal"
                onClick={() => setFilterType('all')}
 >
                All Deposits
                <Badge variant={filterType === 'all' ? 'secondary' : 'outline'} className="text-xs px-1.5 py-0 h-4">
                  {deposits.length}
                </Badge>
              </Button>

              <Button
                variant={filterType === 'manual' ? 'default' : 'ghost'}
                size="sm"
                className={`h-8 gap-2 text-xs font-normal ${filterType === 'manual' ? '' : 'hover:bg-warning/10 hover:text-warning'}`}
                onClick={() => setFilterType('manual')}
 >
                <Landmark className={cn('size-3.5', filterType === 'manual' ? 'text-primary-foreground' : 'text-warning')} />
                Manual Transfers
                <Badge variant={filterType === 'manual' ? 'secondary' : 'outline'} className="text-xs px-1.5 py-0 h-4">
                  {manualDeposits.length}
                </Badge>
              </Button>

              <Button
                variant={filterType === 'paystack' ? 'default' : 'ghost'}
                size="sm"
                className={`h-8 gap-2 text-xs font-normal ${filterType === 'paystack' ? '' : 'hover:bg-muted/10 hover:text-muted-foreground'}`}
                onClick={() => setFilterType('paystack')}
 >
                <ArrowRightLeft className={cn('size-3.5', filterType === 'paystack' ? 'text-primary-foreground' : 'text-muted-foreground')} />
                Paystack
                <Badge variant={filterType === 'paystack' ? 'secondary' : 'outline'} className="text-xs px-1.5 py-0 h-4">
                  {paystackDeposits.length}
                </Badge>
              </Button>
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={handleClearFilters}
 >
                <X className="size-3" /> Clear Filters
              </Button>
            )}
          </div>

          {isLoading ? (
            <PageLoader message="Loading deposits..." />
          ) : isError ? (
            <PageError message={(error as any)?.message || 'Failed to load'} onRetry={() => refetch()} />
          ) : filteredDeposits.length === 0 ? (
            <PageEmpty
              icon={<Banknote className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No deposits match your filter criteria' : 'No deposits yet'}
              description={hasFilters ? 'Try clearing or adjusting your search and filter buttons.' : 'Deposit transactions will appear here once recorded.'}
              actionLabel={hasFilters ? 'Clear Filters' : 'Record Deposit'}
              onAction={hasFilters ? handleClearFilters : () => navigate({ to: '/deposits/manual-deposit' as any })}
              hasFilters={hasFilters}
              onClearFilters={handleClearFilters}
 />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Recorded By</TableHead>
                      <TableHead className="text-right">Balance After</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedDeposits.map((deposit: Deposit) => {
                      const isPs = isPaystackDeposit(deposit)
                      return (
                        <TableRow
                          key={deposit._id}
                          className="hover:bg-muted/50 transition cursor-pointer"
                          onClick={() => navigate({ to: '/deposits/details' as any, state: { deposit } } as any)}
 >
                          {/* The banking date where there is one, and the
                              entry date only where there is not — labelled,
                              so the two are never mistaken for each other.
                              They coincide when a statement is matched the
                              same day, which is why the difference went
                              unnoticed for so long. */}
                          <TableCell className="text-xs whitespace-nowrap">
                            {deposit.depositDate ? (
                              <span className="text-muted-foreground">
                                {new Date(deposit.depositDate).toLocaleDateString('en-GB', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                })}
                              </span>
                            ) : deposit.createdAt ? (
                              <span
                                className="text-muted-foreground/70 italic"
                                title="No bank statement backs this credit, so it has no banking date. This is when it was entered."
                              >
                                {new Date(deposit.createdAt).toLocaleDateString('en-GB', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                })}
                                <span className="ml-1 not-italic">(entered)</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-success whitespace-nowrap">
                            +{formatCurrency(toNum(deposit.amount))}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {isPs ? (
                              <Badge variant="outline" className="bg-muted/10 text-foreground dark:text-muted-foreground border-border/20 text-xs font-normal">
                                Paystack
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs font-normal">
                                Manual Transfer
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {deposit.description || '—'}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {deposit.reference || '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {deposit.recorderFirstName
                              ? `${deposit.recorderFirstName} ${deposit.recorderSurname || ''}`
                              : isPs ? 'Paystack' : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-normal whitespace-nowrap">
                            {formatCurrency(toNum(deposit.balanceAfter || 0))}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate({ to: '/deposits/details' as any, state: { deposit } } as any)
                              }}
 >
                              <Eye className="size-3.5" />
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

      <TransferBalanceDialog open={showTransfer} onOpenChange={setShowTransfer} />
    </div>
  )
}
