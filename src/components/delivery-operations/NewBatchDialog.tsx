import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Checkbox } from '#/components/ui/checkbox'
import { NativeSelect } from '#/components/ui/native-select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import {
  useCreateDeliveryBatch, useDepotsForFilter, usePfiList, DeliveryBatchPartial,
} from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { useToast } from '#/lib/hooks/useToast'
import {
  TruckPicker, useFleetPicks, truckSelectionSummary, type TruckSelection,
} from '#/components/delivery-operations/TruckPicker'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Everything a delivery batch is, on one form.
 *
 * This replaced a two-screen flow — a create page that took a name and a
 * depot, and a second page where the trucks were entered afterwards. The
 * trucks are the reason anybody opens this, so asking for them second meant
 * the primary action on the inventory page led to a form that could not
 * finish the job. The sequencing problem that split them (locations and the
 * manifest are addressed by a PFI id that does not exist yet) is handled in
 * useCreateDeliveryBatch instead, which is where it belongs.
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
  /** Codes already in use on the operations rows, to catch a collision early. */
  existingCodes?: string[]
}

type Mode = 'new' | 'existing'

const today = () => new Date().toISOString().slice(0, 10)

export function NewBatchDialog({ open, onOpenChange, existingCodes = [] }: NewBatchDialogProps) {
  const navigate = useNavigate()
  const toast = useToast()

  const { data: depots = [] } = useDepotsForFilter()
  const { data: productData } = useProductList()
  const { data: pfisData } = usePfiList()

  const createBatch = useCreateDeliveryBatch()

  // useProductList answers `res.data.data`, which is the envelope on some
  // deployments and the bare array on others.
  const products = useMemo(() => {
    const list = productData?.products ?? productData ?? []
    return (Array.isArray(list) ? list : []) as Array<{ id?: number | string; _id?: string; name: string }>
  }, [productData])

  const fleet = useFleetPicks()

  /** Only delivery batches can take a manifest, so only they are offered. */
  const deliveryBatches = useMemo(
    () => (pfisData?.pfis ?? [])
      .filter((p) => p.pfiType === 'delivery')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [pfisData],
  )

  // ── Form ────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('new')
  const [code, setCode] = useState('')
  const [existingPfiId, setExistingPfiId] = useState('')
  const [depotId, setDepotId] = useState('')
  const [productId, setProductId] = useState('')
  const [date, setDate] = useState(today())
  const [sellAt, setSellAt] = useState<number[]>([])
  const [truckSelection, setTruckSelection] = useState<TruckSelection>({})

  const reset = () => {
    setMode('new'); setCode(''); setExistingPfiId(''); setDepotId(''); setProductId('')
    setDate(today()); setSellAt([]); setTruckSelection({})
  }

  const close = () => { onOpenChange(false); reset() }

  const chosenBatch = deliveryBatches.find((p) => String(p.id ?? p._id) === existingPfiId)

  // On an existing batch the depot and product are already facts about it; the
  // operations rows still need them as text, so they are read off the batch
  // rather than asked for again.
  const depotName = mode === 'existing'
    ? (chosenBatch?.locationName || '')
    : (depots.find((d) => String(d.id ?? d._id) === depotId)?.name || '')
  const productName = mode === 'existing'
    ? (chosenBatch?.productName || '')
    : (products.find((p) => String(p.id ?? p._id) === productId)?.name || '')

  const toggleSellAt = (id: number) =>
    setSellAt((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Ticking, searching, per-truck quantities and their totals all live in
  // TruckPicker — the same component the PFI form uses, so the two cannot
  // drift into asking for trucks differently.
  const trucks = truckSelectionSummary(truckSelection, fleet)

  // ── What stops a save ───────────────────────────────────────────────────
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '-')
  const codeTaken = mode === 'new' && normalizedCode.length > 0 && (
    existingCodes.some((c) => c.trim().toUpperCase() === normalizedCode) ||
    deliveryBatches.some((p) => (p.pfiNumber || '').trim().toUpperCase() === normalizedCode)
  )
  const problem =
    mode === 'new' && !normalizedCode ? 'Give the PFI a number'
    : codeTaken ? `${normalizedCode} is already in use`
    : mode === 'new' && !depotId ? 'Say which depot it loads at'
    : mode === 'existing' && !existingPfiId ? 'Choose the PFI to add to'
    // Every complaint about the selection itself — none picked, one with no
    // quantity, one loaded past capacity — comes from the picker.
    : trucks.problem

  const submit = async () => {
    if (problem) return
    try {
      const { pfiId } = await createBatch.mutateAsync({
        pfiNumber: mode === 'new' ? normalizedCode : (chosenBatch?.pfiNumber || undefined),
        pfiId: mode === 'existing' ? Number(existingPfiId) : undefined,
        locationId: mode === 'new' ? Number(depotId) : undefined,
        productId: mode === 'new' && productId ? Number(productId) : undefined,
        depotName,
        productName,
        dateAllocated: date,
        // Only ever sent for a new batch. PUT /locations replaces the
        // allowlist, so sending it for an existing one would wipe whatever
        // that batch already allows from a form that never showed it.
        sellAtDepotIds: mode === 'new' ? sellAt : undefined,
        trucks: trucks.trucks,
      })

      toast.success(
        `${trucks.count} truck${trucks.count === 1 ? '' : 's'} on ${
          mode === 'new' ? normalizedCode : chosenBatch?.pfiNumber
        } · ${trucks.loaded.toLocaleString()} loaded`,
      )
      close()
      navigate({ to: '/delivery-operations/batch', search: { id: pfiId } })
    } catch (err) {
      // The hook has already said what went wrong. What it cannot do is
      // decide what to do next: if the batch got created and a later step
      // did not, the form is stale and the batch page is where the rest is
      // finished — so go there rather than leaving a half-built batch behind
      // a dialog that looks like nothing happened.
      if (err instanceof DeliveryBatchPartial) {
        close()
        navigate({ to: '/delivery-operations/batch', search: { id: err.pfiId } })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New delivery PFI</DialogTitle>
          <DialogDescription>
            Name it, say where it loaded, and tick the trucks that carried it. The PFI's quantity
            is the sum of what they loaded.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 max-h-[65vh] space-y-5 overflow-y-auto px-2">
          {/* ── Which batch ─────────────────────────────────────────────── */}
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            {(['new', 'existing'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm transition-colors duration-250 ease-luxe',
                  mode === m ? 'bg-background font-semibold shadow-none' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'new' ? 'New PFI' : 'Add to an existing PFI'}
              </button>
            ))}
          </div>

          {mode === 'new' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batch-code">PFI number</Label>
                <Input
                  id="batch-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="PFI-25C"
                  aria-invalid={codeTaken || undefined}
                />
                <p className={cn(MICRO, codeTaken ? 'text-destructive' : 'text-muted-foreground')}>
                  {codeTaken
                    ? 'Already in use — add to it on the other tab instead.'
                    : 'Must be unique. The PFI appears under this name everywhere a batch does.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="batch-depot">Loaded at</Label>
                <NativeSelect id="batch-depot" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                  <option value="">Select the depot it loads at…</option>
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batch-existing">PFI</Label>
                <NativeSelect
                  id="batch-existing" value={existingPfiId}
                  onChange={(e) => setExistingPfiId(e.target.value)}
                >
                  <option value="">Select a PFI…</option>
                  {/* Every delivery PFI is offered, including ones raised in
                      the PFI module that have never been loaded — those are
                      precisely the ones this tab exists to bring in. What it
                      must not do is offer them silently: a PFI listed here and
                      absent from the table behind the dialog reads as a bug
                      unless the option says why, so an unloaded one says so on
                      its own line. The inventory table lists LOADS, so a batch
                      appears there once it has one. */}
                  {deliveryBatches.map((p) => {
                    const loadedQty = Number(p.startingQtyLitres ?? 0)
                    return (
                      <option key={String(p.id ?? p._id)} value={String(p.id ?? p._id)}>
                        {p.pfiNumber}
                        {p.locationName ? ` · ${p.locationName}` : ''}
                        {loadedQty > 0
                          ? ` · ${loadedQty.toLocaleString()} loaded`
                          : ' · no trucks yet'}
                      </option>
                    )
                  })}
                </NativeSelect>
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  {chosenBatch
                    ? Number(chosenBatch.startingQtyLitres ?? 0) > 0
                      ? `${chosenBatch.productName || 'No product'} · loaded at ${chosenBatch.locationName || '—'}. These trucks join its manifest; the ones already on it stay.`
                      : `${chosenBatch.productName || 'No product'} · loaded at ${chosenBatch.locationName || '—'}. Nothing is loaded against it yet, so it is not on the inventory table — adding trucks here is what puts it there.`
                    : 'These trucks join its manifest; the ones already on it stay.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="batch-date-existing">Date loaded</Label>
                <Input
                  id="batch-date-existing" type="date"
                  value={date} onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── The trucks ──────────────────────────────────────────────── */}
          <TruckPicker
            fleet={fleet}
            value={truckSelection}
            onChange={setTruckSelection}
            hint={
              mode === 'existing'
                ? 'These are ADDED to the PFI. The trucks already on it stay.'
                : 'Tick a truck and it takes its rated capacity. Change it to what actually went on.'
            }
          />

          {/* ── Where it may be sold ────────────────────────────────────── */}
          {mode === 'new' && (
            <section className="rounded-lg border border-foreground/15">
              <div className="border-b border-foreground/15 px-4 py-3">
                <p className="text-sm font-semibold">Locations that may sell from it</p>
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  Optional. Leave it empty and the PFI is sellable only at the depot it loaded at.
                </p>
              </div>
              <div className="grid gap-1 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {depots.map((d) => {
                  const id = Number(d.id ?? d._id)
                  const isSource = depotId !== '' && id === Number(depotId)
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={sellAt.includes(id)}
                        onCheckedChange={() => toggleSellAt(id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{d.name}</span>
                        {isSource && (
                          <span className={cn(MICRO, 'text-muted-foreground')}>
                            loaded here · always allowed
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}
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
              {mode === 'new' ? 'Create PFI' : 'Add trucks'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
