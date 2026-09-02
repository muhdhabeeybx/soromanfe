import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { PageError } from '#/components/PageError'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { HoverArrowLink } from '#/components/ui/hover-arrow-link'
import { Skeleton } from '#/components/ui/skeleton'
import { PanelRow, PanelRows } from '#/components/ui/panel-row'
import { PeriodFilter, PERIOD_LABELS, type Period } from '#/components/overview/PeriodFilter'
import { RevenueTrendChart } from '#/components/overview/RevenueTrendChart'
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
  Package,
  Flame,
} from 'lucide-react'
import { roleOnlyGuard } from '#/lib/route-guard'
import { ROLE_STRING_TO_ID } from '#/lib/rbac'

/**
 * The whole company at a glance — revenue, orders, PFI, fleet, LPG, Dangote.
 *
 * Moved off /overview, which is now the "what is waiting on me" landing page
 * everyone gets. This one answers a different question, for a smaller
 * audience: how is the business doing. Most people do not need it and were
 * being shown it because it happened to be the page login pointed at.
 *
 * Gated explicitly rather than through ROUTE_PERMISSIONS, because
 * canAccessRoute is open by design dashboard-wide (see rbac.ts) — a `view`
 * list there would read like a restriction while restricting nothing.
 */
export const Route = createFileRoute('/company-dashboard/')({
  // Admin and super admin. The same two ids the nav item names, so the page
  // and the link to it cannot disagree.
  beforeLoad: () => roleOnlyGuard([ROLE_STRING_TO_ID.admin]),
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

/**
 * The skeleton mirrors the loaded page exactly — four tiles in the same two
 * columns, then the same run of panels. It used to show five tiles across four
 * columns and stop after the first panel row, so the whole page reflowed under
 * the reader the moment the request landed.
 *
 * The tiles carry no description line because none of the live cards do.
 */
function OverviewSkeleton() {
  return (
    <>
      <StatCardGrid count={2}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn(PANEL, 'p-4')}>
            <Skeleton className="mb-2 h-10 w-10 rounded-2xl" />
            <Skeleton className="mt-5 h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-28" />
          </div>
        ))}
      </StatCardGrid>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
      <PanelSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
      <PanelSkeleton />
    </>
  )
}

