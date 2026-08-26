import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle, Hourglass, Wallet } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { NumberInput } from '#/components/ui/number-input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { useCustomerDetails } from '#/lib/hooks/useCustomers'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { useCreateDeposit } from '#/lib/hooks/useDeposits'
import { usePayOrder } from '#/lib/hooks/useOrders'
import { useExpectedPayments } from '#/lib/hooks/useExpectedPayments'
import { StatementLinePicker } from '#/components/StatementLinePicker'
import type { StatementLine } from '#/lib/hooks/useBankStatements'
import { MICRO } from '#/lib/panel'
import { cn, toNum } from '#/lib/utils'

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(v)
}

/**
 * Confirm payment on one specific pending order — the point this whole flow
 * exists for.
 *
 * The statement match comes first and is what the order is recorded as being
 * paid by: the lines picked here are tagged with this order's id (see
 * createDeposit's orderId), and the server now allocates those exact deposits
 * to this order, at their face value, before it will touch wallet balance for
 * anything. That tag was already being written; it was simply never read
 * back, so the funding trail was assembled afterwards by walking the wallet
 * oldest-credit-first and an order confirmed against one ₦18m credit was
 * written up as slices of three unrelated ones.
 *
 * Wallet balance is drawn on only for a shortfall, only for the amount asked
 * for below, and the report shows what it drew on by name. Anything matched
 * beyond what the order needs stays in the customer's wallet, and shows on
 * the finance report as an overpayment against this order rather than being
 * quietly trimmed to fit.
 *
 * Statement only, deliberately — no manual-amount fallback. A line's bank
 * reference is what makes it trustworthy; typing a figure by hand has none
 * of that, and StatementLinePicker only ever offers UNMATCHED lines, so a
 * line already claimed by another payment can't be picked twice — claiming
 * it flips its status server-side in the same transaction, and it drops out
 * of the picker's search from that moment on.
 */
