import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, Plus, Receipt, Banknote, Building2, Hourglass, Download, X, Trash2, Pencil, Lock,
  Landmark,
} from 'lucide-react'

import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { ScopedBankAccountsDialog } from '#/components/ScopedBankAccountsDialog'
import { BANK_ACCOUNT_USAGE } from '#/lib/bank-accounts'
import { MICRO, PANEL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import {
  useExpenses, useExpenseCategories, useDeleteExpense,
  type PfiExpense, type ExpenseFilters, isExpenseDeletable, isExpenseEditable,
} from '#/lib/hooks/usePfis'
import { ExpenseDialog, cash, plain } from '#/components/ExpenseDialog'
import { ExpenseReviewDrawer, StepBadge } from '#/components/ExpenseReviewDrawer'
// GL chart editor — commented out along with the rest of the GL chart for
// now (it was never actually seeded in production, see ExpenseDialog).
// import { GlAccountsDialog } from '#/components/GlAccountsDialog'
// import { useCanManageChart } from '#/lib/hooks/useCanManageChart'
import { naira } from '#/routes/pfi/-pfi-utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/expenses/')({
  beforeLoad: () => routeGuard('/expenses'),
  component: ExpensesPage,
})

function ExpensesPage() {
  const [filters, setFilters] = useState<ExpenseFilters>({})
  const [editing, setEditing] = useState<PfiExpense | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bankAccountsOpen, setBankAccountsOpen] = useState(false)
  const [reviewing, setReviewing] = useState<number | null>(null)
  // const [chartOpen, setChartOpen] = useState(false)
  // const canManageChart = useCanManageChart()

  const { data, isLoading, isError, error, refetch } = useExpenses(filters)
  const { data: cats } = useExpenseCategories()
  const remove = useDeleteExpense()

  const rows = data?.expenses || []
  const totals = data?.totals
  const hasFilters = Object.values(filters).some(Boolean)
  const vatRate = cats?.vat_rate ?? 0.075

  const set = (k: keyof ExpenseFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }))

  /**
   * The payment schedule, column for column — the same columns as the table.
   * TIN, invoice number and GL code/name are commented out below along with
   * their form fields — see ExpenseDialog — rather than deleted, in case the
   * chart of accounts gets seeded for real later.
   */
  const exportCsv = () => {
    const head = [
      'S/N', 'Reference', 'Date', 'Vendor', /* 'TIN NUMBER', 'Invoice No.', */ 'Purpose',
      'Amount-Ex VAT', `${(vatRate * 100).toFixed(1)}%`, 'Invoice Amount',
      'WHT rate %', 'WHT deduction', 'Amount requested', 'Amount paid',
      /* 'GL code', */ 'Category', /* 'Bank code', */ 'Bank Name', 'Paid from',
      'Added by', 'PFI', 'Status',
    ]
    const body = rows.map((e, i) => [
      String(i + 1),
      e.reference_number || '',
      format(new Date(e.expense_date), 'yyyy-MM-dd'),
      e.vendor,
      // e.tin_number || '',
      // e.invoice_number || '',
      e.description,
      plain(e.amount_ex_vat),
      plain(e.vat_amount),
      plain(e.invoice_amount),
      e.wht_rate ? String(Number(e.wht_rate)) : '',
      plain(e.wht_deduction),
      Number(e.amount).toFixed(2),
      e.amount_paid != null ? plain(e.amount_paid) : (e.status === 'paid' ? Number(e.amount).toFixed(2) : ''),
      // e.gl_code || '',
      e.category_name,
      // e.bank_code || '',
      e.payee_bank_name || '',
      e.bank_paid_from || '',
      e.submitted_by_name || '',
      e.pfi_number || '',
      e.status_label,
    ])
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openNew = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (e: PfiExpense) => { setEditing(e); setDialogOpen(true) }

  if (isLoading) return <PageLoader />
  if (isError) return <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
      eyebrow="Finance"
      title="Expenses"
      description="Every request across the company — verify, approve and pay. For raising and tracking just your own, see My Requests."
      actions={
        <>
          <div className="flex gap-2">
          {/* GL accounts editor — still commented out. The chart itself is now
              seeded and in use (migration 0007), but letting it be edited from
              here is a separate decision: an account carrying booked expenses
              cannot simply be renamed or removed without deciding what happens
              to them, and nobody has asked for that yet.
          {canManageChart && (
          <Button variant="outline" onClick={() => setChartOpen(true)}>
          <ListTree data-icon="inline-start" />
          GL accounts
          </Button>
          )} */}
          <Button variant="outline" onClick={() => setBankAccountsOpen(true)}>
          <Landmark data-icon="inline-start" />
          Bank accounts
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download data-icon="inline-start" />
          Export CSV
          </Button>
          <Button onClick={openNew}>
          <Plus data-icon="inline-start" />
          Record expense
          </Button>
          </div>
        </>
      }
    />

      {/* Awaiting payment stands on its own card. Folded into a total it is
          invisible, and it is the one figure whoever runs payments is after. */}
      <StatCardGrid count={2}>
        <StatCard
          icon={<Receipt />} label="Total Expenses" value={naira(totals?.total ?? 0)}
          // description={`${totals?.count ?? 0} line${totals?.count === 1 ? '' : 's'} in view`}
        />
        <StatCard
          icon={<Hourglass />} label="Awaiting Payment" value={naira(totals?.openTotal ?? 0)}
          // description="Approved or still walking the chain"
        />
        <StatCard
          icon={<Banknote />} label="PFI Expenses" value={naira(totals?.pfiTotal ?? 0)}
          // description="Attached to a cargo batch"
        />
        <StatCard
          icon={<Building2 />} label="Other Expenses" value={naira(totals?.generalTotal ?? 0)}
          // tone="neutral" description="Overhead, not attached to a batch"
        />
      </StatCardGrid>

      {/* Counts ignore the status filter, so a tab never reads zero just
          because you are standing inside another one. */}
      <div className="flex flex-wrap gap-1.5">
        {[
          // Named after whoever has to act next, in chain order.
          ['', 'All'], ['awaiting', 'Awaiting'], ['pending', 'With officer'],
          ['verified', 'With CFO'], ['audit_approved', 'Final approval'],
          ['admin_approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected'],
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
        <NativeSelect className="w-36" value={filters.type || ''} onChange={(e) => set('type', e.target.value)}>
        <option value="">All spend</option>
        <option value="pfi">PFI only</option>
        <option value="general">General only</option>
        </NativeSelect>
        <NativeSelect className="w-44" value={filters.group || ''} onChange={(e) => set('group', e.target.value)}>
        <option value="">All categories</option>
        {(cats?.groups || []).map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
        </NativeSelect>
        {/* Accounts are listed under their group, in GL-code order. The legacy
            categories keep an optgroup of their own so older lines stay
            findable. */}
        <NativeSelect className="w-48" value={filters.category || ''} onChange={(e) => set('category', e.target.value)}>
        <option value="">All GL accounts</option>
        {(cats?.groups || []).map((g) => (
        <optgroup key={g.code} label={g.label}>
        {g.accounts.map((c) => <option key={c.id} value={c.id}>{c.gl_code} · {c.name}</option>)}
        </optgroup>
        ))}
        {cats?.unmapped?.length ? (
        <optgroup label="Pre-chart categories">
        {cats.unmapped.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
        ) : null}
        <optgroup label="PFIs">
        {cats?.pfi.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
        </NativeSelect>
        <NativeSelect className="w-36" value={filters.bank || ''} onChange={(e) => set('bank', e.target.value)}>
        <option value="">All banks</option>
        {data?.banks.map((b) => <option key={b} value={b}>{b}</option>)}
        </NativeSelect>
        {/* Only the people who have actually raised something in view are
            offered — the whole staff list would mostly be names that filter
            to nothing. */}
        <NativeSelect className="w-44" value={filters.submitter || ''} onChange={(e) => set('submitter', e.target.value)}>
        <option value="">Added by anyone</option>
        {(data?.submitters || []).map((sub) => (
        <option key={sub.id} value={String(sub.id)}>{sub.name}</option>
        ))}
        </NativeSelect>
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
            title={hasFilters ? 'No expenses match those filters' : 'No expenses recorded'}
            description={hasFilters ? 'Try widening the search.' : 'Record one to get started.'}
          />
        ) : (
          /* The payment schedule itself, column for column, so what is on
             screen is what comes out of the export. It is deliberately wide —
             the table scrolls rather than dropping columns, because a schedule
             missing its TIN or GL code is not a schedule. */
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">S/N</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  {/* <TableHead>TIN number</TableHead>
                  <TableHead>Invoice no.</TableHead> */}
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Amount ex VAT</TableHead>
                  <TableHead className="text-right">{(vatRate * 100).toFixed(1)}%</TableHead>
                  <TableHead className="text-right">Invoice amount</TableHead>
                  <TableHead className="text-right">WHT</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Amount paid</TableHead>
                  {/* <TableHead>GL code</TableHead> */}
                  {/* <TableHead>Bank code</TableHead> */}
                  <TableHead>Bank name</TableHead>
                  <TableHead>Paid from</TableHead>
                  {/* The filter above is unreadable without this: you pick a
                      name and then cannot tell which rows are theirs. */}
                  <TableHead>Added by</TableHead>
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
                    <TableCell className="max-w-[14rem] truncate">
                      <Badge variant={e.pfi_id ? 'default' : 'secondary'} className="max-w-[13rem]">
                        {e.category_name}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate font-medium">{e.vendor || '—'}</TableCell>
                    {/* <TableCell className="whitespace-nowrap text-muted-foreground">{e.tin_number || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{e.invoice_number || '—'}</TableCell> */}
                    <TableCell className="max-w-[16rem] truncate">{e.description || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.amount_ex_vat) || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.vat_amount) || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.invoice_amount) || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {cash(e.wht_deduction) || '—'}
                      {e.wht_rate ? (
                        <span className="ml-1 opacity-60">({Number(e.wht_rate)}%)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">{naira(Number(e.amount))}</TableCell>
                    {/* Blank until it is settled — a request awaiting payment
                        has not paid ₦0. Once actually paid, a still-blank
                        amount_paid (legacy rows recorded before that column
                        existed) falls back to the requested figure rather
                        than showing a paid row as if nothing had cleared. */}
                    <TableCell className="text-right whitespace-nowrap font-medium">
                      {e.amount_paid != null
                        ? cash(e.amount_paid)
                        : (e.status === 'paid' ? naira(Number(e.amount)) : '—')}
                    </TableCell>
                    {/* <TableCell className="text-muted-foreground">{e.gl_code || '—'}</TableCell> */}
                    {/* <TableCell className="text-muted-foreground">{e.bank_code || '—'}</TableCell> */}
                    <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                      {e.payee_bank_name || '—'}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                      {e.bank_paid_from || '—'}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate whitespace-nowrap text-muted-foreground">
                      {e.submitted_by_name || '—'}
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
                        {/* Withdrawable until the money leaves — see
                            isExpenseDeletable. */}
                        {isExpenseDeletable(e) && (
                          <Button
                            variant="ghost" size="icon-sm" title="Delete"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (confirm(`Delete the request for ${e.vendor || 'this payee'}? This cannot be undone.`)) {
                                remove.mutate(e.id)
                              }
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
          <p className={cn(MICRO, 'border-t border-foreground/10 p-3 text-muted-foreground')}>
            {rows.length} of {data?.pagination?.total ?? rows.length}
            {data?.scope === 'own' && ' · showing only requests you raised'}
            {' · only paid requests count toward a cargo\'s cost'}
          </p>
        )}
      </div>

      <ExpenseDialog expense={editing} open={dialogOpen} onOpenChange={setDialogOpen} />

      <ScopedBankAccountsDialog
        open={bankAccountsOpen}
        onOpenChange={setBankAccountsOpen}
        usage={BANK_ACCOUNT_USAGE.expenses}
        title="Expense Bank Accounts"
        description="The accounts offered when marking an expense paid. Only the accounts ticked here appear in that dropdown."
      />

      {/* <GlAccountsDialog open={chartOpen} onOpenChange={setChartOpen} /> */}

      <ExpenseReviewDrawer
        expenseId={reviewing}
        open={reviewing != null}
        onOpenChange={(o) => !o && setReviewing(null)}
        onEdit={(e) => { setEditing(e); setDialogOpen(true) }}
      />
    </div>
  )
}
