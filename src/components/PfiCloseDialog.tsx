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

  const submit = async () => {
    if (!pfi) return
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
      },
    })
    onOpenChange(false)
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
