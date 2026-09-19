import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Upload, Landmark, CheckCircle2, AlertCircle, Search, ArrowRight, Wallet,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageEmpty } from '#/components/PageEmpty'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
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
 * Bank name A→Z, then account name Z→A inside it.
 *
 * Case-insensitive on purpose: the same bank is spelled "Zenith Bank" on one
 * account and "ZENITH BANK" on another, and a case-sensitive sort would file
 * those under two different letters and split the bank in half.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

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
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [uploadFor, setUploadFor] = useState<StatementAccountSummary | null>(null)

  const { data: accounts = [], isLoading } = useStatementAccounts()

  const totals = useMemo(() => {
    const sum = (pick: (a: StatementAccountSummary) => string) =>
      accounts.reduce((s, a) => s + Number(pick(a) || 0), 0)
    return {
      banks: accounts.filter((a) => a.statement_count > 0).length,
      total: sum((a) => a.total_amount),
      matched: sum((a) => a.matched_amount),
      unmatched: sum((a) => a.unmatched_amount),
    }
  }, [accounts])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts
      .filter((a) => !q || [a.bank_name, a.account_name, a.account_number]
        .some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) =>
        collator.compare(a.bank_name || '', b.bank_name || '')
        // Descending within the bank — Z first, as asked.
        || collator.compare(b.account_name || '', a.account_name || ''))
  }, [accounts, search])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Bank statements"
        description="Every account, what has been uploaded against it, and how much of it an order has claimed."
      />

      {/*
        Two by two. Four figures with no captions under them — the label above
        each one already says what it is, and a caption repeating it in smaller
        type was noise around the number somebody came here to read.
      */}
      <StatCardGrid count={4} className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
        <StatCard
          tone="blue" icon={<Wallet />} label="Total credited"
          value={formatCurrency(totals.total)}
          valueClassName="text-blue-700 dark:text-blue-300"
        />
        <StatCard
          tone="green" icon={<CheckCircle2 />} label="Matched to an order"
          value={formatCurrency(totals.matched)}
          valueClassName="text-accent"
        />
        <StatCard
          tone="amber" icon={<AlertCircle />} label="Still unmatched"
          value={formatCurrency(totals.unmatched)}
          valueClassName="text-warning"
        />
        <StatCard
          tone="neutral" icon={<Landmark />} label="Banks with statements"
          value={totals.banks}
        />
      </StatCardGrid>

      <div className="relative">
        <Search className="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a bank, account name or account number"
          className="h-12 w-full pl-12 text-base"
        />
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <BankCard
              key={a.bank_account_id}
              account={a}
              onUpload={() => setUploadFor(a)}
              onOpen={() => navigate({
                to: '/bank-statements/account',
                search: { id: String(a.bank_account_id) },
              })}
            />
          ))}
        </div>
      )}

      {uploadFor && (
        <UploadStatementDialog
          open
          onOpenChange={(v) => !v && setUploadFor(null)}
          bankAccountId={uploadFor.bank_account_id}
          bankLabel={`${uploadFor.account_name} — ${uploadFor.bank_name} · ${uploadFor.account_number}`}
          accountName={uploadFor.account_name}
        />
      )}
    </div>
  )
}

/**
 * One bank's whole statement position on a card.
 *
 * The ACCOUNT leads, then the bank, then the number — "Zenith Bank" is not an
 * identity here, because eleven of these cards say Zenith Bank. The account
 * name is what tells them apart, so it is the one set in the strongest type
 * and the one that is never truncated: an account whose name is cut off at
 * "SOROMAN PORTHARC…" has been made harder to identify by the very element
 * meant to identify it.
 *
 * The figure that leads is the total credited, because that is the one anybody
 * asks for first. Matched and unmatched sit under it as a split of that same
 * figure rather than as two unrelated numbers — the point of the pair is the
 * proportion, and a bar says that faster than two amounts do.
 *
 * The whole card opens the account. The Open button stays anyway: the click
 * target is a mouse convenience laid over a real link, not a replacement for
 * one, so the keyboard and a screen reader still have something to land on.
 */
