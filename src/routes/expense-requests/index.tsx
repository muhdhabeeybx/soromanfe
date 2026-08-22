import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { Search, Plus, Receipt, Hourglass, CheckCircle2, X, Trash2, Pencil } from 'lucide-react'

import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { PANEL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { useExpenses, useDeleteExpense, DELETABLE_STATUSES, type PfiExpense, type ExpenseFilters } from '#/lib/hooks/usePfis'
import { ExpenseDialog } from '#/components/ExpenseDialog'
import { ExpenseReviewDrawer, StepBadge } from '#/components/ExpenseReviewDrawer'
import { naira } from '#/routes/pfi/-pfi-utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/expense-requests/')({
  beforeLoad: () => routeGuard('/expense-requests'),
  component: MyRequestsPage,
})

/**
 * The requester's own view of the same expense chain the Expenses page
 * processes — raise a request, watch it move, correct it if it's sent back.
 * No GL bookkeeping, no bank schedule, no other person's spend: everything
 * here is scoped to `mine`, both by the API and by what's on screen.
 */
function MyRequestsPage() {
  const [filters, setFilters] = useState<Omit<ExpenseFilters, 'mine'>>({})
  const [editing, setEditing] = useState<PfiExpense | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reviewing, setReviewing] = useState<number | null>(null)

  const { data, isLoading, isError, error, refetch } = useExpenses({ ...filters, mine: true })
  const remove = useDeleteExpense()

  const rows = data?.expenses || []
  const totals = data?.totals
  const hasFilters = Object.values(filters).some(Boolean)

  const set = (k: keyof typeof filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }))

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (e: PfiExpense) => { setEditing(e); setDialogOpen(true) }

  if (isLoading) return <PageLoader />
  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="My requests"
        description="Raise a payment request and track it through Expenditure Officer, CFO and final approval."
        actions={(
          <Button onClick={openNew}>
            <Plus data-icon="inline-start" />
            Raise a request
          </Button>
        )}
      />

      <StatCardGrid count={3}>
        <StatCard icon={<Receipt />} label="Total requested" value={naira(totals?.total ?? 0)} />
        <StatCard icon={<Hourglass />} label="Awaiting decision" value={naira(totals?.openTotal ?? 0)} />
        <StatCard icon={<CheckCircle2 />} label="Paid" value={naira(totals?.paidTotal ?? 0)} />
      </StatCardGrid>

      {/* Counts ignore the status filter, so a tab never reads zero just
          because you are standing inside another one — same rule as Expenses. */}
      <div className="flex flex-wrap gap-1.5">
        {[
          ['', 'All'], ['awaiting', 'Awaiting'], ['pending', 'With officer'],
          ['verified', 'With CFO'], ['audit_approved', 'Final approval'],
          ['admin_approved', 'To pay'], ['paid', 'Paid'],
          ['changes_requested', 'Changes requested'], ['rejected', 'Rejected'],
        ].map(([value, label]) => {
          const active = (filters.status || '') === value
          const n = data?.statusCounts?.[value || 'all'] ?? 0
          return (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: value || undefined }))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors duration-250 ease-luxe',
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-foreground/15 text-muted-foreground hover:border-foreground/30',
              )}
            >
              {label}
              <span className="ml-1.5 opacity-60">{n}</span>
            </button>
          )
        })}
      </div>

      <FilterBar>
        <div className="relative min-w-[11rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8" placeholder="Search description, vendor, category…"
            value={filters.search || ''} onChange={(e) => set('search', e.target.value)}
          />
        </div>
        <Input
          type="date" className="w-36" value={filters.dateFrom || ''}
          onChange={(e) => set('dateFrom', e.target.value)}
        />
        <Input
          type="date" className="w-36" value={filters.dateTo || ''}
          onChange={(e) => set('dateTo', e.target.value)}
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <div className={cn(PANEL)}>
        {rows.length === 0 ? (
          <PageEmpty
            icon={<Receipt />}
            title={hasFilters ? 'No requests match those filters' : "You haven't raised any requests"}
            description={hasFilters ? 'Try widening the search.' : 'Raise one to get started.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">S/N</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e, i) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setReviewing(e.id)}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {e.reference_number || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(e.expense_date), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.pfi_id ? 'default' : 'secondary'}>
                        {e.category_name}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate font-medium">{e.vendor || '—'}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{e.description || '—'}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">{naira(Number(e.amount))}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium">
                      {e.amount_paid != null
                        ? naira(Number(e.amount_paid))
                        : (e.status === 'paid' ? naira(Number(e.amount)) : '—')}
                    </TableCell>
                    <TableCell><StepBadge expense={e} /></TableCell>
                    <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" onClick={() => openEdit(e)} title="Edit">
                          <Pencil /><span className="sr-only">Edit</span>
                        </Button>
                        {DELETABLE_STATUSES.has(e.status) && (
                          <Button
                            variant="ghost" size="icon-sm" title="Delete"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (confirm('Delete this request? This cannot be undone.')) remove.mutate(e.id)
                            }}
                          >
                            <Trash2 /><span className="sr-only">Delete</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="border-t border-foreground/10 p-3 text-xs text-muted-foreground">
            {rows.length} of {data?.pagination?.total ?? rows.length} request{rows.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <ExpenseDialog expense={editing} open={dialogOpen} onOpenChange={setDialogOpen} />

      <ExpenseReviewDrawer
        expenseId={reviewing}
        open={reviewing != null}
        onOpenChange={(o) => !o && setReviewing(null)}
        onEdit={(e) => { setEditing(e); setDialogOpen(true) }}
      />
    </div>
  )
}
