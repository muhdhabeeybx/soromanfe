import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  ArrowLeft, Upload, Settings2, Download, Search, Loader2, AlertCircle,
  CheckCircle2, ChevronDown, ChevronRight, Landmark, CalendarDays, Layers,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageEmpty } from '#/components/PageEmpty'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { formatCurrency } from '#/lib/format'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { useToast } from '#/lib/hooks/useToast'
import { formatPlainDay } from '#/lib/bank-statement-parser'
import {
  useStatementAccounts, useStatementDays, useAccountStatementLines,
  useBankStatements, useDeleteStatement, fetchAllAccountLines,
  type StatementDay, type AccountStatementLine,
} from '#/lib/hooks/useBankStatements'
import { UploadStatementDialog } from './-upload-dialog'
import { exportStatementLines } from './-statement-export'
import { StatementUploads } from './-statement-uploads'

export const Route = createFileRoute('/bank-statements/account')({
  beforeLoad: () => routeGuard('/bank-statements'),
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: (search.id as string) || undefined,
  }),
  component: BankStatementAccountPage,
})

/** How many lines of one day, or of a search, to read at once. */
const LINES_PER_PAGE = 100

const STATUS_FILTERS = [
  { value: '', label: 'All rows' },
  { value: 'MATCHED', label: 'Matched' },
  { value: 'UNMATCHED', label: 'Unmatched' },
]

/**
 * One bank account's statement, end to end.
 *
 * The unit here is the DAY, not the file. How many uploads it took to assemble
 * a day is an accident of how somebody exported it — three partial files and
 * one complete one describe the same Tuesday — and grouping by file split that
 * Tuesday across three screens. Every row still carries the file it arrived
 * in, so nothing is lost by not leading with it.
 */
