import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, Plus, Receipt, Hourglass, CheckCircle2, X, Trash2, Pencil, Lock,
  Download, FileSpreadsheet, Loader2,
} from 'lucide-react'

import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { PANEL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import {
  useExpenses, useDeleteExpense, isExpenseDeletable, isExpenseEditable,
  usePfiList, useExpenseCategoryPickers,
  type PfiExpense, type ExpenseFilters,
} from '#/lib/hooks/usePfis'
import { NativeSelect } from '#/components/ui/native-select'
import { ExpenseDialog } from '#/components/ExpenseDialog'
import { ExpenseReviewDrawer, StepBadge } from '#/components/ExpenseReviewDrawer'
import { naira } from '#/routes/pfi/-pfi-utils'
import { routeGuard } from '#/lib/route-guard'
import { exportExpensesExcel, exportExpensesPdf } from '#/routes/expenses/-expense-export'
import { statusRow, categoryChip, categoryGrouping } from '#/lib/expense-presentation'
import { useBankAccountPicker, resolveBankAccount } from '#/lib/bank-accounts'
import { useToast } from '#/lib/hooks/useToast'

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

  const toast = useToast()
  const { accounts: bankAccounts } = useBankAccountPicker()
  const { data: pfiData } = usePfiList({ limit: 500 })
  const { cats, subgroupOptions, categoryPickerGroups } = useExpenseCategoryPickers(filters)

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (e: PfiExpense) => { setEditing(e); setDialogOpen(true) }

  const scope = (() => {
    const parts: string[] = []
    if (filters.search) parts.push(`matching “${filters.search}”`)
    if (filters.status) parts.push(`status ${filters.status}`)
    return parts.length ? `Raised by me · ${parts.join(' · ')}` : 'Everything I have raised'
  })()

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const runExport = async (kind: 'excel' | 'pdf') => {
    if (exporting) return
    setExporting(kind)
    const meta = {
      title: 'My Requests',
      scope,
      slug: 'my-expense-requests',
      vatRate: 0.075,
      resolveBank: (raw: string | null | undefined) => resolveBankAccount(bankAccounts, raw),
    }
    try {
      if (kind === 'excel') await exportExpensesExcel(rows, meta)
      else await exportExpensesPdf(rows, meta)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setExporting(null)
    }
  }

  if (isLoading) return <PageLoader />
  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="My requests"
        description="Raise a payment request and track it through Expenditure Officer, CFO and final approval."
        actions={(
          // Same split as Expenses: raising a request on one row, taking the
          // register away on the next, so a phone gets two clean pairs.
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button className="sm:flex-none" onClick={openNew}>
              <Plus data-icon="inline-start" />
              Raise a request
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => runExport('excel')}
                disabled={rows.length === 0 || exporting !== null}
              >
                {exporting === 'excel'
                  ? <Loader2 data-icon="inline-start" className="animate-spin" />
                  : <FileSpreadsheet data-icon="inline-start" />}
                Excel
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => runExport('pdf')}
                disabled={rows.length === 0 || exporting !== null}
              >
                {exporting === 'pdf'
                  ? <Loader2 data-icon="inline-start" className="animate-spin" />
                  : <Download data-icon="inline-start" />}
                PDF
              </Button>
            </div>
          </div>
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
        {/* The same three that matter on Expenses, minus the ones that only
            make sense across the whole company — there is no "raised by"
            filter on a page that already shows only what you raised. */}
        <NativeSelect
          className="w-40"
          value={filters.type || ''}
          onChange={(e) => {
            const type = e.target.value
            setFilters((f) => ({
              ...f,
              type: (type || undefined) as typeof f.type,
              subgroup: undefined,
              category: undefined,
              pfi: type === 'general' ? undefined : f.pfi,
            }))
          }}
        >
          <option value="">All spend</option>
          <option value="pfi">PFI attached</option>
          <option value="general">General only</option>
        </NativeSelect>
        <NativeSelect
          className="w-52"
          value={filters.subgroup || ''}
          onChange={(e) => setFilters((f) => ({ ...f, subgroup: e.target.value || undefined, category: undefined }))}
        >
          <option value="">All cost groups</option>
          {subgroupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
        <NativeSelect className="w-56" value={filters.category || ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {categoryPickerGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.accounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
          {cats?.unmapped?.length ? (
            <optgroup label="Retired (pre-chart)">
              {cats.unmapped.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ) : null}
        </NativeSelect>
        {filters.type !== 'general' && (
          <NativeSelect className="w-48" value={filters.pfi || ''} onChange={(e) => set('pfi', e.target.value)}>
            <option value="">Any cargo</option>
            {(pfiData?.pfis || []).map((p) => (
              <option key={p.id} value={String(p.id)}>{p.pfiNumber || `PFI ${p.id}`}</option>
            ))}
          </NativeSelect>
        )}
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
                  <TableHead>PFI</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e, i) => {
                  const tone = statusRow(e.status)
                  return (
                  <TableRow
                    key={e.id}
                    className={cn('cursor-pointer border-l-4 align-top', tone.rail, tone.wash)}
                    onClick={() => setReviewing(e.id)}
                  >
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {e.reference_number || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(e.expense_date), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell className="min-w-[13rem]">
                      <span
                        className={cn(
                          'inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset',
                          categoryChip(e),
                        )}
                      >
                        {categoryGrouping(e)}
                      </span>
                      <span className="mt-1 block text-sm leading-snug">{e.category_name}</span>
                    </TableCell>
                    <TableCell className="min-w-[9rem] whitespace-nowrap text-muted-foreground">
                      {e.pfi_number || '—'}
                    </TableCell>
                    <TableCell className="max-w-[11rem] truncate font-medium uppercase" title={e.vendor || undefined}>
                      {e.vendor || '—'}
                    </TableCell>
                    {/* Clipped here too — hover and both exports carry it in full. */}
                    <TableCell className="max-w-[18rem] truncate uppercase" title={e.description || undefined}>
                      {e.description || '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap text-blue-700 dark:text-blue-400">
                      {naira(Number(e.amount))}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-semibold text-success">
                      {e.amount_paid != null
                        ? naira(Number(e.amount_paid))
                        : (e.status === 'paid' ? naira(Number(e.amount)) : <span className="font-normal text-muted-foreground">—</span>)}
                    </TableCell>
                    <TableCell><StepBadge expense={e} /></TableCell>
                    <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {isExpenseEditable(e) ? (
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(e)} title="Edit">
                            <Pencil /><span className="sr-only">Edit</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon-sm" disabled
                            title="Paid — this expense is closed and can no longer be edited"
                          >
                            <Lock /><span className="sr-only">Paid — locked</span>
                          </Button>
                        )}
                        {isExpenseDeletable(e) && (
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
                  )
                })}
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
