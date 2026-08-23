import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ArrowRight } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { StatementLinePicker } from '#/components/StatementLinePicker'
import type { StatementLine } from '#/lib/hooks/useBankStatements'
import {
  useRematchOrderFunding, fundingDepositor, fundingPaidInto,
  type FinanceReportOrder,
} from '#/lib/hooks/useFinanceReport'
import { naira } from '#/routes/pfi/-pfi-utils'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Correct which bank statement line is recorded against a paid order.
 *
 * The case this exists for: the wrong line was matched, the order is already
 * paid, and a matched line could never be released — so the report named the
 * wrong payment for that order permanently, with no way back.
 *
 * The order stays paid and its wallet hold is untouched. What changes is
 * which deposit is recorded as having paid it, and the wallet balance moving
 * by the difference where the two amounts differ. The line being replaced
 * goes back to the unmatched pool, ready for the order it really belongs to.
 */
export function RematchFundingDialog({
  order, open, onOpenChange,
}: {
  order: FinanceReportOrder | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data: bankAccounts } = useBankAccounts({ status: 'Active' })
  const rematch = useRematchOrderFunding()

  const [bankAccountId, setBankAccountId] = useState('')
  const [lines, setLines] = useState<StatementLine[]>([])
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) { setBankAccountId(''); setLines([]); setQuery(''); setReason('') }
  }, [open])

  if (!order) return null

  const orderTotal = Number(order.totalAmount || 0)
  const currentTotal = order.funding.reduce((s, f) => s + Number(f.amount || 0), 0)
  const newTotal = lines.reduce((s, l) => s + Number(l.amount), 0)
  // The server refuses this outright — the reversal of the old payment would
  // take the balance negative. Said here first so it isn't a round trip.
  const tooSmall = lines.length > 0 && newTotal < currentTotal
  const canSubmit = !!bankAccountId && lines.length > 0 && !tooSmall

  const submit = async () => {
    if (!canSubmit) return
    try {
      await rematch.mutateAsync({
        orderId: order.id,
        bankAccountId,
        lineIds: lines.map((l) => l.id),
        description: reason.trim() || undefined,
      })
      onOpenChange(false)
    } catch {
      // The hook surfaces the server's own message as a toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Re-match payment — {order.reference}</DialogTitle>
          <DialogDescription>
            Point this order at the statement line that actually paid for it. The order
            stays paid; the line it's on now goes back to the unmatched pool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5 rounded-lg border border-foreground/15 bg-muted/30 p-3">
            <p className={cn(MICRO, 'text-muted-foreground')}>Recorded against this order now</p>
            {order.funding.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing tracked — this order predates payment tracking.
              </p>
            ) : (
              <ul className="space-y-1">
                {order.funding.map((f) => (
                  <li key={f.depositId} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {fundingDepositor(f) || 'Unnamed depositor'}
                      {f.depositReference ? ` · ${f.depositReference}` : ''}
                      {fundingPaidInto(f) ? ` · ${fundingPaidInto(f)}` : ''}
                    </span>
                    <span className="shrink-0 font-semibold">{naira(Number(f.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-foreground/10 pt-1.5 text-sm">
              <span className="text-muted-foreground">Order total</span>
              <span className="font-semibold">{naira(orderTotal)}</span>
            </div>
          </div>

          <div className="flex justify-center">
            <ArrowRight className="size-4 text-muted-foreground" />
          </div>

          <div className="space-y-1.5">
            <Label className={cn(MICRO, 'text-muted-foreground')}>Receiving bank account</Label>
            <Select value={bankAccountId} onValueChange={(v) => { setBankAccountId(v); setLines([]) }}>
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
            <Label className={cn(MICRO, 'text-muted-foreground')}>The statement line that really paid this</Label>
            <StatementLinePicker
              bankAccountId={bankAccountId || undefined}
              selected={lines}
              onToggle={(line) => {
                setLines((prev) =>
                  prev.some((l) => l.id === line.id) ? prev.filter((l) => l.id !== line.id) : [...prev, line],
                )
              }}
              onClear={() => setLines([])}
              query={query}
              onQueryChange={setQuery}
            />
            {lines.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {lines.length} line{lines.length === 1 ? '' : 's'} selected · {naira(newTotal)}
              </p>
            )}
          </div>

          {tooSmall && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                {naira(newTotal)} is less than the {naira(currentTotal)} being taken off this order.
                The difference is already committed elsewhere, so this would be refused — pick
                lines covering at least as much.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className={cn(MICRO, 'text-muted-foreground')}>Reason (optional)</Label>
            <Textarea
              rows={2}
              placeholder="e.g. the wrong line was matched when this was confirmed"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={rematch.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || rematch.isPending}>
            {rematch.isPending && <Loader2 className="animate-spin" />}
            Re-match payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
