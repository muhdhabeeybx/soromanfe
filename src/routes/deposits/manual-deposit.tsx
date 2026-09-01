import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Landmark, Receipt } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { MICRO, PANEL, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/deposits/manual-deposit')({
  beforeLoad: () => routeGuard('/deposits'),
  component: ManualDepositWithdrawn,
})

/**
 * Recording a deposit against a CUSTOMER — withdrawn.
 *
 * This page claimed bank statement lines and credited them to a customer's
 * wallet, with an order id as an optional afterthought. It is the front door
 * to the model the finance desk asked to be rid of: money arriving against a
 * person rather than against the order it was sent to pay for.
 *
 * Leaving it open would defeat the rest of the change. A statement line
 * consumed here disappears into a balance, and the only way it could then
 * reach an order was by being drawn on — the automatic draw that made the
 * report impossible to audit. Closing it is what makes the guarantee hold:
 * every statement line either sits unmatched in the pool, or is recorded
 * against exactly one order.
 *
 * The server refuses the request too (410), so this is not the only guard —
 * it is the one that explains itself. See Sman-Backend/db/migrations/0021.
 */
function ManualDepositWithdrawn() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record a deposit"
        description="Payments are now recorded against the order they paid for."
      />

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>Where this went</span>
        </div>
        <div className={cn(PANEL_BODY, 'space-y-4')}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Deposits are no longer recorded against a customer. A payment now belongs to the
            <strong className="text-foreground"> order </strong>
            it was sent to pay for, matched to the bank statement line that carries it — so the
            finance report can be checked against a statement one line at a time, and nothing is
            ever drawn from a wallet to make an order look settled.
          </p>

          <div className="space-y-3 rounded-lg border border-foreground/15 bg-muted/30 p-4 text-sm">
            <p className={cn(MICRO, 'text-muted-foreground')}>To record a payment</p>
            <ol className="ml-4 list-decimal space-y-1.5 text-muted-foreground">
              <li>Upload the bank statement, if today&apos;s is not in yet.</li>
              <li>Open the order the money was sent for, on Payable Orders.</li>
              <li>
                Choose <strong className="text-foreground">Confirm payment</strong> and pick the
                statement line(s) that paid for it.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              A payment larger than the order stays on that order as surplus. Move it to another
              order from the finance report — it is recorded as a transfer, with both ends showing
              the movement.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate({ to: '/payable-orders' as any })}>
              <Receipt data-icon="inline-start" />
              Go to Payable Orders
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/bank-statements' as any })}>
              <Landmark data-icon="inline-start" />
              Upload a bank statement
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