function BankCard({
  account: a, onUpload, onOpen,
}: {
  account: StatementAccountSummary
  onUpload: () => void
  onOpen: () => void
}) {
  const total = Number(a.total_amount || 0)
  const matched = Number(a.matched_amount || 0)
  const unmatched = Number(a.unmatched_amount || 0)
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0
  const empty = a.statement_count === 0

  return (
    <section
      onClick={empty ? undefined : onOpen}
      className={cn(
        PANEL,
        'flex flex-col transition-colors duration-250 ease-luxe',
        !empty && 'cursor-pointer hover:border-accent/50',
      )}
    >
      <div className="border-b border-foreground/15 px-5 py-4">
        <p className="text-base font-semibold break-words uppercase">{a.account_name}</p>
        <p className="mt-1 font-medium break-words uppercase text-muted-foreground">
          {a.bank_name}
        </p>
        <p className="mt-0.5 font-mono font-semibold">{a.account_number}</p>
      </div>

      <div className="flex-1 space-y-4 px-5 py-4">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            No statement has been uploaded for this account.
          </p>
        ) : (
          <>
            <div>
              <span className={cn(MICRO, 'block text-muted-foreground')}>Total credited</span>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                {formatCurrency(total)}
              </p>
              {/*
                "111 files · 992 rows · 52 days" names the storage, not the
                thing. What was uploaded 111 times, what arrived 992 times and
                what 52 days means are three different questions, and the line
                should answer them rather than leave them to be inferred.
              */}
              <p className="mt-1 text-sm text-muted-foreground">
                {a.statement_count.toLocaleString()} time{a.statement_count === 1 ? '' : 's'} uploaded
                {', '}{a.line_count.toLocaleString()} payment{a.line_count === 1 ? '' : 's'}
                {', '}{a.day_count.toLocaleString()} day{a.day_count === 1 ? '' : 's'} covered
              </p>
            </div>

            {/* Matched against unmatched, as a split of the one total. */}
            <div className="space-y-2">
              <div className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
                <div className="bg-accent" style={{ width: `${pct}%` }} />
                <div className="bg-warning" style={{ width: `${100 - pct}%` }} />
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-accent">
                  {formatCurrency(matched)}
                  <span className="font-normal text-muted-foreground"> matched · {pct}%</span>
                </span>
                <span className={cn('font-semibold', unmatched > 0 ? 'text-warning' : 'text-muted-foreground')}>
                  {formatCurrency(unmatched)}
                  <span className="font-normal text-muted-foreground"> left</span>
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">First uploaded</dt>
                <dd className="font-medium">
                  {a.first_uploaded_at ? format(new Date(a.first_uploaded_at), 'd MMM yyyy') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last uploaded</dt>
                <dd className="font-medium">
                  {a.last_uploaded_at ? format(new Date(a.last_uploaded_at), 'd MMM yyyy') : '—'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Statement covers</dt>
                {/*
                  formatPlainDay, not new Date(): these are calendar days, and
                  `new Date('2026-09-17')` is UTC midnight — the exact round
                  trip that put 1,066 rows a day out. See migration 0039.
                */}
                <dd className="font-medium">
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
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  <strong>{a.repeated_reference_count.toLocaleString()}</strong>
                  {' '}payment{a.repeated_reference_count === 1 ? '' : 's'} skipped on a repeated
                  reference. Check the reference column if this keeps growing.
                </span>
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-foreground/15 bg-muted/40 px-5 py-3">
        <Button
          className="bg-accent text-accent-foreground hover:bg-accent/85"
          onClick={(e) => { e.stopPropagation(); onUpload() }}
        >
          <Upload data-icon="inline-start" />
          Upload
        </Button>
        {!empty && (
          <Button
            asChild
            className="bg-blue-600 text-white hover:bg-blue-600/85 dark:bg-blue-700 dark:hover:bg-blue-700/85"
          >
            <Link
              to="/bank-statements/account"
              search={{ id: String(a.bank_account_id) }}
              onClick={(e) => e.stopPropagation()}
            >
              Open
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
