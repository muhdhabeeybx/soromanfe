import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { useDepotsForFilter } from '#/lib/hooks/usePfis'
import { useCreateDeliveryBatch } from '#/lib/hooks/useDeliveryInventory'
import { useProductList } from '#/lib/hooks/useProducts'
import {
  TruckPicker, useFleetPicks, truckSelectionSummary, type TruckSelection,
} from '#/components/delivery-operations/TruckPicker'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Everything a delivery batch is, on one form.
 *
 * ── A batch is a code ─────────────────────────────────────────────────────
 *
 * Write the code off the loading papers, say where and when it loaded and
 * what it is, tick the trucks that carried it, done. This form used to raise
 * a PFI instead — a cargo record with an allowlist of depots and a manifest
 * hung off its id — and offered a second tab for adding trucks to a PFI
 * raised elsewhere. None of that is the job. A batch has no existence apart
 * from the loads recorded under its code, so the code is all that is asked
 * for, and typing one that already exists simply adds these trucks to it.
 *
 * The loads go straight onto the inventory table and into the sales ledger,
 * where each one sits unpaid until somebody enters a payment against it.
 *
 * ── Loaded, not capacity ──────────────────────────────────────────────────
 *
 * Ticking a truck seeds its loaded quantity from its rated capacity, because
 * that is the closest thing to a right answer and most loads are near it. It
 * is an editable field, not a value read off the fleet record: the old
 * allocation screen wrote capacity straight through, so a truck rated 50,000
 * that took 47,300 went into the books as 50,000 and the batch overstated
 * itself on every truck that loaded short.
 */

interface NewBatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Codes already on the table, so typing one again can say what it means. */
  existingCodes?: string[]
}

const today = () => new Date().toISOString().slice(0, 10)

export function NewBatchDialog({ open, onOpenChange, existingCodes = [] }: NewBatchDialogProps) {
  const navigate = useNavigate()

  const { data: depots = [] } = useDepotsForFilter()
  const { data: productData } = useProductList()

  const createBatch = useCreateDeliveryBatch()

  // useProductList answers `res.data.data`, which is the envelope on some
  // deployments and the bare array on others.
  const products = useMemo(() => {
    const list = productData?.products ?? productData ?? []
    return (Array.isArray(list) ? list : []) as Array<{ id?: number | string; _id?: string; name: string }>
  }, [productData])

  const fleet = useFleetPicks()

  // ── Form ────────────────────────────────────────────────────────────────
  const [code, setCode] = useState('')
  const [depotId, setDepotId] = useState('')
  const [productId, setProductId] = useState('')
  const [date, setDate] = useState(today())
  const [truckSelection, setTruckSelection] = useState<TruckSelection>({})

  const reset = () => {
    setCode(''); setDepotId(''); setProductId(''); setDate(today()); setTruckSelection({})
  }

  const close = () => { onOpenChange(false); reset() }

  // The rows hold text, not ids — so the names are what gets written.
  const depotName = depots.find((d) => String(d.id ?? d._id) === depotId)?.name || ''
  const productName = products.find((p) => String(p.id ?? p._id) === productId)?.name || ''

  // Ticking, searching, per-truck quantities and their totals all live in
  // TruckPicker — the same component the PFI form uses, so the two cannot
  // drift into asking for trucks differently.
  const trucks = truckSelectionSummary(truckSelection, fleet)

  // ── What stops a save ───────────────────────────────────────────────────
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '-')
  /**
   * A code already on the table is not an error.
   *
   * A second load under the same code is ordinary — a batch goes out over
   * days — and there is nothing to collide with, since the code is the only
   * thing holding these rows together. It is still worth saying out loud, so
   * a typo does not silently join somebody else's batch.
   */
  const addingToExisting = normalizedCode.length > 0
    && existingCodes.some((c) => c.trim().toUpperCase() === normalizedCode)

  const problem =
    !normalizedCode ? 'Give the batch a code'
    : !depotId ? 'Say where it loaded'
    : !productId ? 'Say what it is'
    // Every complaint about the selection itself — none picked, one with no
    // quantity, one loaded past capacity — comes from the picker.
    : trucks.problem

  const submit = async () => {
    if (problem) return
    try {
      const { code: saved } = await createBatch.mutateAsync({
        code: normalizedCode,
        depotName,
        productName,
        dateAllocated: date,
        trucks: trucks.trucks.map((t) => ({
          truckId: t.truckId,
          plateNumber: t.plateNumber,
          loadedQty: t.loadedQty,
        })),
      })
      close()
      navigate({ to: '/delivery-operations/allocation-details', search: { code: saved } })
    } catch {
      // The hook has already said what went wrong, and nothing landed — the
      // form stays open with the selection intact so it can be tried again.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New batch</DialogTitle>
          <DialogDescription>
            The code off the loading papers, where and when it loaded, and the trucks that
            carried it. Each truck goes onto the ledger unpaid until you enter its payment.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 max-h-[65vh] space-y-5 overflow-y-auto px-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="batch-code">Batch code</Label>
              <Input
                id="batch-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="PFI-25C"
              />
              <p className={cn(MICRO, addingToExisting ? 'text-warning' : 'text-muted-foreground')}>
                {addingToExisting
                  ? `${normalizedCode} already exists — these trucks join it.`
                  : 'The batch appears under this code everywhere.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-depot">Loaded at</Label>
              <NativeSelect id="batch-depot" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value="">Select the depot it loaded at…</option>
                {depots.map((d) => (
                  <option key={String(d.id ?? d._id)} value={String(d.id ?? d._id)}>{d.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-product">Product</Label>
              <NativeSelect id="batch-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={String(p.id ?? p._id)} value={String(p.id ?? p._id)}>{p.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-date">Date loaded</Label>
              <Input id="batch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {/* ── The trucks ──────────────────────────────────────────────── */}
          <TruckPicker
            fleet={fleet}
            value={truckSelection}
            onChange={setTruckSelection}
          />
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          {/* One reason at a time, next to the button it disables — a form
              this tall hides the problem if it is only ever an inline error
              somewhere above the fold. */}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto">
            {/* The warning triangle is for a selection that is WRONG, not
                for one that is merely unfinished — "pick at least one truck"
                is an instruction, not a fault. */}
            {trucks.count > 0 && (trucks.missingQty.length > 0 || trucks.overloaded.length > 0) && (
              <AlertTriangle className="size-3.5 text-destructive" />
            )}
            {problem}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close} disabled={createBatch.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!!problem || createBatch.isPending}>
              {createBatch.isPending && <Loader2 className="animate-spin" />}
              {addingToExisting ? 'Add trucks' : 'Create batch'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
