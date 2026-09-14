import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Trash2, Truck } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import {
  useCreateDeliveryBatch, useDeleteDeliveryInventory,
} from '#/lib/hooks/useDeliveryInventory'
import {
  TruckPicker, useFleetPicks, truckSelectionSummary, type TruckSelection,
} from '#/components/delivery-operations/TruckPicker'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Add a truck to an allocation, or take one off it.
 *
 * ── Why this needed a place of its own ────────────────────────────────────
 *
 * An allocation is a code and the truck rows recorded under it. Creating one
 * had a screen; changing one had nothing. A truck that turned up late, or was
 * entered against the wrong code, could only be fixed by whoever had database
 * access — so in practice it was not fixed, and the register drifted from the
 * yard.
 *
 * ── Adding is the same write as creating ──────────────────────────────────
 *
 * Nothing anywhere holds "the allocation" apart from its rows, so adding a
 * truck to PFI-25C is exactly what creating PFI-25C does: one row, that code.
 * It goes through useCreateDeliveryBatch for that reason rather than a second
 * path that could come to disagree with the first — including its honesty
 * about partial failure, since four trucks are four POSTs and a blip halfway
 * leaves two recorded.
 *
 * ── Removing is guarded, and the guard is money ───────────────────────────
 *
 * A truck carrying sales cannot be removed here. Deleting that row does not
 * delete what was sold off it — the sale stays, now pointing at a load the
 * register says never happened, which is how a ledger stops adding up. Those
 * have to have their sales dealt with first, and the dialog says so per truck
 * rather than failing at the end.
 */

export interface AllocationTruckRow {
  /** The inventory row's own id — what a delete addresses. */
  id: string
  plate: string
  qty: number
  unitLabel?: string
  statusLabel?: string
  /** Sales matched to this row. Any at all, and it cannot be removed. */
  salesCount: number
}

export function EditAllocationDialog({
  open, onOpenChange, code, rows, depotName, productName, unit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The allocation being edited. Blank for the unassigned bucket. */
  code: string
  rows: AllocationTruckRow[]
  /** Inherited from the rows already here, so an added truck matches them. */
  depotName: string
  productName: string
  unit?: string
}) {
  const createBatch = useCreateDeliveryBatch()
  const removeRow = useDeleteDeliveryInventory()
  const fleet = useFleetPicks()

  const [selection, setSelection] = useState<TruckSelection>({})
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [confirmRemove, setConfirmRemove] = useState<AllocationTruckRow | null>(null)

  const picked = truckSelectionSummary(selection, fleet)

  /**
   * Trucks already on this allocation are still offered.
   *
   * A plate can legitimately run the same code twice — it goes out, comes
   * back, loads again — so hiding it would block a real second load. The
   * count beside it is there to make a double-entry obvious instead.
   */
  const alreadyHere = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const p = (r.plate || '').trim().toUpperCase()
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return counts
  }, [rows])

  const repeats = picked.trucks.filter(
    (t) => alreadyHere.has((t.plateNumber || '').trim().toUpperCase()),
  )

  const close = () => {
    onOpenChange(false)
    setSelection({})
    setConfirmRemove(null)
  }

  const problem = !code
    // The unassigned bucket is not a code, so there is nothing to add TO.
    ? 'This allocation has no code — assign one before adding trucks'
    : picked.count === 0
      ? null   // nothing to add is fine; the dialog also removes
      : picked.problem

  const addTrucks = async () => {
    if (picked.count === 0 || problem) return
    try {
      await createBatch.mutateAsync({
        code,
        depotName,
        productName,
        dateAllocated: date,
        trucks: picked.trucks,
      })
      setSelection({})
    } catch {
      // useCreateDeliveryBatch has already said what went wrong.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit {code || 'unassigned allocation'}</DialogTitle>
          <DialogDescription>
            Add a truck that loaded under this code, or take off one entered by mistake.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── What is on it now ─────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className={cn(MICRO, 'text-muted-foreground')}>
                On this allocation
              </Label>
              <span className="text-xs text-muted-foreground">
                {rows.length} truck{rows.length === 1 ? '' : 's'}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-foreground/15 px-3 py-6 text-center text-xs text-muted-foreground">
                No trucks recorded under this code yet.
              </p>
            ) : (
              <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10">
                {rows.map((r) => {
                  const sold = r.salesCount > 0
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <Truck className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.plate || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {Number(r.qty || 0).toLocaleString()} {r.unitLabel || unit || 'Litres'}
                          {r.statusLabel ? ` · ${r.statusLabel}` : ''}
                        </p>
                      </div>
                      {sold ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] whitespace-nowrap text-muted-foreground"
                          title="Removing this row would leave its sales pointing at a load the register says never happened. Deal with the sales first."
                        >
                          <AlertTriangle className="size-3" />
                          {r.salesCount} sale{r.salesCount === 1 ? '' : 's'} — cannot remove
                        </span>
                      ) : (
                        <Button
                          variant="ghost" size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmRemove(r)}
                          disabled={removeRow.isPending}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Remove {r.plate}</span>
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ── Adding ────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="alloc-date">Date loaded</Label>
                <Input
                  id="alloc-date" type="date" value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {/* Read-only: an added truck belongs to the same load as the rows
                  already here, and letting these be retyped per truck is how a
                  single code ends up with three depots on it. */}
              <div className="space-y-1.5">
                <Label>Loaded at</Label>
                <p className="truncate rounded-md border border-foreground/10 bg-muted/40 px-3 py-2 text-sm">
                  {depotName || '—'}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Product</Label>
                <p className="truncate rounded-md border border-foreground/10 bg-muted/40 px-3 py-2 text-sm">
                  {productName || '—'}
                </p>
              </div>
            </div>

            <TruckPicker
              fleet={fleet}
              value={selection}
              onChange={setSelection}
              title="Add trucks"
              unit={unit}
            />

            {repeats.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                <span>
                  {repeats.map((t) => t.plateNumber).join(', ')}
                  {repeats.length === 1 ? ' is' : ' are'} already on this allocation. That is fine
                  for a second load — check it is not the same one entered twice.
                </span>
              </p>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {problem ?? (picked.count > 0
              ? `${picked.count} truck${picked.count === 1 ? '' : 's'} · ${picked.loaded.toLocaleString()} ${unit || 'Litres'}`
              : 'Pick trucks to add, or remove one above.')}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>Close</Button>
            <Button
              onClick={addTrucks}
              disabled={picked.count === 0 || !!problem || createBatch.isPending}
            >
              {createBatch.isPending && <Loader2 className="animate-spin" />}
              Add to {code || 'allocation'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Removal asks once. The row is a record of a physical movement, and
          nothing here can put it back. */}
      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take {confirmRemove?.plate} off {code || 'this allocation'}?</DialogTitle>
            <DialogDescription>
              The load record goes for good — {Number(confirmRemove?.qty || 0).toLocaleString()}{' '}
              {confirmRemove?.unitLabel || unit || 'Litres'}. Do this when the truck was entered
              against the wrong code or never loaded at all.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={removeRow.isPending}
              onClick={() => {
                if (!confirmRemove) return
                removeRow.mutate(confirmRemove.id, {
                  onSuccess: () => setConfirmRemove(null),
                })
              }}
            >
              {removeRow.isPending && <Loader2 className="animate-spin" />}
              Remove the truck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
