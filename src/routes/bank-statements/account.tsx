import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  ArrowLeft, Upload, Settings2, Download, Search, Loader2, AlertCircle,
  CheckCircle2, Layers, Wallet,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PANEL, MICRO, PANEL_RAIL } from '#/lib/panel'
import { formatCurrency } from '#/lib/format'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { useToast } from '#/lib/hooks/useToast'
import { formatPlainDay } from '#/lib/bank-statement-parser'
import {
  useStatementAccounts, useStatementDays, useAccountStatementLines,
  fetchAllAccountLines,
  type AccountStatementLine, type StatementDay,
} from '#/lib/hooks/useBankStatements'
import { UploadStatementDialog } from './-upload-dialog'
import { exportStatementLines } from './-statement-export'

export const Route = createFileRoute('/bank-statements/account')({
  beforeLoad: () => routeGuard('/bank-statements'),
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: (search.id as string) || undefined,
  }),
  component: BankStatementAccountPage,
})

const STATUS_FILTERS = [
  { value: '', label: 'All payments' },
  { value: 'MATCHED', label: 'Matched' },
  { value: 'UNMATCHED', label: 'Unmatched' },
]

/**
 * One bank account's statement, end to end.
 *
 * Every payment sits in ONE table, ordered by the date the bank printed, with
 * a banded heading wherever the day changes. It was a list of collapsed days:
 * that hid the statement behind fifty closed boxes, and reading a week meant
 * opening seven of them. A day's totals are still worth having, so they ride
 * on the band rather than being the only thing visible.
 */
