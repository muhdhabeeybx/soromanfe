import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ArrowRightLeft, Trash2, Landmark, FileWarning, ShieldCheck } from 'lucide-react'
import { format } from 'date-fns'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { NumberInput } from '#/components/ui/number-input'
import {
  useOrderPayments, useRemoveOrderPayment, useTransferOrderSurplus,
  useReviewOrderPayment, useReviewOrderTransfer,
  CONFIRMATION_BASIS_LABEL, isSystemDecided,
  paymentRecorder, paymentPayer, paymentPaidInto, transferOrigin, isTransferLeg, isUnreconciled,
  type FinanceReportOrder, type OrderPayment,
} from '#/lib/hooks/useFinanceReport'
import { naira } from '#/routes/pfi/-pfi-utils'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Everything recorded against one order's payment, and the two corrections a
 * finance desk needs.
 *
 * This replaced RematchFundingDialog, which did one thing: swap which wallet
 * deposit was recorded as having paid for an order. That operation had to
 * exist because a matched statement line could never be released, so a
 * mis-match was permanent — and it worked by crediting a replacement, then
 * reversing the mistake, with the ordering load-bearing on a wallet balance
 * guard.
 *
 * Both corrections are now plain, and neither touches a balance:
 *
 *   Remove   the payment row goes and its statement line returns to the
 *            unmatched pool, ready to be recorded against the order it really
 *            belongs to. (Re-matching is: remove here, then confirm there.)
 *   Move     surplus goes from this order to another, as two recorded legs
 *            with a reason attached — replacing a wallet transfer whose only
 *            record of the destination was a sentence typed in a description.
 */
