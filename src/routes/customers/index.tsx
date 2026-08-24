import { useState, useMemo } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import {
  Users, Search, Plus, Phone, Building2, X, Wallet, Download,
  TrendingUp, Pencil, Archive, MoonStar, Flame, CalendarPlus, MessageSquare,
} from 'lucide-react'
import {
  useCustomerList, useUpdateCustomer,
  type CustomerRow, type CustomerSort, type CustomerActivity,
} from '#/lib/hooks/useCustomers'
import { useDepots, type DepotItem } from '#/lib/hooks/useDepots'
import { useToast } from '#/lib/hooks/useToast'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { triggerDownload } from '#/lib/report-theme'
import api from '#/lib/api/http'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/customers/')({
  beforeLoad: () => routeGuard('/customers'),
  component: CustomerDashboard,
})

const money = (v: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(v)

/** Big money in a stat card, where the exact naira never matters. */
const compactMoney = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `₦${(v / 1_000_000_000).toFixed(1)}bn`
  if (Math.abs(v) >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1_000) return `₦${(v / 1_000).toFixed(0)}k`
  return money(v)
}

const relativeDate = (iso: string | null) => {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * The four activity bands, with the wording the page uses for each.
 *
 * Colour is carried on the badge only and follows meaning, not decoration:
 * dormant is amber because it is the band worth acting on — someone who used
 * to buy and has stopped — while "never ordered" stays grey, since a contact
 * who has not yet bought is not a problem, just not yet a customer.
 */
const ACTIVITY: Record<CustomerActivity, { label: string; className: string }> = {
  frequent: { label: 'Frequent', className: 'bg-accent/10 text-accent border-accent/20' },
  occasional: { label: 'Occasional', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900' },
  dormant: { label: 'Dormant', className: 'bg-warning/10 text-warning border-warning/20' },
  never: { label: 'Never ordered', className: 'bg-muted text-muted-foreground border-border' },
}

const SORT_LABELS: Array<{ value: CustomerSort; label: string }> = [
  { value: 'active', label: 'Most active' },
  { value: 'recent', label: 'Most recent order' },
  { value: 'spend', label: 'Highest lifetime value' },
  { value: 'balance', label: 'Highest wallet balance' },
  { value: 'newest', label: 'Newest customer' },
  { value: 'name', label: 'Name (A–Z)' },
]

/** RFC 4180 enough for Excel: quote everything, double any inner quote. */
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

function CustomerDashboard() {
  const navigate = useNavigate()
  const toast = useToast()
  const updateCustomer = useUpdateCustomer()

  const [searchTerm, setSearchTerm] = useState('')
  const [status, setStatus] = useState('Active')
  const [depotId, setDepotId] = useState('')
  const [activity, setActivity] = useState<CustomerActivity | ''>('')
  const [hasBalance, setHasBalance] = useState<'yes' | 'no' | ''>('')
  const [optedOut, setOptedOut] = useState<'yes' | 'no' | ''>('')
  const [sort, setSort] = useState<CustomerSort>('active')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [archiving, setArchiving] = useState<CustomerRow | null>(null)

  const { data: depots = [] } = useDepots({ limit: 200 })

  const POLL_INTERVAL = 30_000
  const filters = { search: searchTerm || undefined, status, depotId, activity, hasBalance, optedOut, sort }
  const { data, isLoading, isError, error, refetch, isFetching } = useCustomerList({
    ...filters,
    page: currentPage,
    limit: pageSize,
    refetchInterval: POLL_INTERVAL,
  })

  const customers = data?.customers ?? []
  const summary = data?.summary
  const totalItems = data?.pagination?.total ?? 0
  const totalPages = data?.pagination?.pages ?? 1

  // Any filter change puts you back on page one — adjusted during render
  // rather than in an effect, so the list never paints one frame of page 7 of
  // the old filter before correcting itself.
  const filterSignature = [searchTerm, status, depotId, activity, hasBalance, optedOut, sort].join('|')
  const [lastSignature, setLastSignature] = useState(filterSignature)
  if (lastSignature !== filterSignature) {
    setLastSignature(filterSignature)
    setCurrentPage(1)
  }

  const hasFilters = Boolean(
    searchTerm || status !== 'Active' || depotId || activity || hasBalance || optedOut,
  )
  const clearFilters = () => {
    setSearchTerm(''); setStatus('Active'); setDepotId('')
    setActivity(''); setHasBalance(''); setOptedOut(''); setSort('active')
  }

  /**
   * Phone numbers for everyone the current filters match — not just the page
   * on screen. The page is 50 rows; the filter is usually hundreds, and a
   * contact list that silently stopped at the page boundary is worse than
   * none, so this refetches the whole matching set before writing the file.
   */
  const [exporting, setExporting] = useState(false)
  const exportPhones = async () => {
    setExporting(true)
    try {
      const { customers: all } = await refetchAll()
      if (!all.length) { toast.error('No customers match these filters'); return }
      const header = ['Name', 'Company', 'Phone', 'Email', 'Location', 'Activity', 'Orders', 'Last order', 'Lifetime value']
      const body = all.map((c) => [
        c.name, c.companyName, c.phone, c.email,
        c.primaryDepotName || '', ACTIVITY[c.activityBand]?.label || '',
        c.orderCount, c.lastOrderAt ? new Date(c.lastOrderAt).toISOString().slice(0, 10) : '',
        Number(c.lifetimeValue || 0),
      ])
      const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')
      // The BOM is what makes Excel read the naira sign and any accented name
      // correctly instead of mojibake.
      triggerDownload(
        new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
        `customer-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      toast.success(`${all.length} contact${all.length === 1 ? '' : 's'} exported`)
    } catch (err: any) {
      toast.error(err?.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  /** The same filters, unpaginated — used only by the export. */
  const refetchAll = async () => {
    const params = Object.fromEntries(
      Object.entries({ ...filters, limit: 5000, page: 1 }).filter(([, v]) => v !== '' && v != null),
    )
    const res = await api.get('/customers', { params })
    return res.data.data as { customers: CustomerRow[] }
  }

  const copyPhones = async () => {
    try {
      const { customers: all } = await refetchAll()
      const numbers = all.map((c) => c.phone).filter(Boolean)
      if (!numbers.length) { toast.error('No phone numbers to copy'); return }
      await navigator.clipboard.writeText(numbers.join(', '))
      toast.success(`${numbers.length} phone number${numbers.length === 1 ? '' : 's'} copied`)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const archive = async () => {
    if (!archiving) return
    await updateCustomer.mutateAsync({
      id: String(archiving.id ?? archiving._id),
      data: { status: 'Inactive' },
    })
    setArchiving(null)
  }

  const depotOptions = useMemo(
    () => [...depots].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [depots],
  )

  if (isLoading) return <PageLoader message="Loading customers..." />
  if (isError) return <PageError message={(error as any)?.message || 'Failed to load customers'} onRetry={() => refetch()} />

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Orders"
        title="Customers"
        description="Who buys, how often, and from where — sorted by the ones trading most."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={copyPhones}>
              <Phone className="size-4 mr-2" />Copy numbers
            </Button>
            <Button variant="outline" size="sm" onClick={exportPhones} disabled={exporting}>
              <Download className="size-4 mr-2" />{exporting ? 'Exporting…' : 'Export contacts'}
            </Button>
            <Button size="sm" onClick={() => navigate({ to: '/customers/form' })}>
              <Plus className="size-4 mr-2" />Add Customer
            </Button>
          </>
        }
      />

      {/*
        What the desk actually acts on. "Active" was two of the four cards and
        every customer on the book is Active, so it read 1,365 / 0 and told
        nobody anything. These are the figures that move: who bought this
        month, who used to buy and stopped, and what the book is worth.
      */}
      {summary && (
        <StatCardGrid count={6}>
          <StatCard
            icon={<Users />} label="Customers" value={summary.total.toLocaleString()}
            description={`${summary.newThisMonth.toLocaleString()} joined this month`}
          />
          <StatCard
            tone="green" icon={<Flame />} label="Ordered this month"
            value={summary.orderedThisMonth.toLocaleString()}
            description={`${summary.frequent.toLocaleString()} ordering frequently`}
          />
          <StatCard
            tone="amber" icon={<MoonStar />} label="Dormant"
            value={summary.dormant.toLocaleString()}
            description="Bought before, nothing in 90 days"
            className="cursor-pointer"
            onClick={() => setActivity(activity === 'dormant' ? '' : 'dormant')}
          />
          <StatCard
            icon={<CalendarPlus />} label="Never ordered"
            value={summary.never.toLocaleString()}
            description="On the book, no order yet"
            className="cursor-pointer"
            onClick={() => setActivity(activity === 'never' ? '' : 'never')}
          />
          <StatCard
            icon={<TrendingUp />} label="Lifetime revenue"
            value={compactMoney(summary.lifetimeRevenue)}
            description="Paid orders, all time"
          />
          <StatCard
            icon={<Wallet />} label="Wallet balance" value={compactMoney(summary.totalBalance)}
            description="Held across every customer"
          />
        </StatCardGrid>
      )}

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
          <Input
            placeholder="Name, company, phone, email…"
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

        <NativeSelect className="w-44" value={sort} onChange={(e) => setSort(e.target.value as CustomerSort)}>
          {SORT_LABELS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </NativeSelect>

        <NativeSelect className="w-44" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
          <option value="">All locations</option>
          {depotOptions.map((d: DepotItem) => (
            <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
          ))}
        </NativeSelect>

        <NativeSelect className="w-40" value={activity} onChange={(e) => setActivity(e.target.value as CustomerActivity | '')}>
          <option value="">All activity</option>
          <option value="frequent">Frequent (3+ / 90d)</option>
          <option value="occasional">Occasional (1–2 / 90d)</option>
          <option value="dormant">Dormant</option>
          <option value="never">Never ordered</option>
        </NativeSelect>

        <NativeSelect className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Active">Active</option>
          <option value="Inactive">Archived</option>
          <option value="Pending">Pending</option>
          <option value="all">All statuses</option>
        </NativeSelect>

        <NativeSelect className="w-40" value={hasBalance} onChange={(e) => setHasBalance(e.target.value as 'yes' | 'no' | '')}>
          <option value="">Any balance</option>
          <option value="yes">Has wallet balance</option>
          <option value="no">No balance</option>
        </NativeSelect>

        <NativeSelect className="w-44" value={optedOut} onChange={(e) => setOptedOut(e.target.value as 'yes' | 'no' | '')}>
          <option value="">Any marketing status</option>
          <option value="no">Reachable</option>
          <option value="yes">Opted out</option>
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
          {customers.length === 0 ? (
            <PageEmpty
              icon={<Users className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No customers match your filters' : 'No customers yet'}
              description={hasFilters ? 'Try widening the search or clearing a filter.' : 'Get started by adding your first customer.'}
              actionLabel={hasFilters ? undefined : 'Add Customer'}
              onAction={hasFilters ? undefined : () => navigate({ to: '/customers/form' })}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
            />
          ) : (
            <>
              <div className={cn('overflow-x-auto transition-opacity', isFetching && 'opacity-60')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden lg:table-cell">Location</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="hidden md:table-cell">Last order</TableHead>
                      <TableHead className="text-right">Lifetime value</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((c) => {
                      const band = ACTIVITY[c.activityBand] ?? ACTIVITY.never
                      const open = () => navigate({
                        to: '/customers/details' as any,
                        search: { id: c._id || c.id } as any,
                        state: { customer: c },
                      } as any)
                      return (
                        <TableRow
                          key={c._id || c.id}
                          tabIndex={0}
                          role="link"
                          aria-label={`View ${c.name}`}
                          className="cursor-pointer hover:bg-muted transition"
                          onClick={open}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                          }}
                        >
                          <TableCell>
                            <p className="font-medium uppercase">{c.name}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {c.companyName && (
                                <span className="flex items-center gap-1"><Building2 className="size-3" />{c.companyName}</span>
                              )}
                              <span className="flex items-center gap-1"><Phone className="size-3" />{c.phone}</span>
                              {c.marketingOptOut && (
                                <span className="flex items-center gap-1 text-warning">
                                  <MessageSquare className="size-3" />Opted out
                                </span>
                              )}
                              {c.status !== 'Active' && (
                                <Badge variant="outline" className="h-4 px-1 text-xs font-normal">{c.status === 'Inactive' ? 'Archived' : c.status}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {c.primaryDepotName || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('font-normal', band.className)}>{band.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="font-medium">{c.orderCount.toLocaleString()}</span>
                            {c.ordersRecent > 0 && (
                              <span className="ml-1 text-xs text-muted-foreground">({c.ordersRecent} recent)</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                            {relativeDate(c.lastOrderAt)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                            {compactMoney(Number(c.lifetimeValue || 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            <span className={cn(Number(c.balance) > 0 && 'font-semibold text-accent')}>
                              {money(Number(c.balance) || 0)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost" size="sm" className="size-8 p-0" title={`Edit ${c.name}`}
                                onClick={() => navigate({
                                  to: '/customers/form' as any,
                                  state: { customer: c, isEdit: true },
                                } as any)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              {/* Archive, not delete: the orders, deposits and
                                  payment history behind a customer still have
                                  to reconcile after they leave the list. */}
                              <Button
                                variant="ghost" size="sm"
                                className="size-8 p-0 text-muted-foreground hover:text-warning"
                                title={c.status === 'Inactive' ? 'Already archived' : `Archive ${c.name}`}
                                disabled={c.status === 'Inactive'}
                                onClick={() => setArchiving(c)}
                              >
                                <Archive className="size-3.5" />
                              </Button>
                            </div>
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

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => { if (!o) setArchiving(null) }}
        title={`Archive ${archiving?.name ?? ''}?`}
        description="They drop out of the active list and stop receiving messages. Their orders, deposits and wallet balance are untouched, and you can set them back to Active at any time."
        confirmLabel="Archive"
        loading={updateCustomer.isPending}
        onConfirm={archive}
      />
    </div>
  )
}