export function ConfirmOrderPaymentDialog({
  order, open, onOpenChange,
}: {
  order: any | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const customerId = order?.customerId ? String(order.customerId) : ''
  const { data: customer, isLoading: loadingCustomer } = useCustomerDetails(open ? customerId : '')
  const { data: bankAccounts } = useBankAccounts({ status: 'Active' })
  // What the customer said they'd pay, captured on the order wizard — the
  // amounts and company names to look for in the statement.
  const { data: expected = [] } = useExpectedPayments(
    open && order?.id ? { orderId: order.id, status: 'pending' } : undefined,
  )
  const createDeposit = useCreateDeposit()
  const payOrder = usePayOrder()

  const [bankAccountId, setBankAccountId] = useState('')
  const [statementLines, setStatementLines] = useState<StatementLine[]>([])
  const [statementQuery, setStatementQuery] = useState('')
  /** How much of the balance already in the wallet to put toward this order. */
  const [walletAmount, setWalletAmount] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) {
      setBankAccountId(''); setStatementLines([]); setStatementQuery('')
      setWalletAmount(''); setConfirming(false)
    }
  }, [open])

  if (!order) return null

  const total = toNum(order.totalAmount)
  // Prefer the live customer read over whatever balance was embedded in the
  // orders list — that snapshot goes stale the moment another order for the
  // same customer is confirmed in this same session.
  const liveBalance = customer ? toNum(customer.balance) : toNum(order.customerBalance)
  const newDeposit = statementLines.reduce((s, l) => s + Number(l.amount), 0)

  // Wallet balance is applied only when someone says how much of it to use.
  // It used to be taken automatically for the whole shortfall, which made a
  // fully-covered order a one-click confirm with no statement behind it —
  // and no way afterwards to say what had actually paid for it.
  const walletApplied = Math.min(Number(walletAmount || 0), liveBalance)
  const walletOverBalance = Number(walletAmount || 0) > liveBalance
  const available = walletApplied + newDeposit
  const stillShort = Math.max(0, total - available)
  const excess = Math.max(0, available - total)
  const readyToConfirm = stillShort <= 0 && !walletOverBalance

  const handleConfirm = async () => {
    if (!readyToConfirm) return
    setConfirming(true)
    try {
      if (newDeposit > 0) {
        await createDeposit.mutateAsync({
          customer: order.customerId,
          bankAccountId,
          lineIds: statementLines.map((l) => l.id),
          orderId: order.id,
        })
        // The deposit already landed — clear the selection so a retry below
        // (if paying fails) falls back to the now-updated wallet balance
        // instead of trying to re-claim lines that are already matched.
        setStatementLines([])
      }
      await payOrder.mutateAsync(order.id)
      onOpenChange(false)
    } catch {
      // Both mutations surface their own error toast. If the deposit
      // succeeded but paying failed, the money is safely in the wallet —
      // the dialog stays open (now showing no shortfall) so staff can just
      // hit Confirm again.
    } finally {
      setConfirming(false)
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
            </div>
            <div>
              <p className={cn(MICRO, 'text-muted-foreground')}>Wallet balance</p>
              <p className="mt-0.5 font-semibold">
                {loadingCustomer ? <Loader2 className="size-3.5 animate-spin" /> : formatCurrency(liveBalance)}
              </p>
            </div>
            <div>
              <p className={cn(MICRO, 'text-muted-foreground')}>{stillShort > 0 ? 'Still needed' : 'Spare after this'}</p>
              <p className={cn('mt-0.5 font-semibold', stillShort > 0 ? 'text-warning' : 'text-success')}>
                {formatCurrency(stillShort > 0 ? stillShort : excess)}
              </p>
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

          {/* One flow, always: match the statement, and say explicitly how
              much of any existing wallet balance to put toward this order.
              A covered order is not a one-click confirm — that left no
              record of what had actually paid for it. */}
          <>
              {stillShort > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>
                    {formatCurrency(stillShort)} still to account for — match a statement line
                    below, or draw more from the wallet balance.
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
                    {statementLines.length} line{statementLines.length === 1 ? '' : 's'} selected · {formatCurrency(newDeposit)}
                  </p>
                )}
              </div>

              {/* Existing balance is only ever used if someone asks for it,
                  and for the amount they ask for. Whatever is drawn stays
                  traceable: the report's funding rows follow each deposit
                  the wallet drew on back to the statement line it came
                  from, so "from wallet" still names an original payment. */}
              {liveBalance > 0 && (
                <div className="space-y-1.5 rounded-lg border border-foreground/15 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label className={cn(MICRO, 'flex items-center gap-1.5 text-muted-foreground')}>
                      <Wallet className="size-3.5" />
                      Draw from wallet balance
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(liveBalance)} available
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      allowDecimal
                      placeholder="0"
                      className="text-right"
                      value={walletAmount}
                      onValueChange={setWalletAmount}
                      aria-invalid={walletOverBalance || undefined}
                    />
                    <Button
                      type="button" variant="outline" size="sm" className="shrink-0"
                      onClick={() => setWalletAmount(String(Math.min(liveBalance, Math.max(0, total - newDeposit))))}
                    >
                      Use what's needed
                    </Button>
                  </div>
                  {walletOverBalance && (
                    <p className="text-xs text-destructive">
                      That is more than the {formatCurrency(liveBalance)} in the wallet.
                    </p>
                  )}
                </div>
              )}

              {/* How the order's total is actually being met. */}
              {(newDeposit > 0 || walletApplied > 0) && (
                <div className="space-y-1 rounded-lg border border-foreground/15 p-3 text-sm">
                  {newDeposit > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">From this statement match</span>
                      <span className="font-semibold">{formatCurrency(newDeposit)}</span>
                    </div>
                  )}
                  {walletApplied > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Wallet className="size-3.5" />
                        From wallet balance
                      </span>
                      <span className="font-semibold">{formatCurrency(walletApplied)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 border-t border-foreground/10 pt-1">
                    <span className="font-semibold">Order total</span>
                    <span className="font-semibold">{formatCurrency(total)}</span>
                  </div>
                </div>
              )}

              {(newDeposit > 0 || walletApplied > 0) && stillShort <= 0 && (
                <p className="text-xs leading-tight text-muted-foreground">
                  {excess > 0
                    ? `Covers the order with ${formatCurrency(excess)} left over — that stays in ${order.customerName || 'the customer'}'s wallet, under the reference it came in on, and shows on the finance report as an overpayment against this order.`
                    : 'Covers the order exactly.'}
                </p>
              )}
          </>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!readyToConfirm || confirming}>
            {confirming && <Loader2 className="animate-spin" />}
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