export function OrderPaymentsDialog({
  order, open, onOpenChange,
}: {
  order: FinanceReportOrder | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data, isLoading } = useOrderPayments(open && order ? order.id : null)
  const removePayment = useRemoveOrderPayment()
  const reviewPayment = useReviewOrderPayment()
  const reviewTransfer = useReviewOrderTransfer()
  /** The system-made attribution currently being vouched for, and the reason. */
  const [reviewing, setReviewing] = useState<OrderPayment | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const transfer = useTransferOrderSurplus()

  const [removing, setRemoving] = useState<OrderPayment | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)
  const [toOrderRef, setToOrderRef] = useState('')
  const [moveAmount, setMoveAmount] = useState('')
  const [moveReason, setMoveReason] = useState('')

  useEffect(() => {
    if (!open) {
      setRemoving(null); setRemoveReason('')
      setMoveOpen(false); setToOrderRef(''); setMoveAmount(''); setMoveReason('')
    }
  }, [open])

  if (!order) return null

  const summary = data?.summary
  const payments = data?.payments || []
  const surplus = summary?.surplus ?? order.surplus
  const shortfall = summary?.shortfall ?? order.shortfall

  // The destination is given as an order id. A reference would be friendlier,
  // but resolving one to an id client-side means guessing at a lookup the
  // server has not been asked for — and putting money on the wrong order
  // because a reference was ambiguous is exactly the class of mistake this
  // whole change exists to stop.
  const toOrderId = Number(toOrderRef)
  const amount = Number(moveAmount || 0)
  const canMove =
    Number.isFinite(toOrderId) && toOrderId > 0 && toOrderId !== order.id &&
    amount > 0 && amount <= surplus + 0.005 && moveReason.trim().length >= 3

  const handleRemove = async () => {
    if (!removing || removeReason.trim().length < 3) return
    try {
      await removePayment.mutateAsync({
        orderId: order.id,
        paymentId: removing.id,
        reason: removeReason.trim(),
      })
      setRemoving(null); setRemoveReason('')
    } catch { /* the mutation raises its own toast */ }
  }

  const handleMove = async () => {
    if (!canMove) return
    try {
      await transfer.mutateAsync({
        fromOrderId: order.id,
        toOrderId,
        amount,
        reason: moveReason.trim(),
      })
      setMoveOpen(false); setToOrderRef(''); setMoveAmount(''); setMoveReason('')
    } catch { /* the mutation raises its own toast */ }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payments on {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {order.customerName}
            {order.companyName ? ` · ${order.companyName}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-foreground/15 bg-muted/30 p-3 text-sm">
              <div>
                <p className={cn(MICRO, 'text-muted-foreground')}>Order value</p>
                <p className="mt-0.5 font-semibold">{naira(Number(order.totalAmount))}</p>
              </div>
              <div>
                <p className={cn(MICRO, 'text-muted-foreground')}>Received</p>
                <p className="mt-0.5 font-semibold">{naira(summary?.received ?? order.received)}</p>
              </div>
              <div>
                <p className={cn(MICRO, 'text-muted-foreground')}>Surplus</p>
                <p className={cn('mt-0.5 font-semibold', surplus > 0 && 'text-warning')}>
                  {naira(surplus)}
                </p>
              </div>
              <div>
                <p className={cn(MICRO, 'text-muted-foreground')}>Still owed</p>
                <p className={cn('mt-0.5 font-semibold', (summary?.shortfall ?? order.shortfall) > 0 && 'text-destructive')}>
                  {naira(summary?.shortfall ?? order.shortfall)}
                </p>
              </div>
            </div>

            {/* The rows, each one a thing an auditor can go and find. */}
            <div className="space-y-2">
              {payments.length === 0 && (
                <p className="rounded-lg border border-foreground/15 p-4 text-center text-sm text-muted-foreground">
                  Nothing recorded against this order yet.
                </p>
              )}
              {payments.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    isTransferLeg(p) ? 'border-info/30 bg-info/5' :
                      isUnreconciled(p) ? 'border-warning/30 bg-warning/5' : 'border-foreground/15',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium">
                        {isTransferLeg(p) ? <ArrowRightLeft className="size-3.5 shrink-0" />
                          : isUnreconciled(p) ? <FileWarning className="size-3.5 shrink-0" />
                            : <Landmark className="size-3.5 shrink-0" />}
                        <span className="truncate">{paymentPayer(p) || '—'}</span>
                      </p>
                      {/* No bank reference is invented for a legacy row: the
                          absence of evidence is the fact worth showing. */}
                      <p className={cn(MICRO, 'mt-1 text-muted-foreground')}>
                        {isUnreconciled(p)
                          ? 'No bank record — confirmed before payments were tracked'
                          : isTransferLeg(p)
                            // Which money this is, not just that money moved.
                            ? [
                                transferOrigin(p) || null,
                                p.createdAt ? `moved ${format(new Date(p.createdAt), 'd MMM yyyy')}` : null,
                              ].filter(Boolean).join(' · ')
                            : [
                                p.bankRef,
                                p.txnDate ? format(new Date(p.txnDate), 'd MMM yyyy') : null,
                                paymentPaidInto(p) || null,
                              ].filter(Boolean).join(' · ')}
                      </p>
                      {p.transferReason && (
                        <p className="mt-1 text-xs italic text-muted-foreground">{p.transferReason}</p>
                      )}
                      {paymentRecorder(p) && (
                        <p className={cn(MICRO, 'mt-1 text-muted-foreground')}>
                          Recorded by {paymentRecorder(p)}
                        </p>
                      )}
                      {/*
                        How this payment came to be here, and — separately —
                        whether anybody has since stood behind it. Two facts,
                        shown as two lines, because collapsing them into one is
                        exactly what made a movement nobody made look like a
                        deliberate act by a named person.
                      */}
                      <p className={cn(
                        MICRO, 'mt-1',
                        isSystemDecided(p.confirmationBasis) && !p.reviewedAt
                          ? 'text-warning' : 'text-muted-foreground',
                      )}>
                        {CONFIRMATION_BASIS_LABEL[p.confirmationBasis] ?? 'Unknown'}
                      </p>
                      {p.reviewedAt && (
                        <p className={cn(MICRO, 'mt-1 text-success')}>
                          Vouched for by {[p.reviewerFirstName, p.reviewerSurname].filter(Boolean).join(' ') || 'staff'}
                          {` on ${format(new Date(p.reviewedAt), 'd MMM yyyy')}`}
                          {p.reviewNote ? ` — ${p.reviewNote}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={cn('font-semibold tabular-nums', p.amount < 0 && 'text-info')}>
                        {naira(p.amount)}
                      </span>
                      {/*
                        Vouching for a system-made attribution. Offered instead
                        of removal on these rows because removal is not
                        available in practice — none of them can be undone
                        without dropping an already-ticketed order below its
                        own value. What is missing is a name, not a correction.
                      */}
                      {isSystemDecided(p.confirmationBasis) && !p.reviewedAt && (
                        <Button
                          type="button" variant="ghost" size="icon"
                          aria-label="Vouch for this attribution"
                          title="Vouch for this attribution"
                          onClick={() => { setReviewing(p); setReviewNote('') }}
                        >
                          <ShieldCheck className="size-4" />
                        </Button>
                      )}
                      {/* A transfer leg has no standalone remove: the two legs
                          must move together or not at all. */}
                      {!isTransferLeg(p) && (
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Unmatch this payment"
                          title={p.statementLineId
                            ? 'Unmatch — returns the bank line to the pool'
                            : 'Remove this payment'}
                          onClick={() => { setRemoving(p); setRemoveReason('') }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Vouching for a system-made attribution. Inline for the same
                reason as removal below: the row it refers to stays visible. */}
            {reviewing && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="flex items-start gap-2 text-sm">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>
                    {isTransferLeg(reviewing)
                      ? `This movement of ${naira(Math.abs(reviewing.amount))} was created by the system, not by anyone. Vouching for it records that you have checked it — both legs together. No money moves.`
                      : `${naira(reviewing.amount)} was attached to this order by the system, not by anyone. Vouching for it records that you have checked it. No money moves.`}
                  </span>
                </p>
                <Label className={cn(MICRO, 'text-muted-foreground')}>
                  Why is this correct? (required — this is the record)
                </Label>
                <Input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Customer confirmed by phone; payment was for this order"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setReviewing(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={reviewNote.trim().length < 3 || reviewPayment.isPending || reviewTransfer.isPending}
                    onClick={async () => {
                      try {
                        if (isTransferLeg(reviewing) && reviewing.transferId) {
                          await reviewTransfer.mutateAsync({
                            orderId: order.id, transferId: reviewing.transferId, note: reviewNote.trim(),
                          })
                        } else {
                          await reviewPayment.mutateAsync({
                            orderId: order.id, paymentId: reviewing.id, note: reviewNote.trim(),
                          })
                        }
                        setReviewing(null)
                      } catch {
                        // The mutation raises its own toast; the panel stays
                        // open with the reason intact so it can be retried.
                      }
                    }}
                  >
                    {(reviewPayment.isPending || reviewTransfer.isPending) && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Vouch for this
                  </Button>
                </div>
              </div>
            )}

            {/* Removing one payment. Kept inline rather than in a second
                dialog so the row it refers to stays on screen behind it. */}
            {removing && (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Remove {naira(removing.amount)} from this order?
                    {removing.statementLineId
                      ? ' Its bank statement line goes back to the unmatched pool, so it can be recorded against the right order.'
                      : ' There is no statement line behind this one to release.'}
                  </span>
                </p>
                <Label className={cn(MICRO, 'text-muted-foreground')}>Why (required)</Label>
                <Input
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  placeholder="Matched to the wrong order"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>Cancel</Button>
                  <Button
                    variant="destructive" size="sm"
                    disabled={removeReason.trim().length < 3 || removePayment.isPending}
                    onClick={handleRemove}
                  >
                    {removePayment.isPending && <Loader2 className="animate-spin" />}
                    Remove payment
                  </Button>
                </div>
              </div>
            )}

            {/*
              What can be done to this order's money, stated rather than left
              to be discovered. Each action says why it is unavailable when it
              is, because "the button is missing" and "the button is disabled
              for this reason" are very different experiences for somebody
              trying to correct a mistake in a hurry.
            */}
            <div className="space-y-2 rounded-lg border border-foreground/15 bg-muted/20 p-3">
              <p className={cn(MICRO, 'text-muted-foreground')}>Corrections</p>

              <p className="text-xs text-muted-foreground">
                <Trash2 className="mr-1 inline size-3 text-destructive" />
                Matched to the wrong order? Use the red bin on the payment above — its
                bank line goes back to the pool, then confirm it against the right order.
              </p>

              {/* Moving surplus. Offered only when there is surplus to move —
                  an order cannot give away money it needs for its own value,
                  and the server refuses it outright if asked. */}
              {surplus > 0 && !moveOpen ? (
                <Button variant="outline" className="w-full" onClick={() => setMoveOpen(true)}>
                  <ArrowRightLeft className="size-4" />
                  Move {naira(surplus)} surplus to another order
                </Button>
              ) : !moveOpen && (
                <p className="text-xs text-muted-foreground">
                  <ArrowRightLeft className="mr-1 inline size-3" />
                  No surplus to move — this order holds nothing beyond its own value.
                </p>
              )}

              {shortfall > 0 && (
                <p className="text-xs text-destructive">
                  <AlertTriangle className="mr-1 inline size-3" />
                  {naira(shortfall)} still owed. Confirm the bank line that covers it from
                  the order's own Add payment action.
                </p>
              )}
            </div>

            {moveOpen && (
              <div className="space-y-3 rounded-lg border border-foreground/15 p-3">
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  Moving surplus off {order.orderNumber}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className={cn(MICRO, 'text-muted-foreground')}>Destination order id</Label>
                    <NumberInput value={toOrderRef} onValueChange={setToOrderRef} placeholder="e.g. 11597" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className={cn(MICRO, 'text-muted-foreground')}>Amount</Label>
                    <div className="flex gap-2">
                      <NumberInput allowDecimal value={moveAmount} onValueChange={setMoveAmount} placeholder="0" className="text-right" />
                      <Button
                        type="button" variant="outline" size="sm" className="shrink-0"
                        onClick={() => setMoveAmount(String(surplus))}
                      >
                        All
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className={cn(MICRO, 'text-muted-foreground')}>Why (required)</Label>
                  <Textarea
                    rows={2}
                    value={moveReason}
                    onChange={(e) => setMoveReason(e.target.value)}
                    placeholder="Customer asked for the balance to go on their next load"
                  />
                </div>
                {amount > surplus + 0.005 && (
                  <p className="text-xs text-destructive">
                    This order only holds {naira(surplus)} of surplus.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMoveOpen(false)}>Cancel</Button>
                  <Button size="sm" disabled={!canMove || transfer.isPending} onClick={handleMove}>
                    {transfer.isPending && <Loader2 className="animate-spin" />}
                    Move surplus
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