function BankStatementAccountPage() {
  const { id } = Route.useSearch()
  const toast = useToast()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [dialog, setDialog] = useState<null | 'upload' | 'format'>(null)
  const [downloading, setDownloading] = useState(false)

  const { data: accounts = [], isLoading: loadingAccounts } = useStatementAccounts()
  const account = accounts.find((a) => String(a.bank_account_id) === String(id))

  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to])
  const { data: days = [] } = useStatementDays(id, range)
  const { data, isFetching } = useAccountStatementLines(id, {
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
    q: search.trim() || undefined,
    page,
    limit: pageSize,
  })

  const label = account
    ? `${account.account_name} — ${account.bank_name} · ${account.account_number}`
    : 'This account'

  /** Day totals, keyed by day, for the bands inside the table. */
  const dayTotals = useMemo(() => new Map(days.map((d) => [d.day, d])), [days])

  /**
   * The figures shown are the ones for the FILTERED set, not for the account.
   *
   * A filter that narrows the table but leaves the headline figures reporting
   * the whole account is the way a screen tells you something untrue while
   * every number on it is correct.
   */
  const totals = data?.totals
  const filtered = Boolean(from || to || status || search.trim())

  const handleDownload = async (opts: { day?: string } = {}) => {
    if (!account || !id) return
    setDownloading(true)
    try {
      const lines = await fetchAllAccountLines(id, {
        from: opts.day ? undefined : from || undefined,
        to: opts.day ? undefined : to || undefined,
        day: opts.day,
        status: opts.day ? undefined : status || undefined,
        q: opts.day ? undefined : (search.trim() || undefined),
      })
      if (!lines.length) {
        toast.error('Nothing to download for that selection')
        return
      }
      await exportStatementLines({
        account,
        lines,
        from: opts.day ? undefined : from || undefined,
        to: opts.day ? undefined : to || undefined,
        day: opts.day,
        status: opts.day ? undefined : status || undefined,
      })
    } catch {
      toast.error('That report could not be built')
    } finally {
      setDownloading(false)
    }
  }

  const clearFilters = () => {
    setFrom(''); setTo(''); setStatus(''); setSearch(''); setPage(1)
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
        title={account?.account_name || (loadingAccounts ? 'Loading…' : 'Unknown account')}
        description={
          account
            ? `${account.bank_name} · ${account.account_number}`
            : 'This account could not be found.'
        }
        actions={account ? (
          <>
            <Button variant="outline" onClick={() => setDialog('format')}>
              <Settings2 data-icon="inline-start" />
              Edit format
            </Button>
            <Button
              variant="outline"
              disabled={downloading || (data?.pagination.total ?? 0) === 0}
              onClick={() => handleDownload()}
            >
              {downloading ? <Loader2 className="animate-spin" /> : <Download data-icon="inline-start" />}
              Download report
            </Button>
            <Button onClick={() => setDialog('upload')}>
              <Upload data-icon="inline-start" />
              Upload statement
            </Button>
          </>
        ) : undefined}
      />

      {account && (
        <>
          {/*
            Four cards, two by two. It was eight — first uploaded, last
            uploaded, the period covered and the duplicate count each had a
            card of their own, which gave four supporting facts the same weight
            as the money. They are supporting facts, so they now ride as the
            caption under the figure they qualify.
          */}
          <StatCardGrid count={4} className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
            <StatCard
              tone="blue" icon={<Wallet />}
              label={filtered ? 'Credited in this view' : 'Total credited'}
              value={formatCurrency(Number(totals?.total_amount || 0))}
              valueClassName="text-blue-700 dark:text-blue-300"
              description={
                <>
                  {(totals?.total ?? 0).toLocaleString()} payment{totals?.total === 1 ? '' : 's'}
                  {' · '}{account.day_count.toLocaleString()} day{account.day_count === 1 ? '' : 's'} covered
                  {account.first_txn_date && account.last_txn_date && (
                    <>
                      <br />
                      {formatPlainDay(account.first_txn_date)} – {formatPlainDay(account.last_txn_date)}
                    </>
                  )}
                </>
              }
            />
            <StatCard
              tone="green" icon={<CheckCircle2 />} label="Matched to an order"
              value={formatCurrency(Number(totals?.matched_amount || 0))}
              valueClassName="text-accent"
              description={`${(totals?.matched ?? 0).toLocaleString()} of ${(totals?.total ?? 0).toLocaleString()} payments`}
            />
            <StatCard
              tone={Number(totals?.unmatched_amount || 0) > 0 ? 'amber' : 'green'}
              icon={<AlertCircle />} label="Still unmatched"
              value={formatCurrency(Number(totals?.unmatched_amount || 0))}
              valueClassName={Number(totals?.unmatched_amount || 0) > 0 ? 'text-warning' : undefined}
              description={`${(totals?.unmatched ?? 0).toLocaleString()} payment${totals?.unmatched === 1 ? '' : 's'} no order has claimed`}
            />
            <StatCard
              tone="neutral" icon={<Layers />} label="Times uploaded"
              value={account.statement_count.toLocaleString()}
              description={
                <>
                  {account.first_uploaded_at && account.last_uploaded_at ? (
                    <>
                      First {format(new Date(account.first_uploaded_at), 'd MMM yyyy')}
                      {', last '}{format(new Date(account.last_uploaded_at), 'd MMM yyyy')}
                    </>
                  ) : 'Nothing uploaded yet'}
                  <br />
                  {account.duplicate_count.toLocaleString()} duplicate
                  {account.duplicate_count === 1 ? '' : 's'} skipped
                  {account.repeated_reference_count > 0
                    && `, ${account.repeated_reference_count.toLocaleString()} on a repeated reference`}
                </>
              }
            />
          </StatCardGrid>

          {/*
            A repeated reference at scale is not housekeeping. It means this
            account's reference column points at something that is not a
            reference, and every upload since has been dropping real credits on
            the floor. Said here, on the account, where it can be acted on.
          */}
          {account.repeated_reference_count >= 20 && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 px-5 py-4">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
              <div className="text-sm">
                <p className="font-medium">
                  {account.repeated_reference_count.toLocaleString()} payments have been skipped for
                  carrying a reference already on this account.
                </p>
                <p className="mt-1 text-muted-foreground">
                  A handful is an ordinary overlap between two exports. This many usually means the
                  reference column is mapped onto the narration, so every payment from the same
                  payer looks like the same payment.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialog('format')}>
                  <Settings2 data-icon="inline-start" />
                  Check the format
                </Button>
              </div>
            </div>
          )}

          <FilterPanel
            from={from} to={to} status={status} search={search}
            onFrom={(v) => { setFrom(v); setPage(1) }}
            onTo={(v) => { setTo(v); setPage(1) }}
            onStatus={(v) => { setStatus(v); setPage(1) }}
            onSearch={(v) => { setSearch(v); setPage(1) }}
            onClear={clearFilters}
            active={filtered}
          />

          <section className={PANEL}>
              <div className={PANEL_RAIL}>
                <span className={MICRO}>
                  Payments{data ? ` (${data.pagination.total.toLocaleString()})` : ''}
                </span>
                {isFetching && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading
                  </span>
                )}
              </div>

              {!data && isFetching ? (
                <PageEmpty
                  title="Reading the statement…"
                  description="Fetching every payment on this account."
                />
              ) : (data?.lines.length ?? 0) === 0 ? (
                <PageEmpty
                  title={filtered ? 'Nothing matches those filters' : 'Nothing uploaded yet'}
                  description={filtered
                    ? 'No payment on this account answers to that combination. Clear the filters to see everything.'
                    : 'Upload a statement for this account to get started.'}
                />
              ) : (
                <div className="px-2 pb-2">
                  <PaymentsTable
                    lines={data!.lines}
                    dayTotals={dayTotals}
                    downloading={downloading}
                    onDownloadDay={(d) => handleDownload({ day: d })}
                  />
                  <div className="px-2">
                    <Pagination
                      currentPage={data!.pagination.page}
                      totalPages={data!.pagination.pages}
                      pageSize={data!.pagination.limit}
                      totalItems={data!.pagination.total}
                      onPageChange={setPage}
                      onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
                    />
                  </div>
                </div>
              )}
          </section>

          {dialog && (
            <UploadStatementDialog
              open
              onOpenChange={(v) => !v && setDialog(null)}
              bankAccountId={account.bank_account_id}
              bankLabel={label}
              accountName={account.account_name}
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

/**
 * The filters: a row of pickers, then the search on a line of its own.
 *
 * The search shared a row with three other controls and collapsed to a bare
 * magnifying glass at anything under a wide screen — the one control most used
 * here was the one squeezed out. It gets the full width now, because what goes
 * into it is a bank reference or a payer's name, not a word.
 *
 * Status is a select rather than three buttons: it is one choice out of three,
 * which is what a select is for, and it stops the row growing every time
 * another state exists.
 */
function FilterPanel({
  from, to, status, search,
  onFrom, onTo, onStatus, onSearch, onClear, active,
}: {
  from: string
  to: string
  status: string
  search: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  onStatus: (v: string) => void
  onSearch: (v: string) => void
  onClear: () => void
  active: boolean
}) {
  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <span className={MICRO}>Filters</span>
        {active && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear all filters
          </Button>
        )}
      </div>

      <div className="space-y-4 px-6 pt-5 pb-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From" htmlFor="from">
            <Input id="from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" type="date" value={to} onChange={(e) => onTo(e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="status">
            <NativeSelect
              id="status"
              value={status}
              onChange={(e) => onStatus(e.target.value)}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <Field label="Search" htmlFor="q">
          <div className="relative">
            <Search className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Amount, depositor, narration, bank reference, order reference, customer, who uploaded or matched it, file name…"
              className="h-12 w-full pl-12 text-base"
            />
          </div>
        </Field>
      </div>
    </section>
  )
}

function Field({
  label, htmlFor, children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Every payment on the account, in one table, banded by the day it landed.
 *
 * Where a payment came from and where it went are both on the row, because
 * the question asked of a statement line is never one or the other. "This
 * credit is not in the system" and "why has this order been paid twice" are
 * the same question read from opposite ends.
 *
 * Nothing is truncated. A long narration or a long file name wraps inside a
 * capped column rather than ending in an ellipsis that hides exactly the part
 * somebody is looking for.
 */
function PaymentsTable({
  lines, dayTotals, downloading, onDownloadDay,
}: {
  lines: AccountStatementLine[]
  dayTotals: Map<string, StatementDay>
  downloading: boolean
  onDownloadDay: (day: string) => void
}) {
  const rows: React.ReactNode[] = []
  let openDay = ''

  /**
   * A day's subtotal, closing the day rather than opening it.
   *
   * It had been folded into the date cell of the day's FIRST payment, which
   * put a day's total, its payment count and a download button on a row that
   * describes one credit — so the row read as if ₦214,560,000 and "3 payments"
   * were facts about the ₦53,640,000 sitting beside them. A subtotal belongs
   * on a row of its own, under the column it totals.
   */
  const pushDayTotal = (day: string) => {
    const t = dayTotals.get(day)
    if (!t) return
    rows.push(
      <TableRow
        key={`total-${day}`}
        className="border-l-4 border-l-transparent border-b-2 border-b-foreground/25 bg-muted/60 hover:bg-muted/60"
      >
        <TableCell className="whitespace-nowrap font-semibold">
          {formatPlainDay(day)} total
        </TableCell>
        {/* Under the Amount column, because that is the column it totals. */}
        <TableCell className="text-right text-base font-semibold whitespace-nowrap tabular-nums">
          {formatCurrency(Number(t.total_amount))}
        </TableCell>
        <TableCell colSpan={8}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone="inert" fill="solid">
              {t.line_count} payment{t.line_count === 1 ? '' : 's'}
            </StatusChip>
            <StatusChip tone={t.matched_count > 0 ? 'accent' : 'inert'} fill="solid">
              {t.matched_count} matched
            </StatusChip>
            <StatusChip tone={t.unmatched_count > 0 ? 'warning' : 'inert'} fill="solid">
              {t.unmatched_count} unmatched
            </StatusChip>
            {/*
              How many files this day arrived in. It is what makes a day look
              wrong when it is not — a day re-uploaded four times still holds
              each credit once, and saying so pre-empts the question.
            */}
            {t.upload_count > 1 && (
              <span className="text-muted-foreground">from {t.upload_count} uploads</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Button
            variant="outline" size="sm"
            disabled={downloading}
            onClick={() => onDownloadDay(day)}
          >
            <Download data-icon="inline-start" />
            Download
          </Button>
        </TableCell>
      </TableRow>,
    )
  }

  for (const l of lines) {
    const day = String(l.txn_date).slice(0, 10)
    // Rows arrive newest day first, so a day is contiguous: the moment the
    // date changes, the day before it is complete and gets its subtotal.
    if (openDay && day !== openDay) pushDayTotal(openDay)
    openDay = day

    const matched = l.status === 'MATCHED'
    // Matched, but the order it named is gone — a real state (an order can be
    // deleted after the fact) and one worth showing rather than leaving as an
    // empty cell.
    const orphaned = matched && l.order_id == null

    rows.push(
      /*
        The stripe is the scannable part. A chip has to be read; a 4px edge
        down the left of every row is read without being looked at, which is
        what somebody running an eye down two hundred payments for the ones
        nothing has claimed actually needs.
      */
      <TableRow
        key={l.id}
        className={cn(
          'border-l-4',
          matched ? 'border-l-accent' : 'border-l-warning bg-warning/5',
        )}
      >
        <TableCell className="whitespace-nowrap">{formatPlainDay(l.txn_date)}</TableCell>
        <TableCell className="text-right text-base font-semibold whitespace-nowrap tabular-nums">
          ₦{Number(l.amount).toLocaleString()}
        </TableCell>
        <TableCell className="whitespace-normal">
          {matched
            ? <StatusChip tone="accent" fill="solid">Matched</StatusChip>
            : <StatusChip tone="warning" fill="solid">Unmatched</StatusChip>}
        </TableCell>
        <TableCell className="whitespace-normal">
          <span className="block break-words">{l.depositor || '—'}</span>
          {l.narration && l.narration !== l.depositor && (
            <span className="mt-1 block break-words text-muted-foreground">
              {l.narration}
            </span>
          )}
        </TableCell>
        <TableCell className="whitespace-normal">
          <span className="block font-mono break-all">{l.bank_ref || '—'}</span>
        </TableCell>
        <TableCell className="whitespace-normal">
          {l.order_reference && l.order_id != null ? (
            /*
              The order reference is the end of the money's journey, so it goes
              where the journey goes. A link, not a button: a button in every
              row of a dense table turns the column into a wall of chrome, and
              the reference itself is the thing worth reading.
            */
            <Link
              to="/orders/details"
              search={{ id: String(l.order_id) }}
              className="font-semibold underline underline-offset-2 hover:text-accent"
            >
              {l.order_reference}
            </Link>
          ) : orphaned ? (
            /*
              Matched, but the order it named has since been deleted. That is
              its own finding, not a second way of saying unmatched — the line
              still holds its deposit — so it survives the Status column
              taking over everything else this cell used to say.
            */
            <StatusChip tone="destructive" fill="solid">Order deleted</StatusChip>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="whitespace-normal">
          <span className="block break-words">{l.matched_by_name || '—'}</span>
        </TableCell>
        <TableCell className="whitespace-normal">
          {l.matched_at ? format(new Date(l.matched_at), 'd MMM yyyy, HH:mm') : '—'}
        </TableCell>
        <TableCell className="whitespace-normal">
          <span className="block break-words">{l.uploaded_by_name || '—'}</span>
        </TableCell>
        <TableCell className="whitespace-normal">
          {l.uploaded_at ? format(new Date(l.uploaded_at), 'd MMM yyyy, HH:mm') : '—'}
        </TableCell>
        <TableCell className="whitespace-normal">
          <span className="block break-all text-muted-foreground">
            {l.filename || '—'}
          </span>
        </TableCell>
      </TableRow>,
    )
  }
  // The last day on the page has no following day to trigger its subtotal.
  if (openDay) pushDayTotal(openDay)

  /*
    ── whitespace-normal on every cell that holds free text ────────────────

    TableCell ships `whitespace-nowrap`. A cell inherits that to its children,
    and `white-space: nowrap` beats `overflow-wrap: break-word` outright — so
    the wrapping asked of the depositor and the file name could never happen
    and the text ran straight over the next column instead. The width was never
    the problem; the default was. Date and Amount keep nowrap on purpose.

    ── table-fixed with a stated minimum, not the default w-full auto layout ─

    Ten columns of bank narration do not fit a panel, and an auto-layout table
    told to be w-full does not scroll — it compresses every column to its
    minimum and lets the content spill across its neighbours. Fixing the
    columns makes each one a known width that text WRAPS inside, and the
    minimum width is what makes Table's own overflow-x-auto actually scroll.

    Table already wraps itself in an overflow-x-auto div, so there is no outer
    scroller here — a second one only produced a scrollbar that moved nothing.
  */
  return (
    <Table className="min-w-[1872px] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[9.5rem]">Date</TableHead>
          <TableHead className="w-[10rem] text-right">Amount</TableHead>
          <TableHead className="w-[6.5rem]">Status</TableHead>
          <TableHead className="w-[20rem]">Depositor</TableHead>
          <TableHead className="w-[12rem]">Bank reference</TableHead>
          <TableHead className="w-[8rem]">Order</TableHead>
          <TableHead className="w-[10rem]">Matched by</TableHead>
          <TableHead className="w-[10rem]">Matched on</TableHead>
          <TableHead className="w-[10rem]">Uploaded by</TableHead>
          <TableHead className="w-[10rem]">Uploaded on</TableHead>
          <TableHead className="w-[11rem]">Source file</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows}</TableBody>
    </Table>
  )
}