function BankStatementAccountPage() {
  const { id } = Route.useSearch()
  const toast = useToast()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'days' | 'uploads'>('days')
  const [dialog, setDialog] = useState<null | 'upload' | 'format'>(null)
  const [exporting, setExporting] = useState(false)

  const { data: accounts = [], isLoading: loadingAccounts } = useStatementAccounts()
  const account = accounts.find((a) => String(a.bank_account_id) === String(id))

  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to])
  const { data: days = [], isFetching: loadingDays } = useStatementDays(id, range)
  const { data: statements = [] } = useBankStatements(id)
  const remove = useDeleteStatement()

  const label = account
    ? `${account.bank_name} — ${account.account_name} · ${account.account_number}`
    : 'This account'

  /**
   * The totals shown are the ones for the RANGE, not for the account.
   *
   * A filter that narrows the table but leaves the headline figures reporting
   * the whole account is the way a screen tells you something untrue while
   * every number on it is correct.
   */
  const shownTotals = useMemo(() => days.reduce(
    (t, d) => ({
      lines: t.lines + d.line_count,
      total: t.total + Number(d.total_amount || 0),
      matched: t.matched + Number(d.matched_amount || 0),
      matchedCount: t.matchedCount + d.matched_count,
      unmatched: t.unmatched + Number(d.unmatched_amount || 0),
      unmatchedCount: t.unmatchedCount + d.unmatched_count,
    }),
    { lines: 0, total: 0, matched: 0, matchedCount: 0, unmatched: 0, unmatchedCount: 0 },
  ), [days])

  const filtered = Boolean(from || to)
  const searching = search.trim().length > 0

  const handleExport = async (opts: { day?: string } = {}) => {
    if (!account || !id) return
    setExporting(true)
    try {
      const lines = await fetchAllAccountLines(id, {
        from: opts.day ? undefined : from || undefined,
        to: opts.day ? undefined : to || undefined,
        day: opts.day,
        status: status || undefined,
        q: opts.day ? undefined : (search.trim() || undefined),
      })
      if (!lines.length) {
        toast.error('Nothing to export for that selection')
        return
      }
      await exportStatementLines({
        account,
        lines,
        from: opts.day ? undefined : from || undefined,
        to: opts.day ? undefined : to || undefined,
        day: opts.day,
        status: status || undefined,
      })
    } catch {
      toast.error('That export could not be built')
    } finally {
      setExporting(false)
    }
  }

  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Finance" title="Bank statements" />
        <section className={PANEL}>
          <PageEmpty
            title="No account chosen"
            description="Open an account from the bank statements list."
          />
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/bank-statements">
          <ArrowLeft data-icon="inline-start" />
          All banks
        </Link>
      </Button>

      <PageHeader
        eyebrow="Bank statement"
        title={account?.bank_name || (loadingAccounts ? 'Loading…' : 'Unknown account')}
        description={
          account
            ? `${account.account_name} · ${account.account_number}`
            : 'This account could not be found.'
        }
      />

      {account && (
        <>
          <StatCardGrid count={4}>
            <StatCard
              icon={<Landmark />} tone="neutral" label={filtered ? 'Credited in range' : 'Total credited'}
              value={formatCurrency(shownTotals.total)}
              description={`${shownTotals.lines.toLocaleString()} row${shownTotals.lines === 1 ? '' : 's'} over ${days.length} day${days.length === 1 ? '' : 's'}`}
            />
            <StatCard
              icon={<CheckCircle2 />} label="Matched to an order"
              value={formatCurrency(shownTotals.matched)}
              description={`${shownTotals.matchedCount.toLocaleString()} row${shownTotals.matchedCount === 1 ? '' : 's'}`}
            />
            <StatCard
              tone={shownTotals.unmatched > 0 ? 'amber' : 'green'}
              icon={<AlertCircle />} label="Still unmatched"
              value={formatCurrency(shownTotals.unmatched)}
              description={`${shownTotals.unmatchedCount.toLocaleString()} row${shownTotals.unmatchedCount === 1 ? '' : 's'} unclaimed`}
            />
            <StatCard
              icon={<Layers />} tone="neutral" label="Files uploaded"
              value={account.statement_count.toLocaleString()}
              description={
                account.last_uploaded_at
                  ? `Last ${format(new Date(account.last_uploaded_at), 'd MMM yyyy, HH:mm')}`
                  : undefined
              }
            />
          </StatCardGrid>

          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>This account</span>
              <div className="flex flex-wrap items-center gap-2">
                {account.has_format
                  ? <StatusChip tone="accent" size="rail">Format saved</StatusChip>
                  : <StatusChip tone="warning" size="rail">No format</StatusChip>}
                <Button variant="ghost" size="xs" onClick={() => setDialog('format')}>
                  <Settings2 data-icon="inline-start" />
                  Edit format
                </Button>
                <Button size="xs" onClick={() => setDialog('upload')}>
                  <Upload data-icon="inline-start" />
                  Upload statement
                </Button>
              </div>
            </div>
            <div className={cn(PANEL_BODY, 'grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4')}>
              <Fact
                label="First uploaded"
                value={account.first_uploaded_at
                  ? format(new Date(account.first_uploaded_at), 'd MMM yyyy, HH:mm')
                  : '—'}
              />
              <Fact
                label="Last uploaded"
                value={account.last_uploaded_at
                  ? format(new Date(account.last_uploaded_at), 'd MMM yyyy, HH:mm')
                  : '—'}
              />
              <Fact
                label="Statement covers"
                value={account.first_txn_date && account.last_txn_date
                  ? `${formatPlainDay(account.first_txn_date)} – ${formatPlainDay(account.last_txn_date)}`
                  : '—'}
              />
              <Fact
                label="Duplicates skipped"
                value={account.duplicate_count.toLocaleString()}
                hint={account.repeated_reference_count > 0
                  ? `${account.repeated_reference_count.toLocaleString()} on a repeated reference`
                  : undefined}
                tone={account.repeated_reference_count > 0 ? 'warning' : undefined}
              />
            </div>
          </section>

          {/*
            A repeated reference at scale is not housekeeping. It means this
            account's reference column points at something that is not a
            reference, and every upload since has been dropping real credits on
            the floor. Said here, on the account, where it can be acted on.
          */}
          {account.repeated_reference_count >= 20 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="text-sm">
                <p className="font-medium">
                  {account.repeated_reference_count.toLocaleString()} rows have been skipped for
                  carrying a reference already on this account.
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  A handful is an ordinary overlap between two exports. This many usually means the
                  reference column is mapped onto the narration, so every payment from the same
                  payer looks like the same payment.{' '}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDialog('format')}
                  >
                    Check the format
                  </button>.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-foreground/15 p-0.5">
              {([['days', 'By day'], ['uploads', 'By upload']] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTab(v)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    tab === v ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>

            {tab === 'days' && (
              <>
                <div className="space-y-1">
                  <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor="from">From</label>
                  <Input
                    id="from" type="date" value={from}
                    onChange={(e) => setFrom(e.target.value)} className="w-[9.5rem]"
                  />
                </div>
                <div className="space-y-1">
                  <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor="to">To</label>
                  <Input
                    id="to" type="date" value={to}
                    onChange={(e) => setTo(e.target.value)} className="w-[9.5rem]"
                  />
                </div>
                {filtered && (
                  <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>
                    Clear dates
                  </Button>
                )}

                <div className="relative min-w-[14rem] flex-1">
                  <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a reference, depositor or amount"
                    className="pl-8"
                  />
                </div>

                <Button
                  variant="outline" size="sm"
                  disabled={exporting || shownTotals.lines === 0}
                  onClick={() => handleExport()}
                >
                  {exporting ? <Loader2 className="animate-spin" /> : <Download data-icon="inline-start" />}
                  Export {filtered ? 'range' : 'all'}
                </Button>
              </>
            )}
          </div>

          {tab === 'days' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatus(f.value)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      status === f.value
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
                <span className="text-xs text-muted-foreground">
                  {searching
                    ? 'Searching every row on this account — day grouping resumes when the search is cleared.'
                    : 'Open a day to see every row in it, and where each one went.'}
                </span>
              </div>

              {searching ? (
                <SearchResults
                  bankAccountId={id}
                  from={from} to={to} status={status} q={search.trim()}
                />
              ) : loadingDays && days.length === 0 ? (
                <section className={PANEL}>
                  <PageEmpty title="Reading the statement…" description="Grouping it by day." />
                </section>
              ) : days.length === 0 ? (
                <section className={PANEL}>
                  <PageEmpty
                    title={filtered ? 'Nothing in that range' : 'Nothing uploaded yet'}
                    description={filtered
                      ? 'No statement rows fall between those dates.'
                      : 'Upload a statement for this account to get started.'}
                  />
                </section>
              ) : (
                <div className="space-y-2">
                  {days.map((d) => (
                    <DayPanel
                      key={d.day}
                      day={d}
                      bankAccountId={id}
                      status={status}
                      exporting={exporting}
                      onExport={() => handleExport({ day: d.day })}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'uploads' && (
            <StatementUploads
              statements={statements}
              onDelete={(sid) => remove.mutate(sid)}
              deleting={remove.isPending}
            />
          )}

          {dialog && (
            <UploadStatementDialog
              open
              onOpenChange={(v) => !v && setDialog(null)}
              bankAccountId={account.bank_account_id}
              bankLabel={label}
              mode={dialog}
            />
          )}
        </>
      )}

      {!account && !loadingAccounts && (
        <section className={PANEL}>
          <PageEmpty
            title="Account not found"
            description="That bank account no longer exists, or you do not have access to it."
          />
        </section>
      )}
    </div>
  )
}

function Fact({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warning'
}) {
  return (
    <div>
      <span className={cn(MICRO, 'block text-muted-foreground')}>{label}</span>
      <p className="mt-1 tabular-nums">{value}</p>
      {hint && (
        <p className={cn('mt-0.5 text-xs', tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * One day of the statement, closed until asked for.
 *
 * The day's own totals are on the closed row, so the question "what came in on
 * the 14th" is answered without opening anything. The rows only load when the
 * day is opened — a busy account has fifty days on screen and loading every
 * row of every one of them to show six numbers each would be absurd.
 */
function DayPanel({
  day, bankAccountId, status, exporting, onExport,
}: {
  day: StatementDay
  bankAccountId: string
  status: string
  exporting: boolean
  onExport: () => void
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isFetching } = useAccountStatementLines(
    bankAccountId,
    { day: day.day, status: status || undefined, page, limit: LINES_PER_PAGE },
    { enabled: open },
  )

  const total = Number(day.total_amount || 0)
  const matched = Number(day.matched_amount || 0)
  const unmatched = Number(day.unmatched_amount || 0)

  return (
    <section className={cn(PANEL, open && 'border-accent/30')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-left outline-none transition-colors duration-250 ease-luxe hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {open
          ? <ChevronDown className="size-4 shrink-0 text-accent" />
          : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}

        <span className="flex min-w-[9rem] items-center gap-2">
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{formatPlainDay(day.day)}</span>
        </span>

        <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>

        <span className="text-xs text-muted-foreground">
          {day.line_count} row{day.line_count === 1 ? '' : 's'}
          {/*
            How many files this day arrived in. It is the thing that makes a
            day look wrong when it is not — a day re-uploaded four times still
            holds each credit once, and saying so pre-empts the question.
          */}
          {day.upload_count > 1 && ` · ${day.upload_count} uploads`}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {day.matched_count > 0 && (
            <StatusChip tone="accent" size="rail">
              {formatCurrency(matched)} matched
            </StatusChip>
          )}
          {day.unmatched_count > 0 && (
            <StatusChip tone="warning" size="rail">
              {formatCurrency(unmatched)} unmatched
            </StatusChip>
          )}
          {day.unmatched_count === 0 && day.matched_count > 0 && (
            <CheckCircle2 className="size-3.5 text-accent" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-foreground/15">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
            <span className="text-xs text-muted-foreground">
              Imported {format(new Date(day.first_imported_at), 'd MMM yyyy, HH:mm')}
              {day.last_imported_at !== day.first_imported_at &&
                ` – ${format(new Date(day.last_imported_at), 'd MMM yyyy, HH:mm')}`}
              {' · '}
              {day.upload_count} file{day.upload_count === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-2">
              {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              <Button variant="ghost" size="xs" disabled={exporting} onClick={onExport}>
                <Download data-icon="inline-start" />
                Download this day
              </Button>
            </span>
          </div>

          <LineTable
            lines={data?.lines ?? []}
            loading={isFetching && !data}
            emptyLabel={status ? 'No rows with that status on this day.' : 'No rows on this day.'}
          />

          {(data?.pagination.pages ?? 1) > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-foreground/15 px-5 py-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {data?.pagination.pages} · {data?.pagination.total} rows
              </span>
              <Button
                variant="outline" size="sm"
                disabled={page >= (data?.pagination.pages ?? 1)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Every row on the account that answers to a search term, day grouping set aside. */
function SearchResults({
  bankAccountId, from, to, status, q,
}: {
  bankAccountId: string
  from: string
  to: string
  status: string
  q: string
}) {
  const [page, setPage] = useState(1)
  const { data, isFetching } = useAccountStatementLines(bankAccountId, {
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
    q,
    page,
    limit: LINES_PER_PAGE,
  })

  const totals = data?.totals

  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <span className={MICRO}>
          Rows matching “{q}”{data ? ` (${data.pagination.total})` : ''}
        </span>
        <span className="flex items-center gap-2">
          {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {totals && (
            <span className="text-xs text-muted-foreground">
              {formatCurrency(Number(totals.total_amount))} · {totals.matched} matched ·{' '}
              {totals.unmatched} unmatched
            </span>
          )}
        </span>
      </div>

      <LineTable
        lines={data?.lines ?? []}
        loading={isFetching && !data}
        emptyLabel="Nothing on this account answers to that search."
        showDate
      />

      {(data?.pagination.pages ?? 1) > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-foreground/15 px-5 py-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {data?.pagination.pages}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={page >= (data?.pagination.pages ?? 1)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}

/**
 * The line-by-line table — a credit and its whole history in one row.
 *
 * Where it came from and where it went are both on the row, because the
 * question asked of a statement line is never one or the other. "This credit
 * is not in the system" and "why has this order been paid twice" are the same
 * question read from opposite ends.
 */
function LineTable({
  lines, loading, emptyLabel, showDate = true,
}: {
  lines: AccountStatementLine[]
  loading: boolean
  emptyLabel: string
  showDate?: boolean
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Reading the rows…
      </p>
    )
  }

  if (lines.length === 0) {
    return <PageEmpty title="No rows" description={emptyLabel} />
  }

  return (
    <div className="overflow-x-auto px-2 pb-2">
      <Table>
        <TableHeader>
          <TableRow>
            {showDate && <TableHead>Date</TableHead>}
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Depositor</TableHead>
            <TableHead>Bank reference</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Matched by</TableHead>
            <TableHead>Matched on</TableHead>
            <TableHead>Source file</TableHead>
            <TableHead>Uploaded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const matched = l.status === 'MATCHED'
            // Matched, but the order it named is gone — a real state (an order
            // can be deleted after the fact) and one worth showing rather than
            // leaving as an empty cell.
            const orphaned = matched && l.order_id == null
            return (
              <TableRow key={l.id} className={cn(!matched && 'bg-warning/5')}>
                {showDate && (
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatPlainDay(l.txn_date)}
                  </TableCell>
                )}
                <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                  ₦{Number(l.amount).toLocaleString()}
                </TableCell>
                <TableCell>
                  <span className="block max-w-[16rem] truncate" title={l.narration || l.depositor}>
                    {l.depositor || '—'}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{l.bank_ref || '—'}</TableCell>
                <TableCell>
                  {l.order_reference ? (
                    <span className="font-mono text-xs font-semibold text-accent">
                      {l.order_reference}
                    </span>
                  ) : orphaned ? (
                    <StatusChip tone="warning">Order deleted</StatusChip>
                  ) : (
                    <StatusChip tone="inert">Unmatched</StatusChip>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-[12rem] truncate">{l.customer_name || '—'}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{l.matched_by_name || '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {l.matched_at ? format(new Date(l.matched_at), 'd MMM yyyy, HH:mm') : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-[14rem] truncate" title={l.filename}>
                    {l.filename || '—'}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {l.uploaded_at ? format(new Date(l.uploaded_at), 'd MMM yyyy, HH:mm') : '—'}
                  {l.uploaded_by_name && (
                    <span className="block text-xs text-muted-foreground/70">
                      by {l.uploaded_by_name}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
