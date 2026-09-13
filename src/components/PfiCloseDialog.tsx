import { useState } from 'react'
import { format } from 'date-fns'
import { Loader2, TriangleAlert } from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useFinishPfi, type PfiWithFinancials } from '#/lib/hooks/usePfis'

/** What the server hands back when it refuses the first close. */
interface Outstanding {
  unticketed: Array<{ id: number; orderNumber: string; customerName: string | null; shortBy: number }>
  trucksDue: Array<{ id: number; truckNumber: string | null; orderNumber: string }>
  trucksIn: Array<{ id: number; truckNumber: string | null; orderNumber: string }>
  unticketedLitres: number
  clean: boolean
}
import { naira, qty } from '#/routes/pfi/-pfi-utils'

function Field({
  label, value, onChange, type = 'text', hint, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: React.ReactNode
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className={cn(MICRO, 'block text-muted-foreground')}>{label}</label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs leading-tight text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

export function PfiCloseDialog({
  pfi, open, onOpenChange,
}: {
  pfi: PfiWithFinancials | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const finish = useFinishPfi()
  const [form, setForm] = useState({
    closureDate: format(new Date(), 'yyyy-MM-dd'),
    totalInflow: '',
    closureBank: '',
    purchaseCost: '',
    aggregateExpenses: '',
    closureHandler: '',
    closureRemarks: '',
  })

  // Re-seed when a different PFI is opened.
  const key = pfi?.id ?? 'none'
  const [seeded, setSeeded] = useState(key)
  if (seeded !== key) {
    setSeeded(key)
    setForm({
      closureDate: format(new Date(), 'yyyy-MM-dd'),
      totalInflow: '',
      closureBank: '',
      // Prefilled from what the system computed, so the typed figures start in
      // agreement rather than being invented from scratch.
      purchaseCost: pfi?.financials.pfiValue != null ? String(pfi.financials.pfiValue) : '',
      aggregateExpenses: pfi ? String(pfi.financials.totalExpenses) : '',
      closureHandler: '',
      closureRemarks: '',
    })
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  /**
   * What is still moving on this batch, refused once before it can be buried.
   *
   * The server answers the first close with 409 and the list. Holding it here
   * turns that into something readable — which orders were never ticketed and
   * which trucks never reached the gate — and the second press carries
   * `acknowledgeOutstanding`, so nobody closes a batch without having been
   * shown what they are closing over.
   */
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null)

  const submit = async () => {
    if (!pfi) return
    try {
      await finish.mutateAsync({
        id: Number(pfi.id),
        data: {
          closure_date: form.closureDate,
          total_inflow: form.totalInflow,
          closure_bank: form.closureBank,
          purchase_cost: form.purchaseCost,
          aggregate_expenses: form.aggregateExpenses,
          closure_handler: form.closureHandler,
          closure_remarks: form.closureRemarks,
          // Only on the second press, once the list below has been shown.
          ...(outstanding ? { acknowledgeOutstanding: true } : {}),
        },
      })
      onOpenChange(false)
      setOutstanding(null)
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.code === 'OUTSTANDING_WORK') {
        setOutstanding(err.response.data.data.outstanding)
        return
      }
      // Anything else already raised its own toast through useMoneyMutation.
    }
  }

  const f = pfi?.financials
  const stockLeft = f && f.remaining > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close {pfi?.pfiNumber}</DialogTitle>
          <DialogDescription>
            Closing marks the batch finished. It can no longer take order assignments.
          </DialogDescription>
        </DialogHeader>

        {/* Closing with stock on the books is the single most common way a
            reported loss turns out to be wrong. Say so before they sign it. */}
        {stockLeft && f && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-sm text-muted-foreground">
              <span className="font-normal text-foreground">{qty(f.remaining, pfi?.productUnit)}</span> still shows as
              remaining ({Math.round((f.sellThrough ?? 0) * 100)}% sold). Either that stock is genuinely
              unsold, or movements were never recorded against it. Worth checking before closing.
            </p>
          </div>
        )}

        {/*
          The work still on the batch, shown after the first press.

          Three lists rather than one count, because they need three different
          people: the loading desk generates the missing tickets, security
          gates the waiting trucks in, security gates the yard's trucks out.
          Closing over them is allowed — the desk knows things the system does
          not — but not without having read them.
        */}
        {outstanding && (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              This batch still has work on it. Closing now buries it.
            </p>

            {outstanding.unticketed.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  {outstanding.unticketed.length} order{outstanding.unticketed.length === 1 ? '' : 's'} never
                  ticketed — {outstanding.unticketedLitres.toLocaleString()} litres
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {outstanding.unticketed.slice(0, 6).map((o) => (
                    <li key={o.id}>
                      <span className="font-mono">{o.orderNumber}</span> · {o.customerName || '—'} ·
                      {' '}short {o.shortBy.toLocaleString()} litres
                    </li>
                  ))}
                  {outstanding.unticketed.length > 6 && (
                    <li>and {outstanding.unticketed.length - 6} more</li>
                  )}
                </ul>
                <p className="text-xs text-muted-foreground/80">Generate their tickets first.</p>
              </div>
            )}

            {outstanding.trucksDue.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  {outstanding.trucksDue.length} truck{outstanding.trucksDue.length === 1 ? '' : 's'} ticketed but never gated in
                </p>
                <p className="text-xs text-muted-foreground">
                  {outstanding.trucksDue.slice(0, 6).map((t) => t.truckNumber || '—').join(', ')}
                  {outstanding.trucksDue.length > 6 && ` and ${outstanding.trucksDue.length - 6} more`}
                </p>
              </div>
            )}

            {outstanding.trucksIn.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  {outstanding.trucksIn.length} truck{outstanding.trucksIn.length === 1 ? '' : 's'} still on the yard — never gated out
                </p>
                <p className="text-xs text-muted-foreground">
                  {outstanding.trucksIn.slice(0, 6).map((t) => `${t.truckNumber || '—'} (${t.orderNumber})`).join(', ')}
                  {outstanding.trucksIn.length > 6 && ` and ${outstanding.trucksIn.length - 6} more`}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Press Close again to close the batch anyway.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Closure date" type="date" value={form.closureDate} onChange={(v) => set('closureDate', v)} />
          <Field label="Closure bank" value={form.closureBank} onChange={(v) => set('closureBank', v)} />
          <Field
            label="Total inflow" type="number" value={form.totalInflow}
            onChange={(v) => set('totalInflow', v)} placeholder="0.00"
          />
          <Field label="Handler" value={form.closureHandler} onChange={(v) => set('closureHandler', v)} />
          <Field
            label="Purchase cost" type="number" value={form.purchaseCost}
            onChange={(v) => set('purchaseCost', v)}
            hint={<>System computes <span className="font-normal">{naira(f?.pfiValue)}</span></>}
          />
          <Field
            label="Aggregate expenses" type="number" value={form.aggregateExpenses}
            onChange={(v) => set('aggregateExpenses', v)}
            hint={<>System computes <span className="font-normal">{naira(f?.totalExpenses)}</span></>}
          />
          <div className="space-y-1.5 sm:col-span-2">
            <label className={cn(MICRO, 'block text-muted-foreground')}>Remarks</label>
            <Textarea
              rows={2} value={form.closureRemarks}
              onChange={(e) => set('closureRemarks', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={finish.isPending}>
            {finish.isPending && <Loader2 className="animate-spin" />}
            Close PFI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
