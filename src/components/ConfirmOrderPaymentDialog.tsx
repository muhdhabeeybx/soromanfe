import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Hourglass, ArrowRightLeft } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { useConfirmOrderPayment } from '#/lib/hooks/useFinanceReport'
import { useExpectedPayments } from '#/lib/hooks/useExpectedPayments'
import { StatementLinePicker } from '#/components/StatementLinePicker'
import type { StatementLine } from '#/lib/hooks/useBankStatements'
import { MICRO } from '#/lib/panel'
import { cn, toNum } from '#/lib/utils'

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(v)
}

/**
 * Confirm payment on one order, against the bank statement lines that paid
 * for it.
 *
 * ── What is deliberately not here ──────────────────────────────────────────
 *
 * A "draw from wallet balance" field. It let the desk cover a shortfall out of
 * whatever the customer happened to have sitting in their wallet, and that is
 * the single thing that made the finance report unauditable: the order was
 * marked paid, and nothing recorded which bank payment had paid for it. The
 * server has no endpoint for it any more either — see
 * Sman-Backend/db/migrations/0021.
 *
 * So there is exactly one way to confirm an order: name the bank rows. The
 * amount is whatever those rows are worth. Nobody types a figure, so nobody can
 * mistype one, and every naira on the report can be found on a statement.
 *
 * A payment larger than the order is NOT trimmed to fit. The surplus lands on
 * this order and shows there, and moving it to another order is a separate,
 * recorded act — which is what makes it traceable rather than something that
 * quietly disappeared into a balance.
 */
