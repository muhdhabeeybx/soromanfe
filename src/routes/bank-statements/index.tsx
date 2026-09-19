import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Upload, Landmark, CheckCircle2, AlertCircle, Settings2, Search,
  ArrowRight, FileSpreadsheet,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageEmpty } from '#/components/PageEmpty'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { PANEL, MICRO } from '#/lib/panel'
import { formatCurrency } from '#/lib/format'
import { formatPlainDay } from '#/lib/bank-statement-parser'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import {
  useStatementAccounts, type StatementAccountSummary,
} from '#/lib/hooks/useBankStatements'
import { UploadStatementDialog } from './-upload-dialog'

export const Route = createFileRoute('/bank-statements/')({
  beforeLoad: () => routeGuard('/bank-statements'),
  component: BankStatementsPage,
})

/**
 * Bank statements, one bank at a time.
 *
 * This page used to be a single upload form with an account dropdown and one
 * flat list of every file ever imported, across every account. That is not how
 * anybody holds the problem: a bank statement belongs to a bank, and the
 * questions asked of it — how much has come in on this account, how much of it
 * has been claimed, what is still sitting there — are all per account.
 *
 * So the account is the unit. Each bank gets a card carrying its own totals,
 * and everything else happens inside it.
 */
function BankStatementsPage() {
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [uploadFor, setUploadFor] = useState<StatementAccountSummary | null>(null)

  const { data: accounts = [], isLoading } = useStatementAccounts()

  const totals = useMemo(() => {
    const withUploads = accounts.filter((a) => a.statement_count > 0)
    const sum = (pick: (a: StatementAccountSummary) => string) =>
      accounts.reduce((s, a) => s + Number(pick(a) || 0), 0)
    return {
      banks: withUploads.length,
      files: accounts.reduce((s, a) => s + a.statement_count, 0),
      total: sum((a) => a.total_amount),
      matched: sum((a) => a.matched_amount),
      unmatched: sum((a) => a.unmatched_amount),
      unmatchedRows: accounts.reduce((s, a) => s + a.unmatched_count, 0),
    }
  }, [accounts])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      // An account with history stays visible whatever its status says — the
      // money is already on it, and hiding it would hide the money.
      if (onlyActive && a.status !== 'Active' && a.statement_count === 0) return false
      if (!q) return true
      return [a.bank_name, a.account_name, a.account_number]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [accounts, search, onlyActive])

  const uploaded = shown.filter((a) => a.statement_count > 0)
  const untouched = shown.filter((a) => a.statement_count === 0)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Bank statements"
        description="Every account, what has been uploaded against it, and how much of it an order has claimed."
      />

      <StatCardGrid count={4}>
        <StatCard
          icon={<Landmark />} label="Banks with statements"
          value={totals.banks}
          description={`${totals.files.toLocaleString()} file${totals.files === 1 ? '' : 's'} imported`}
        />
        <StatCard
          icon={<FileSpreadsheet />} tone="neutral" label="Total credited"
          value={formatCurrency(totals.total)}
        />
        <StatCard
          icon={<CheckCircle2 />} label="Matched to an order"
          value={formatCurrency(totals.matched)}
          description={
            totals.total > 0
              ? `${Math.round((totals.matched / totals.total) * 100)}% of everything uploaded`
              : undefined
          }
        />
        <StatCard
          tone={totals.unmatched > 0 ? 'amber' : 'green'}
          icon={<AlertCircle />} label="Still unmatched"
          value={formatCurrency(totals.unmatched)}
          description={`${totals.unmatchedRows.toLocaleString()} row${totals.unmatchedRows === 1 ? '' : 's'} unclaimed`}
        />
      </StatCardGrid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a bank or account number"
            className="pl-8"
          />
        </div>
        <Button
          variant={onlyActive ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => setOnlyActive((v) => !v)}
        >
          {onlyActive ? 'Hiding closed accounts' : 'Showing every account'}
        </Button>
      </div>

      {isLoading ? (
        <section className={PANEL}>
          <PageEmpty title="Loading accounts…" description="Reading what has been uploaded." />
        </section>
      ) : shown.length === 0 ? (
        <section className={PANEL}>
          <PageEmpty
            title="No accounts match"
            description="Nothing here answers to that search. Clear it to see every bank account."
          />
        </section>
      ) : (
        <div className="space-y-6">
          {uploaded.length > 0 && (
            <div className="space-y-3">
              <span className={cn(MICRO, 'block text-muted-foreground')}>
                With statements ({uploaded.length})
              </span>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {uploaded.map((a) => (
                  <BankCard key={a.bank_account_id} account={a} onUpload={() => setUploadFor(a)} />
                ))}
              </div>
            </div>
          )}

          {untouched.length > 0 && (
            <div className="space-y-3">
              <span className={cn(MICRO, 'block text-muted-foreground')}>
                Nothing uploaded yet ({untouched.length})
              </span>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {untouched.map((a) => (
                  <BankCard key={a.bank_account_id} account={a} onUpload={() => setUploadFor(a)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {uploadFor && (
        <UploadStatementDialog
          open
          onOpenChange={(v) => !v && setUploadFor(null)}
          bankAccountId={uploadFor.bank_account_id}
          bankLabel={`${uploadFor.bank_name} — ${uploadFor.account_name} · ${uploadFor.account_number}`}
        />
      )}
    </div>
  )
}

/**
 * One bank's whole statement position on a card.
 *
 * The figure that leads is the total credited, because that is the one anybody
 * asks for first. Matched and unmatched sit under it as a split of that same
 * figure rather than as two unrelated numbers — the point of the pair is the
 * proportion, and a bar says that faster than two amounts do.
 */
function BankCard({
  account: a, onUpload,
}: {
  account: StatementAccountSummary
  onUpload: () => void
}) {
  const total = Number(a.total_amount || 0)
  const matched = Number(a.matched_amount || 0)
  const unmatched = Number(a.unmatched_amount || 0)
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0
  const empty = a.statement_count === 0

  return (
    <section className={cn(PANEL, 'flex flex-col')}>
      <div className="flex items-start justify-between gap-3 border-b border-foreground/15 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{a.bank_name}</p>
          <p className="truncate text-xs text-muted-foreground">{a.account_name}</p>
          <p className="font-mono text-xs text-muted-foreground/70">{a.account_number}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {a.has_format
            ? <StatusChip tone="accent" size="rail">Format saved</StatusChip>
            : <StatusChip tone="warning" size="rail">No format</StatusChip>}
          {a.status !== 'Active' && <StatusChip tone="inert" size="rail">{a.status}</StatusChip>}
        </div>
      </div>

      <div className="flex-1 space-y-4 px-5 py-4">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            No statement has been uploaded for this account.
            {!a.has_format && ' Its format will be set up on the first upload.'}
          </p>
        ) : (
          <>
            <div>
              <span className={cn(MICRO, 'block text-muted-foreground')}>Total credited</span>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(total)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {a.statement_count.toLocaleString()} file{a.statement_count === 1 ? '' : 's'}
                {' · '}{a.line_count.toLocaleString()} row{a.line_count === 1 ? '' : 's'}
                {' · '}{a.day_count.toLocaleString()} day{a.day_count === 1 ? '' : 's'}
              </p>
            </div>

            {/* Matched against unmatched, as a split of the one total. */}
            <div className="space-y-1.5">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div className="bg-accent" style={{ width: `${pct}%` }} />
                <div className="bg-warning" style={{ width: `${100 - pct}%` }} />
              </div>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-accent">
                  {formatCurrency(matched)}
                  <span className="text-muted-foreground"> matched · {pct}%</span>
                </span>
                <span className={unmatched > 0 ? 'text-warning' : 'text-muted-foreground'}>
                  {formatCurrency(unmatched)}
                  <span className="text-muted-foreground"> left</span>
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div>
                <dt className="text-muted-foreground">First uploaded</dt>
                <dd>{a.first_uploaded_at ? format(new Date(a.first_uploaded_at), 'd MMM yyyy') : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last uploaded</dt>
                <dd>{a.last_uploaded_at ? format(new Date(a.last_uploaded_at), 'd MMM yyyy') : '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Statement covers</dt>
                {/*
                  formatPlainDay, not new Date(): these are calendar days, and
                  `new Date('2026-09-17')` is UTC midnight — the exact round
                  trip that put 1,066 rows a day out. See migration 0039.
                */}
                <dd>
                  {a.first_txn_date && a.last_txn_date
                    ? `${formatPlainDay(a.first_txn_date)} – ${formatPlainDay(a.last_txn_date)}`
                    : '—'}
                </dd>
              </div>
            </dl>

            {/*
              A repeated reference is a finding, not a statistic. One or two is
              an ordinary overlap between two exports; hundreds means this
              account's reference column is mapped onto something that is not a
              reference, and every upload is quietly shedding real credits.
            */}
            {a.repeated_reference_count > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  <strong className="text-foreground">{a.repeated_reference_count.toLocaleString()}</strong>
                  {' '}row{a.repeated_reference_count === 1 ? '' : 's'} skipped on a repeated
                  reference. Check the reference column if this keeps growing.
                </span>
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-foreground/15 bg-muted/40 px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onUpload}>
          {a.has_format ? <Upload data-icon="inline-start" /> : <Settings2 data-icon="inline-start" />}
          {a.has_format ? 'Upload' : 'Set up & upload'}
        </Button>
        {!empty && (
          <Button asChild variant="outline" size="sm">
            <Link to="/bank-statements/account" search={{ id: String(a.bank_account_id) }}>
              Open
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