function OverviewDashboard() {
  const [period, setPeriod] = useState<Period>('month')
  const { data, isLoading, isError, error, refetch } = useDashboardOverview(period)
  const user = useAuthStore((s) => s.user)

  // Named off the filter rather than the response, so the sentence under the
  // title is already right while the request is still in flight.
  const periodLabel = PERIOD_LABELS[period].toLowerCase()

  const header = (
    <PageHeader
      eyebrow="Overview"
      title="Dashboard"
      description={`Welcome back, ${user?.firstName || 'Admin'}. Here's what's happening ${periodLabel}.`}
      actions={<PeriodFilter value={period} onChange={setPeriod} />}
    />
  )

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <OverviewSkeleton />
      </div>
    )
  }

  // Every figure on this page falls back to zero, so without this a failed
  // request renders as a calm dashboard reporting no revenue and no orders.
  if (isError) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <PageError
          message={(error as Error)?.message || 'Could not load the dashboard.'}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const rev = data?.revenue || {}
  const orders = data?.orders || { totals: {}, byStatus: [] }
  const wallet = data?.wallet || { movement: {}, balances: {}, activeHolds: {} }
  const pfi = data?.pfi || { byStatus: [] }
  const outstanding = data?.outstanding || { totalOutstanding: 0, customers: [] }
  const fleet = data?.fleet || { total: 0, inTransit: 0, idle: 0, maintenance: 0 }
  const cust = data?.customers || { total: 0, newThisPeriod: 0 }
  const trend = data?.revenueTrend || []
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

  return (
    <div className="animate-fade-in space-y-6">
      {header}

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
          // With no trucks on the books there is nothing to be alarmed about,
          // so an empty fleet reads neutral rather than red.
          tone={
            fleet.total === 0
              ? 'neutral'
              : fleetUtilization > 60
                ? 'green'
                : fleetUtilization > 30
                  ? 'amber'
                  : 'red'
          }
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
          <PanelRows>
            {/* Total revenue is the headline — everything under it is a
                component of it or a position alongside it. */}
            <PanelRow lead label="Total revenue" value={formatCurrency(combinedRevenue)} />
            <PanelRow label="Order revenue" value={formatCurrency(rev.orders?.total || 0)} />
            {/* <PanelRow label="Offline sales" value={formatCurrency(rev.offlineSales?.total || 0)} /> */}
            {/* <PanelRow label="Delivery payments" value={formatCurrency(rev.deliverySales?.paymentAmount || 0)} /> */}
            <PanelRow label="Customer wallets" value={formatCurrency(Number(wallet.balances?.totalBalance || 0))} />
            <PanelRow
              label="Active holds"
              hint="Committed against unreleased orders"
              tone="warning"
              value={formatCurrency(Number(wallet.activeHolds?.totalHeld || 0))}
            />
          </PanelRows>
          <div className={cn(PANEL_FOOTER, 'justify-between')}>
            <span className="text-xs text-muted-foreground">
              Manual Deposits: <span className="font-semibold text-foreground">{formatCurrency(Number(wallet.movement?.credits || 0))}</span>
            </span>
            <HoverArrowLink to={'/deposits' as any}>View deposits</HoverArrowLink>
          </div>
        </section>

      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-label="PFI and inventory">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>PFI &amp; Inventory</span>
          </div>
          <PanelRows>
            {/* <PanelRow label="Active PFIs" value={formatNumber(activePfis.length)} /> */}
            <PanelRow
              lead
              label="Total quantity remaining"
              hint="Across active PFIs"
              value={formatLitres(totalRemainingLitres)}
            />
            <PanelRow label="Inventory value" value={formatCurrency(totalPfiValue)} />
            {(pfi.byStatus || []).map((s: { status: string; pfiCount: number; remainingLitres?: number }) => (
              <PanelRow
                key={s.status}
                label={<span className="capitalize">{s.status} PFIs</span>}
                hint={`${formatNumber(s.pfiCount)} batch${s.pfiCount === 1 ? '' : 'es'}`}
                value={formatLitres(s.remainingLitres || 0)}
              />
            ))}
          </PanelRows>
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
              <PanelRows>
                {outstanding.customers.slice(0, 5).map((c: { customerName: string; customerType?: string; outstanding?: number }, i: number) => (
                  <PanelRow
                    key={c.customerName || i}
                    label={<span className="font-medium text-foreground">{c.customerName}</span>}
                    hint={<span className="capitalize">{c.customerType?.replace(/_/g, ' ')}</span>}
                    tone="warning"
                    value={formatCurrency(Number(c.outstanding || 0))}
                  />
                ))}
              </PanelRows>
              <div className={cn(PANEL_FOOTER, 'justify-end')}>
                {/* These figures are delivery sales netted off per customer, and
                  the customer database is where they are carried. */}
              <HoverArrowLink to={'/delivery-customer' as any}>View all</HoverArrowLink>
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
        {/* The table's own cells are p-2 while every rail and row in a PANEL
            is px-6, so without the gutter classes below the first column
            starts 16px left of the heading above it. First and last cells
            take the panel's gutter; the rest keep the table's own rhythm. */}
        {depotLeaderboard.length > 0 ? (
          <Table className="[&_td:first-child]:pl-6 [&_th:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:last-child]:pr-6">
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
                  {/* Rank is an ordinal, not a figure — it recedes so the eye
                      goes to the depot and its revenue. The leader is the one
                      row worth carrying extra weight. */}
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className={cn('font-medium', i === 0 && 'font-semibold')}>{d.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(d.orderCount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatLitres(d.volume)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(d.revenue)}</TableCell>
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
                {formatNumber(dangote.totalRequests)} requests
              </StatusChip>
            )}
          </div>
          <PanelRows>
            <PanelRow lead label="Total value" value={formatCurrency(dangote.totalValue)} />
            <PanelRow
              label="Paid value"
              hint={dangote.totalValue > 0 ? `${Math.round((dangote.paidValue / dangote.totalValue) * 100)}% collected` : undefined}
              tone="positive"
              value={formatCurrency(dangote.paidValue)}
            />
            <PanelRow label="Total requests" value={formatNumber(dangote.totalRequests)} />
            {(dangote.byStatus || []).map((s: { status: string; count: number; total: number }) => (
              <PanelRow
                key={s.status}
                label={s.status}
                hint={`${formatNumber(s.count)} request${s.count === 1 ? '' : 's'}`}
                value={formatCurrency(Number(s.total))}
              />
            ))}
          </PanelRows>
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
                {formatNumber(lpg.totalOrders)} orders
              </StatusChip>
            )}
          </div>
          <PanelRows>
            <PanelRow lead label="Total value" value={formatCurrency(lpg.totalValue)} />
            <PanelRow
              label="Paid value"
              hint={lpg.totalValue > 0 ? `${Math.round((lpg.paidValue / lpg.totalValue) * 100)}% collected` : undefined}
              tone="positive"
              value={formatCurrency(lpg.paidValue)}
            />
            <PanelRow label="Total orders" value={formatNumber(lpg.totalOrders)} />
            <PanelRow
              label="Stations"
              hint={`${formatNumber(lpg.stations?.total || 0)} on the books`}
              value={`${formatNumber(lpg.stations?.active || 0)} active`}
            />
            {(lpg.byStatus || []).map((s: { status: string; count: number; total: number }) => (
              <PanelRow
                key={s.status}
                label={s.status}
                hint={`${formatNumber(s.count)} order${s.count === 1 ? '' : 's'}`}
                value={formatCurrency(Number(s.total))}
              />
            ))}
          </PanelRows>
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
