import { useState } from 'react'
import { format } from 'date-fns'
import { Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageEmpty } from '#/components/PageEmpty'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useStatementLines, type BankStatement } from '#/lib/hooks/useBankStatements'

/** How many uploads to show at once — the list grows with every import. */
const UPLOADS_PER_PAGE = 10
/** Rows of a single upload, per page. */
const LINES_PER_PAGE = 25

/**
 * The uploads for an account, and what happened to the rows inside one.
 *
 * The list could say how many of an upload's rows were matched but never
 * which, so "I uploaded this statement and cannot find some rows" had no
 * answer from the screen at all. Selecting an upload now opens its rows with
 * the order each was matched to and who matched it.
 */
export function StatementUploads({
  statements, onDelete, deleting,
}: {
  statements: BankStatement[]
  onDelete: (id: number) => void
  deleting: boolean
}) {
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)

  // Paging lives here, not in the query: the list per account is small, and a
  // round trip to turn a page of ten would be slower than the render.
  const pages = Math.max(1, Math.ceil(statements.length / UPLOADS_PER_PAGE))
  const current = Math.min(page, pages)
  const shown = statements.slice((current - 1) * UPLOADS_PER_PAGE, current * UPLOADS_PER_PAGE)
  const selected = statements.find((s) => s.id === openId) || null

  return (
    <>
      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            Uploaded statements{statements.length ? ` (${statements.length})` : ''}
          </span>
          {pages > 1 && (
            <span className="text-xs text-muted-foreground">Page {current} of {pages}</span>
          )}
        </div>
        {statements.length === 0 ? (
          <PageEmpty
            title="Nothing uploaded yet"
            description="Choose a bank account above — statements imported for it are listed here."
          />
        ) : (
          <div className="px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Matched</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => {
                  const open = s.id === openId
                  return (
                    <TableRow
                      key={s.id}
                      className={cn('cursor-pointer', open && 'bg-accent/5')}
                      onClick={() => setOpenId(open ? null : s.id)}
                    >
                      <TableCell className="font-normal">
                        <span className="flex items-center gap-1.5">
                          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                          <span className="max-w-[18rem] truncate">{s.filename || '—'}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.bank_name} · {s.account_name} · {s.account_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {s.period_start ? format(new Date(s.period_start), 'd MMM') : '—'}
                        {' – '}
                        {s.period_end ? format(new Date(s.period_end), 'd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell className="text-right">{s.row_count}</TableCell>
                      <TableCell className="text-right">
                        {s.matched_count > 0
                          ? <StatusChip tone="accent">{s.matched_count}</StatusChip>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format(new Date(s.created_at), 'd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={deleting}
                          onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                        >
                          <Trash2 />
                          <span className="sr-only">Delete {s.filename}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {pages > 1 && (
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <Button
                  variant="outline" size="sm"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  {(current - 1) * UPLOADS_PER_PAGE + 1}–{Math.min(current * UPLOADS_PER_PAGE, statements.length)} of {statements.length}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </Button>
              </div>
            )}

            <p className="px-4 pb-2 text-xs text-muted-foreground/70">
              Select an upload to see every row in it and where each one went. A statement with
              matched lines cannot be deleted — that would break the audit trail behind a
              confirmed payment.
            </p>
          </div>
        )}
      </section>

      {selected && <StatementLineDetail statement={selected} />}
    </>
  )
}

/** The rows of one upload: what each was, and which order took it. */
function StatementLineDetail({ statement }: { statement: BankStatement }) {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')

  const { data, isFetching } = useStatementLines(statement.id, {
    page,
    limit: LINES_PER_PAGE,
    status: status || undefined,
  })

  const lines = data?.lines ?? []
  const totals = data?.totals
  const pages = data?.pagination.pages ?? 1

  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <span className={MICRO}>
          Rows in {statement.filename || 'this upload'}
        </span>
        <span className="flex items-center gap-2">
          {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {totals && (
            <span className="text-xs text-muted-foreground">
              {totals.matched} matched · {totals.unmatched} unmatched
            </span>
          )}
        </span>
      </div>

      <div className={cn(PANEL_BODY, 'space-y-3 p-0 pt-3')}>
        <div className="flex flex-wrap items-center gap-2 px-4">
          {[
            { value: '', label: 'All rows' },
            { value: 'MATCHED', label: 'Matched' },
            { value: 'UNMATCHED', label: 'Unmatched' },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => { setStatus(f.value); setPage(1) }}
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
        </div>

        {lines.length === 0 ? (
          <PageEmpty
            title="No rows here"
            description={status ? 'Nothing in this upload has that status.' : 'This upload has no rows.'}
          />
        ) : (
          <div className="overflow-x-auto px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Depositor</TableHead>
                  <TableHead>Bank Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Matched By</TableHead>
                  <TableHead>Matched On</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const matched = l.status === 'MATCHED'
                  // Matched, but the order it named is gone — a real state
                  // (an order can be deleted after the fact) and one worth
                  // showing rather than leaving as an empty cell.
                  const orphaned = matched && l.order_id == null
                  return (
                    <TableRow key={l.id} className={cn(!matched && 'bg-muted/20')}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(l.txn_date), 'd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-[16rem] truncate" title={l.narration || l.depositor}>
                          {l.depositor || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.bank_ref || '—'}</TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        ₦{Number(l.amount).toLocaleString()}
                      </TableCell>
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
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {pages > 1 && (
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page} of {pages} · {data?.pagination.total} row
                  {data?.pagination.total === 1 ? '' : 's'}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
