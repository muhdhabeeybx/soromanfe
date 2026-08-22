import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip, LiveDot } from '#/components/ui/status-chip'
import { HoverArrowLink } from '#/components/ui/hover-arrow-link'
import { Skeleton } from '#/components/ui/skeleton'
import { PeriodFilter, type Period } from '#/components/overview/PeriodFilter'
import { RevenueTrendChart } from '#/components/overview/RevenueTrendChart'
import { OrderStatusChart } from '#/components/overview/OrderStatusChart'
import { FleetUtilizationChart } from '#/components/overview/FleetUtilizationChart'
import { ActivityFeed } from '#/components/overview/ActivityFeed'
import { useDashboardOverview } from '#/lib/hooks/useDashboard'
import { useAuthStore } from '#/modules/auth'
import { formatCurrency, formatLitres, formatNumber, formatPercent } from '#/lib/format'
import { cn } from '#/lib/utils'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY, PANEL_FOOTER } from '#/lib/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  DollarSign,
  ShoppingCart,
  Users,
  Truck,
  AlertTriangle,
  Package,
  Flame,
} from 'lucide-react'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/overview/')({
  beforeLoad: () => routeGuard('/overview'),
  component: OverviewDashboard,
})

function PanelSkeleton() {
  return (
    <div className={cn(PANEL, 'p-6')}>
      <Skeleton className="mb-4 h-4 w-32" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function OverviewDashboard() {
  const [period, setPeriod] = useState<Period>('month')
  const { data, isLoading } = useDashboardOverview(period)
  const user = useAuthStore((s) => s.user)

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader
          eyebrow="Overview"
          title="Dashboard"
          description={`Welcome back, ${user?.firstName || 'Admin'}.`}
          actions={<PeriodFilter value={period} onChange={setPeriod} />}
        />
        <StatCardGrid count={5}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn(PANEL, 'p-4')}>
              <Skeleton className="mb-2 h-10 w-10 rounded-2xl" />
              <Skeleton className="mt-5 h-3 w-20" />
              <Skeleton className="mt-2 h-8 w-28" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </StatCardGrid>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      </div>
    )
  }

  const rev = data?.revenue || {}
  const orders = data?.orders || { totals: {}, byStatus: [] }
  const wallet = data?.wallet || { movement: {}, balances: {}, activeHolds: {} }
  const pfi = data?.pfi || { byStatus: [] }
  const outstanding = data?.outstanding || { totalOutstanding: 0, customers: [] }
  const fleet = data?.fleet || { total: 0, inTransit: 0, idle: 0, maintenance: 0 }
  const drv = data?.drivers || { total: 0, active: 0, onTrip: 0, offDuty: 0 }
  const cust = data?.customers || { total: 0, newThisPeriod: 0 }
  const trend = data?.revenueTrend || []
  const orderStatus = data?.orderStatusBreakdown || []
  const activity = data?.recentActivity || []
  const depotLeaderboard = data?.depotLeaderboard || []
  const dangote = data?.dangote || { totalRequests: 0, totalValue: 0, paidValue: 0, byStatus: [] }
  const lpg = data?.lpg || { totalOrders: 0, totalValue: 0, paidValue: 0, stations: { total: 0, active: 0 }, byStatus: [] }

  const totalOrders = orders.totals?.orders || 0
  const combinedRevenue = rev.combined || 0
  const fleetUtilization = fleet.total > 0 ? Math.round(((fleet.inTransit || 0) / fleet.total) * 100) : 0
  const totalOutstanding = outstanding.totalOutstanding || 0

  const activePfis = pfi.byStatus?.filter((s: { status: string }) => s.status === 'active') || []
  const totalRemainingLitres = activePfis.reduce((sum: number, p: { remainingLitres?: number }) => sum + (p.remainingLitres || 0), 0)
  const totalPfiValue = activePfis.reduce((sum: number, p: { totalValue?: number }) => sum + Number(p.totalValue || 0), 0)

  const fleetChartData = [
    { name: 'In Transit', value: fleet.inTransit || 0, color: 'var(--chart-1)' },
    { name: 'Idle', value: fleet.idle || 0, color: 'var(--chart-4)' },
    { name: 'Maintenance', value: fleet.maintenance || 0, color: 'var(--destructive)' },
  ]

  const orderStatusData = orderStatus.map((s: { name: string; value: number }) => ({
    name: s.name,
    value: s.value,
    color: '',
  }))

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={`Welcome back, ${user?.firstName || 'Admin'}. Here's what's happening ${data?.period?.label?.toLowerCase() || 'this month'}.`}
        actions={<PeriodFilter value={period} onChange={setPeriod} />}
      />

      <StatCardGrid count={2}>
        <StatCard
          icon={<DollarSign />}
          label="Revenue"
          value={formatCurrency(combinedRevenue)}
          tone="green"
          // description={`${formatCurrency(rev.orders?.total || 0)} from orders`}
        />
        <StatCard
          icon={<ShoppingCart />}
          label="Orders"
          value={formatNumber(totalOrders)}
          tone="blue"
          // description={`${formatCurrency(orders.totals?.paidValue || 0)} collected`}
        />
        <StatCard
          icon={<Users />}
          label="Total Customers"
          value={formatNumber(cust.total)}
          tone="green"
          // description={`${cust.newThisPeriod || 0} new ${data?.period?.label?.toLowerCase() || 'this month'}`}
        />
        <StatCard
          icon={<Truck />}
          label="Trucks Utilization"
          value={formatPercent(fleetUtilization)}
          tone={fleetUtilization > 60 ? 'green' : fleetUtilization > 30 ? 'amber' : 'red'}
          // description={`${fleet.inTransit || 0} of ${fleet.total} in use`}
        />
        {/* <StatCard
          icon={<AlertTriangle />}
          label="Delivery Customers Outstanding"
          value={formatCurrency(totalOutstanding)}
          tone={totalOutstanding > 0 ? 'amber' : 'green'}
          // description={`${outstanding.customers?.length || 0} customers owe`}
        /> */}
      </StatCardGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-label="Revenue trend">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Revenue trend</span>
            <StatusChip tone="accent" size="rail">
              {data?.period?.label}
            </StatusChip>
          </div>
          <div className={PANEL_BODY}>
            <RevenueTrendChart data={trend} />
          </div>
          {/* <div className={cn(PANEL_FOOTER, 'gap-4')}>
            <span className="text-xs text-muted-foreground">
              Orders: <span className="font-semibold text-foreground">{formatCurrency(rev.orders?.total || 0)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Offline: <span className="font-semibold text-foreground">{formatCurrency(rev.offlineSales?.total || 0)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Delivery: <span className="font-semibold text-foreground">{formatCurrency(rev.deliverySales?.paymentAmount || 0)}</span>
            </span>
          </div> */}
        </section>

        {/* <section className={PANEL} aria-label="Orders by status">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Orders by status</span>
          </div>
          <div className={PANEL_BODY}>
            <OrderStatusChart data={orderStatusData} total={totalOrders} />
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-end')}>
            <HoverArrowLink to={'/orders' as any}>View all orders</HoverArrowLink>
          </div>
        </section> */}

        <section className={PANEL} aria-label="Financial summary">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Financial summary</span>
          </div>
          <div className="divide-y divide-foreground/10">
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total revenue</span>
              <span className="text-sm font-semibold">{formatCurrency(combinedRevenue)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Order revenue</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.orders?.total || 0)}</span>
            </div>
            {/* <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Offline sales</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.offlineSales?.total || 0)}</span>
            </div> */}
            {/* <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Delivery payments</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.deliverySales?.paymentAmount || 0)}</span>
            </div> */}
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Customer wallets</span>
              <span className="text-sm font-semibold">{formatCurrency(Number(wallet.balances?.totalBalance || 0))}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Active holds</span>
              <span className="text-sm font-semibold text-warning">{formatCurrency(Number(wallet.activeHolds?.totalHeld || 0))}</span>
            </div>
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-between')}>
            <span className="text-xs text-muted-foreground">
              Manual Deposits: <span className="font-semibold text-foreground">{formatCurrency(Number(wallet.movement?.credits || 0))}</span>
            </span>
            <HoverArrowLink to={'/deposits' as any}>View deposits</HoverArrowLink>
          </div>
        </section>

      </div>

      {false && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-label="Financial summary">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Financial summary</span>
          </div>
          <div className="divide-y divide-foreground/10">
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total revenue</span>
              <span className="text-sm font-semibold">{formatCurrency(combinedRevenue)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Order revenue</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.orders?.total || 0)}</span>
            </div>
            {/* <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Offline sales</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.offlineSales?.total || 0)}</span>
            </div> */}
            {/* <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Delivery payments</span>
              <span className="text-sm font-semibold">{formatCurrency(rev.deliverySales?.paymentAmount || 0)}</span>
            </div> */}
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Customer wallets</span>
              <span className="text-sm font-semibold">{formatCurrency(Number(wallet.balances?.totalBalance || 0))}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Active holds</span>
              <span className="text-sm font-semibold text-warning">{formatCurrency(Number(wallet.activeHolds?.totalHeld || 0))}</span>
            </div>
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-between')}>
            <span className="text-xs text-muted-foreground">
              Deposits: <span className="font-semibold text-foreground">{formatCurrency(Number(wallet.movement?.credits || 0))}</span>
            </span>
            <HoverArrowLink to={'/deposits' as any}>View deposits</HoverArrowLink>
          </div>
        </section>

        {/* <section className={PANEL} aria-label="Fleet and operations">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Fleet &amp; Operations</span>
            <StatusChip tone="accent" size="rail">
              <LiveDot />
              Live
            </StatusChip>
          </div>
          <div className={PANEL_BODY}>
            <FleetUtilizationChart data={fleetChartData} />
          </div>
          <div className="divide-y divide-foreground/10">
            <div className="flex items-center justify-between px-6 py-3">
              <span className="text-sm">Active drivers</span>
              <span className="text-sm font-semibold text-accent">{drv.active}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3">
              <span className="text-sm">On trip</span>
              <span className="text-sm font-semibold text-warning">{drv.onTrip}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3">
              <span className="text-sm">Off duty</span>
              <span className="text-sm font-semibold text-muted-foreground">{drv.offDuty}</span>
            </div>
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-end')}>
            <HoverArrowLink to={'/fleet-trucks' as any}>View fleet</HoverArrowLink>
          </div>
        </section> */}
      </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-label="PFI and inventory">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>PFI &amp; Inventory</span>
          </div>
          <div className="divide-y divide-foreground/10">
            {/* <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Active PFIs</span>
              <span className="text-sm font-semibold">{activePfis.length}</span>
            </div> */}
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total Quantity remaining</span>
              <span className="text-sm font-semibold">{formatLitres(totalRemainingLitres)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Inventory value</span>
              <span className="text-sm font-semibold">{formatCurrency(totalPfiValue)}</span>
            </div>
            {(pfi.byStatus || []).map((s: { status: string; pfiCount: number; remainingLitres?: number }) => (
              <div key={s.status} className="flex items-center justify-between px-6 py-3.5">
                <span className="text-sm capitalize">{s.status} PFIs</span>
                <span className="text-sm font-semibold">
                  {s.pfiCount} &middot; {formatLitres(s.remainingLitres || 0)}
                </span>
              </div>
            ))}
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-end')}>
            <HoverArrowLink to={'/pfi' as any}>View PFIs</HoverArrowLink>
          </div>
        </section>

        <section className={PANEL} aria-label="Outstanding payments">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Outstanding payments</span>
            {totalOutstanding > 0 && (
              <StatusChip tone="warning" size="rail">
                {formatCurrency(totalOutstanding)}
              </StatusChip>
            )}
          </div>
          {outstanding.customers?.length > 0 ? (
            <>
              <div className="divide-y divide-foreground/10">
                {outstanding.customers.slice(0, 5).map((c: { customerName: string; customerType?: string; outstanding?: number }, i: number) => (
                  <div key={i} className="flex items-center justify-between px-6 py-3.5">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.customerName}</span>
                      <span className="text-xs text-muted-foreground capitalize">{c.customerType?.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-warning">
                      {formatCurrency(Number(c.outstanding || 0))}
                    </span>
                  </div>
                ))}
              </div>
              <div className={cn(PANEL_FOOTER, 'justify-end')}>
                <HoverArrowLink to={'/delivery-sales' as any}>View all</HoverArrowLink>
              </div>
            </>
          ) : (
            <div className={PANEL_BODY}>
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No outstanding payments
              </div>
            </div>
          )}
        </section>
      </div>

      <section className={PANEL} aria-label="Depot leaderboard">
        <div className={PANEL_RAIL}>
          <span className={MICRO}>Depot Ranking</span>
          <StatusChip tone="accent" size="rail">
            By revenue
          </StatusChip>
        </div>
        {depotLeaderboard.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Rank</TableHead>
                <TableHead>Depot</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depotLeaderboard.map((d: { id: string; name: string; orderCount: number; volume: number; revenue: number }, i: number) => (
                <TableRow key={d.id}>
                  <TableCell className="font-semibold">{i + 1}</TableCell>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-right">{formatNumber(d.orderCount)}</TableCell>
                  <TableCell className="text-right">{formatLitres(d.volume)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(d.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className={PANEL_BODY}>
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              No depot data for this period
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-label="Dangote orders">
          <div className={PANEL_RAIL}>
            <span className="flex items-center gap-2">
              <Package className="size-3.5" />
              <span className={MICRO}>Dangote delivery</span>
            </span>
            {dangote.totalRequests > 0 && (
              <StatusChip tone="accent" size="rail">
                {dangote.totalRequests} requests
              </StatusChip>
            )}
          </div>
          <div className="divide-y divide-foreground/10">
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total requests</span>
              <span className="text-sm font-semibold">{dangote.totalRequests}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total value</span>
              <span className="text-sm font-semibold">{formatCurrency(dangote.totalValue)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Paid value</span>
              <span className="text-sm font-semibold text-accent">{formatCurrency(dangote.paidValue)}</span>
            </div>
            {(dangote.byStatus || []).map((s: { status: string; count: number; total: number }) => (
              <div key={s.status} className="flex items-center justify-between px-6 py-3.5">
                <span className="text-sm">{s.status}</span>
                <span className="text-sm font-semibold">
                  {s.count} &middot; {formatCurrency(Number(s.total))}
                </span>
              </div>
            ))}
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-end')}>
            <HoverArrowLink to={'/dangote-orders' as any}>View orders</HoverArrowLink>
          </div>
        </section>

        <section className={PANEL} aria-label="LPG cooking gas">
          <div className={PANEL_RAIL}>
            <span className="flex items-center gap-2">
              <Flame className="size-3.5" />
              <span className={MICRO}>LPG cooking gas</span>
            </span>
            {lpg.totalOrders > 0 && (
              <StatusChip tone="accent" size="rail">
                {lpg.totalOrders} orders
              </StatusChip>
            )}
          </div>
          <div className="divide-y divide-foreground/10">
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total orders</span>
              <span className="text-sm font-semibold">{lpg.totalOrders}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Total value</span>
              <span className="text-sm font-semibold">{formatCurrency(lpg.totalValue)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Paid value</span>
              <span className="text-sm font-semibold text-accent">{formatCurrency(lpg.paidValue)}</span>
            </div>
            <div className="flex items-center justify-between px-6 py-3.5">
              <span className="text-sm">Stations</span>
              <span className="text-sm font-semibold">
                {lpg.stations?.active || 0} active / {lpg.stations?.total || 0} total
              </span>
            </div>
            {(lpg.byStatus || []).map((s: { status: string; count: number; total: number }) => (
              <div key={s.status} className="flex items-center justify-between px-6 py-3.5">
                <span className="text-sm">{s.status}</span>
                <span className="text-sm font-semibold">
                  {s.count} &middot; {formatCurrency(Number(s.total))}
                </span>
              </div>
            ))}
          </div>
          <div className={cn(PANEL_FOOTER, 'justify-end')}>
            <HoverArrowLink to={'/lpg-orders' as any}>View orders</HoverArrowLink>
          </div>
        </section>
      </div>

      <section className={PANEL} aria-label="Recent activity">
        <div className={PANEL_RAIL}>
          <span className={MICRO}>Recent activity</span>
          <HoverArrowLink to={'/orders' as any}>View all</HoverArrowLink>
        </div>
        <ActivityFeed data={activity} />
      </section>
    </div>
  )
}
