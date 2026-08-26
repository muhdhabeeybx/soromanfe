import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, Plus, Receipt, Banknote, Building2, Hourglass, Download, X, Trash2, Pencil, Lock,
  Landmark, FileSpreadsheet, Loader2,
} from 'lucide-react'

import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
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
import { exportExpensesExcel, exportExpensesPdf } from '#/routes/expenses/-expense-export'
import {
  statusRow, categoryChip, categoryGrouping, payeeAccount, paidFromParts,
} from '#/lib/expense-presentation'
import { useBankAccountPicker, resolveBankAccount } from '#/lib/bank-accounts'
import { useToast } from '#/lib/hooks/useToast'
import { MICRO, PANEL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import {
  useExpenses, useExpenseCategories, useDeleteExpense,
  type PfiExpense, type ExpenseFilters, isExpenseDeletable, isExpenseEditable,
} from '#/lib/hooks/usePfis'
import { ExpenseDialog, cash } from '#/components/ExpenseDialog'
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
  const toast = useToast()
  // Every account, not just the expense-tagged ones: a row may name an
  // account since retired, and scoping the resolution set would turn a
  // correctly labelled old entry back into raw text.
  const { accounts: bankAccounts } = useBankAccountPicker()

  const rows = data?.expenses || []
  const totals = data?.totals
  const hasFilters = Object.values(filters).some(Boolean)
  const vatRate = cats?.vat_rate ?? 0.075

  const set = (k: keyof ExpenseFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }))

  /** Reads back the filters in force, so the file says what it is a view of. */
  const scope = (() => {
    const parts: string[] = []
    if (filters.search) parts.push(`matching “${filters.search}”`)
    if (filters.status) parts.push(`status ${filters.status}`)
    if (filters.type) parts.push(filters.type === 'pfi' ? 'PFI attached' : 'general only')
    if (filters.group) parts.push('one cost group')
    if (filters.category) parts.push('one category')
    if (filters.pfi) parts.push('one PFI')
    if (filters.submitter) parts.push('one requester')
    if (filters.bank) parts.push('one account')
    if (filters.month) parts.push(filters.month)
    if (filters.dateFrom || filters.dateTo) {
      parts.push(`${filters.dateFrom || 'start'} to ${filters.dateTo || 'today'}`)
    }
    return parts.length ? `Filtered: ${parts.join(' · ')}` : 'All requests'
  })()

  const exportMeta = {
    title: 'Expenses',
    scope,
    slug: 'expenses',
    vatRate,
    resolveBank: (raw: string | null | undefined) => resolveBankAccount(bankAccounts, raw),
  }

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const runExport = async (kind: 'excel' | 'pdf') => {
    if (exporting) return
    setExporting(kind)
    try {
      if (kind === 'excel') await exportExpensesExcel(rows, exportMeta)
      else await exportExpensesPdf(rows, exportMeta)
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setExporting(null)
    }
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
          {/* Two rows on a phone, one on a desktop. Four buttons in a single
              non-wrapping row ran off the side of the screen; splitting them
              by what they are for — doing the work, then taking it away —
              gives two pairs that each halve the width cleanly. */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex gap-2">
              <Button className="flex-1 sm:flex-none" onClick={openNew}>
                <Plus data-icon="inline-start" />
                Record expense
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => setBankAccountsOpen(true)}
              >
                <Landmark data-icon="inline-start" />
                Bank accounts
              </Button>
            </div>
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
                  <TableHead>PFI</TableHead>
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
                  <TableHead>Vendor's account</TableHead>
                  <TableHead>Paid from</TableHead>
                  {/* The filter above is unreadable without this: you pick a
                      name and then cannot tell which rows are theirs. */}
                  <TableHead>Added by</TableHead>
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
                    // The rail is the signal — a solid edge reads down a long
                    // page in a way a faint wash behind text never does.
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
                    {/* Category shows its cost group above the account itself:
                        70 accounts are too many to recognise by name, six
                        groups are not. Both wrap — a category clipped at
                        13rem was the column most often unreadable. */}
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
                    {/* The cargo gets its own column rather than being implied
                        by the category — the category says what the money
                        bought, which batch it lands on is a separate fact. */}
                    <TableCell className="min-w-[9rem] whitespace-nowrap text-muted-foreground">
                      {e.pfi_number || '—'}
                    </TableCell>
                    <TableCell className="max-w-[11rem] truncate font-medium uppercase" title={e.vendor || undefined}>
                      {e.vendor || '—'}
                    </TableCell>
                    {/* <TableCell className="whitespace-nowrap text-muted-foreground">{e.tin_number || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{e.invoice_number || '—'}</TableCell> */}
                    {/* The one column with no natural length — clipped so it
                        cannot push every figure off-screen. Hover and both
                        exports carry it in full. */}
                    <TableCell className="max-w-[18rem] truncate uppercase" title={e.description || undefined}>
                      {e.description || '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.amount_ex_vat) || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.vat_amount) || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{cash(e.invoice_amount) || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {cash(e.wht_deduction) || '—'}
                      {e.wht_rate ? (
                        <span className="ml-1 opacity-60">({Number(e.wht_rate)}%)</span>
                      ) : null}
                    </TableCell>
                    {/* Asked for and actually paid are the two figures anyone
                        compares, so they are the two that get a colour —
                        blue for the claim, green for the money that moved. */}
                    <TableCell className="text-right font-semibold whitespace-nowrap text-blue-700 dark:text-blue-400">
                      {naira(Number(e.amount))}
                    </TableCell>
                    {/* Blank until it is settled — a request awaiting payment
                        has not paid ₦0. Once actually paid, a still-blank
                        amount_paid (legacy rows recorded before that column
                        existed) falls back to the requested figure rather
                        than showing a paid row as if nothing had cleared. */}
                    <TableCell className="text-right whitespace-nowrap font-semibold text-success">
                      {e.amount_paid != null
                        ? cash(e.amount_paid)
                        : (e.status === 'paid' ? naira(Number(e.amount)) : <span className="font-normal text-muted-foreground">—</span>)}
                    </TableCell>
                    {/* <TableCell className="text-muted-foreground">{e.gl_code || '—'}</TableCell> */}
                    {/* <TableCell className="text-muted-foreground">{e.bank_code || '—'}</TableCell> */}
                    {/* The payee's three fields shown as the one fact they
                        are — you cannot pay against a number without the
                        bank, or a bank without the number. */}
                    {/* Each line clipped rather than wrapped: an account name
                        can run long, and three wrapping lines would make this
                        row taller than every other one on the page. The whole
                        thing is on hover and in both exports. */}
                    <TableCell className="max-w-[11rem] text-xs leading-snug">
                      {(() => {
                        const p = payeeAccount(e)
                        if (!p.any) return <span className="text-muted-foreground">—</span>
                        return (
                          <div title={p.line}>
                            {p.name && <span className="block truncate font-medium uppercase">{p.name}</span>}
                            {p.bank && <span className="block truncate text-muted-foreground">{p.bank}</span>}
                            {p.number && <span className="block truncate font-mono text-muted-foreground">{p.number}</span>}
                          </div>
                        )
                      })()}
                    </TableCell>
                    {/* Free text resolved back to the managed account, so the
                        seventeen spellings of the expenses account all read
                        as the same account. Unresolvable text keeps itself. */}
                    <TableCell className="min-w-[10rem] text-xs leading-snug">
                      {(() => {
                        const p = paidFromParts(
                          e.bank_paid_from,
                          resolveBankAccount(bankAccounts, e.bank_paid_from),
                        )
                        if (!p.line) return <span className="text-muted-foreground">—</span>
                        return (
                          <>
                            <span className="block font-medium uppercase">{p.name}</span>
                            {p.bank && <span className="block text-muted-foreground">{p.bank}</span>}
                          </>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="min-w-[9rem] text-muted-foreground">
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
                  )
                })}
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