export function ConfirmOrderPaymentDialog({
  order, open, onOpenChange,
}: {
  order: any | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data: bankAccounts } = useBankAccounts({ status: 'Active' })
  // What the customer said they'd pay, captured on the order wizard — the
  // amounts and company names to look for in the statement.
  const { data: expected = [] } = useExpectedPayments(
    open && order?.id ? { orderId: order.id, status: 'pending' } : undefined,
  )
  const confirmPayment = useConfirmOrderPayment()

  const [bankAccountId, setBankAccountId] = useState('')
  const [statementLines, setStatementLines] = useState<StatementLine[]>([])
  const [statementQuery, setStatementQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setBankAccountId(''); setStatementLines([]); setStatementQuery('')
    }
  }, [open])

  if (!order) return null

  const total = toNum(order.totalAmount)
  /** What this order has already taken, across however many instalments. */
  const alreadyPaid = toNum(order.amountPaid)
  const outstanding = Math.max(0, total - alreadyPaid)

  const matched = statementLines.reduce((s, l) => s + Number(l.amount), 0)
  const receivedAfter = alreadyPaid + matched
  const shortfallAfter = Math.max(0, total - receivedAfter)
  const surplusAfter = Math.max(0, receivedAfter - total)
  const isPartPayment = matched > 0 && shortfallAfter > 0
  const readyToConfirm = statementLines.length > 0 && !!bankAccountId

  const handleConfirm = async () => {
    if (!readyToConfirm) return
    try {
      await confirmPayment.mutateAsync({
        orderId: order.id,
        bankAccountId: Number(bankAccountId),
        lineIds: statementLines.map((l) => l.id),
      })
      onOpenChange(false)
    } catch {
      // The mutation raises its own error toast. The dialog stays open with
      // the selection intact so the desk can adjust and retry — the lines are
      // only claimed server-side on success, so nothing is half-done.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm payment — {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {order.customerName}
            {order.companyName || order.customerCompanyName
              ? ` · ${order.companyName || order.customerCompanyName}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-foreground/15 bg-muted/30 p-3 text-sm">
            <div>
              <p className={cn(MICRO, 'text-muted-foreground')}>Order total</p>
              <p className="mt-0.5 font-semibold">{formatCurrency(total)}</p>
              {/* Only when there is a history to show — on a first payment
                  this line would just be a zero taking up room. */}
              {alreadyPaid > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(alreadyPaid)} already received
                </p>
              )}
            </div>
            <div>
              <p className={cn(MICRO, 'text-muted-foreground')}>Still owed</p>
              <p className="mt-0.5 font-semibold">{formatCurrency(outstanding)}</p>
            </div>
            <div>
              <p className={cn(MICRO, 'text-muted-foreground')}>Matching now</p>
              <p className={cn('mt-0.5 font-semibold', matched > 0 ? 'text-success' : 'text-muted-foreground')}>
                {formatCurrency(matched)}
              </p>
              {matched > 0 && shortfallAfter > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(shortfallAfter)} would remain
                </p>
              )}
            </div>
          </div>

          {/* What the customer told the desk they'd pay, captured when the
              order was placed. Advisory — it's the amount and the company
              name to go looking for in the statement below. */}
          {expected.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-info/25 bg-info/5 p-3">
              <p className={cn(MICRO, 'flex items-center gap-1.5 text-info')}>
                <Hourglass className="size-3.5" />
                Payment expected for this order
              </p>
              <ul className="space-y-1">
                {expected.map((ep) => (
                  <li key={ep.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {[ep.reference, ep.note].filter(Boolean).join(' — ') || 'No further detail'}
                    </span>
                    <span className="shrink-0 font-semibold">
                      {ep.expectedAmount ? formatCurrency(Number(ep.expectedAmount)) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {statementLines.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Pick the bank statement line(s) that paid for this order. An order can only be
                confirmed against money the bank has actually received.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className={cn(MICRO, 'text-muted-foreground')}>Receiving bank account</Label>
            <Select
              value={bankAccountId}
              onValueChange={(v) => { setBankAccountId(v); setStatementLines([]) }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose bank account…" />
              </SelectTrigger>
              <SelectContent>
                {(bankAccounts || []).map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.bankName} — {b.accountNumber} · {b.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className={cn(MICRO, 'text-muted-foreground')}>Match to bank statement</Label>
            <StatementLinePicker
              bankAccountId={bankAccountId || undefined}
              selected={statementLines}
              onToggle={(line) => {
                setStatementLines((prev) =>
                  prev.some((l) => l.id === line.id) ? prev.filter((l) => l.id !== line.id) : [...prev, line],
                )
              }}
              onClear={() => setStatementLines([])}
              query={statementQuery}
              onQueryChange={setStatementQuery}
            />
            {statementLines.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {statementLines.length} line{statementLines.length === 1 ? '' : 's'} selected · {formatCurrency(matched)}
              </p>
            )}
          </div>

          {/* Where this leaves the order. Three outcomes, and each one is a
              normal thing that happens — a part payment is not an error, and
              nor is an overpayment. */}
          {matched > 0 && (
            <div className="space-y-1 rounded-lg border border-foreground/15 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Received after this</span>
                <span className="font-semibold">{formatCurrency(receivedAfter)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Order value</span>
                <span>{formatCurrency(total)}</span>
              </div>
              {isPartPayment && (
                <p className="border-t border-foreground/10 pt-2 text-xs leading-tight text-blue-700 dark:text-blue-300">
                  This is a part payment. The order stays live for the remaining{' '}
                  {formatCurrency(shortfallAfter)}, and can be loaded up to the quantity this
                  payment covers.
                </p>
              )}
              {surplusAfter > 0 && (
                <p className="flex items-start gap-1.5 border-t border-foreground/10 pt-2 text-xs leading-tight text-muted-foreground">
                  <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {formatCurrency(surplusAfter)} more than this order is worth. It stays recorded
                    against <strong>{order.orderNumber}</strong> and shows there as surplus — move it
                    to another order from the finance report if that is where it belongs.
                  </span>
                </p>
              )}
              {!isPartPayment && surplusAfter === 0 && (
                <p className="border-t border-foreground/10 pt-2 text-xs text-muted-foreground">
                  Settles the order exactly.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirmPayment.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!readyToConfirm || confirmPayment.isPending}>
            {confirmPayment.isPending && <Loader2 className="animate-spin" />}
            {isPartPayment ? 'Confirm part payment' : 'Confirm payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
