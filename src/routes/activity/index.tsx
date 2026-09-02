import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { Search, X, Loader2 } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Badge } from '#/components/ui/badge'
import { useActivity, type ActivityEntry } from '#/lib/hooks/useDashboard'
import { formatNumber, relativeTime } from '#/lib/format'
import { PANEL, MICRO, PANEL_RAIL } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'

/**
 * Everything the system has recorded anyone doing.
 *
 * The overview shows the newest ten and links here for the rest; both read the
 * same endpoint, so the two cannot tell different stories. There was no "rest"
 * before this page — the feed on the dashboard was the whole of it, and it was
 * reading audit_events (182 rows) rather than audit_logs (50,327).
 */
export const Route = createFileRoute('/activity/')({
  beforeLoad: () => routeGuard('/activity'),
  component: ActivityPage,
})

/** The entity kinds worth filtering by, by how often they actually appear. */
const ENTITY_TYPES = ['order', 'customer', 'ticket', 'pfi', 'expense', 'staff', 'depot']

const ACTION_LABELS: Record<string, string> = {
  'order.payment_recorded': 'Recorded a payment',
  'order.payment_removed': 'Removed a payment',
  'order.payment_transferred': 'Moved surplus between orders',
  'order.payment_transfer_reversed': 'Reversed a transfer',
  'order.paid': 'Paid an order',
  'order.part_paid': 'Part-paid an order',
  'order.released': 'Released an order',
  'order.cancelled': 'Cancelled an order',
  PAYMENT_CONFIRMED: 'Confirmed payment',
  ORDER_RELEASED: 'Released order',
  TICKET_GENERATED: 'Generated ticket',
  SECURITY_ENTRY: 'Gated a truck in',
  SECURITY_EXIT: 'Gated a truck out',
  release_confirmation: 'Confirmed release',
  updated: 'Updated a record',
}

const labelAction = (a: string) =>
  ACTION_LABELS[a] || a.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const ACTOR_TONE: Record<string, string> = {
  staff: 'bg-accent/10 text-accent border-accent/20',
  customer: 'bg-warning/10 text-warning border-warning/20',
  system: 'bg-muted text-muted-foreground',
}

function ActivityPage() {
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, isLoading, isError, error, refetch, isFetching } = useActivity({
    page,
    limit: 50,
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  })

  const rows: ActivityEntry[] = data?.activity || []
  const pagination = data?.pagination
  const hasFilters = !!(entityType || action || from || to)

  const clear = () => {
    setEntityType(''); setAction(''); setFrom(''); setTo(''); setPage(1)
  }

  // Any filter change starts again at page one — staying on page 40 of a
  // narrower result set lands on nothing and reads as "no activity".
  const onFilter = (fn: () => void) => { fn(); setPage(1) }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Activity log"
        description={
          pagination
            ? `${formatNumber(pagination.total)} recorded action${pagination.total === 1 ? '' : 's'}`
            : 'Every action recorded across the system.'
        }
      />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search action, e.g. payment"
            value={action}
            onChange={(e) => onFilter(() => setAction(e.target.value))}
          />
        </div>
        <NativeSelect
          className="w-44"
          value={entityType}
          onChange={(e) => onFilter(() => setEntityType(e.target.value))}
        >
          <option value="">All record types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t} className="capitalize">{t}</option>
          ))}
        </NativeSelect>
        <Input
          type="date"
          className="w-[10rem]"
          value={from}
          onChange={(e) => onFilter(() => setFrom(e.target.value))}
        />
        <Input
          type="date"
          className="w-[10rem]"
          value={to}
          onChange={(e) => onFilter(() => setTo(e.target.value))}
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <div className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            {pagination
              ? `Page ${pagination.page} of ${formatNumber(pagination.pages)}`
              : 'Loading'}
          </span>
          {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>

        {isLoading ? (
          <PageLoader message="Loading activity…" />
        ) : isError ? (
          <PageError message={(error as Error)?.message || 'Could not load activity'} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <PageEmpty
            title={hasFilters ? 'Nothing matches those filters' : 'No activity recorded'}
            description={hasFilters ? 'Try widening the dates or clearing the record type.' : undefined}
            actionLabel={hasFilters ? 'Clear filters' : undefined}
            onAction={hasFilters ? clear : undefined}
            hasFilters={hasFilters}
            onClearFilters={clear}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <div className="text-sm">{relativeTime(r.createdAt)}</div>
                      <div className="text-xs text-muted-foreground/70">
                        {format(new Date(r.createdAt), 'd MMM yyyy, HH:mm')}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{labelAction(r.action)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.entityType ? (
                        <span className="capitalize">
                          {r.entityType}
                          {r.entityId ? ` #${r.entityId}` : ''}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {/* Only where the log actually recorded a transition —
                          most rows are an action, not a state change. */}
                      {r.prevState || r.newState ? (
                        <span className="whitespace-nowrap">
                          {r.prevState || '—'} <span className="text-muted-foreground/50">→</span>{' '}
                          <span className="text-foreground">{r.newState || '—'}</span>
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('font-normal', ACTOR_TONE[r.actorType] || ACTOR_TONE.system)}
                      >
                        {r.actorName || r.actorType}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-foreground/10 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Showing {formatNumber((pagination.page - 1) * pagination.limit + 1)}–
              {formatNumber(Math.min(pagination.page * pagination.limit, pagination.total))} of{' '}
              {formatNumber(pagination.total)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.pages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
