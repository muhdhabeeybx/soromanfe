import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Search, Truck, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Checkbox } from '#/components/ui/checkbox'
import { NativeSelect } from '#/components/ui/native-select'
import { NumberInput } from '#/components/ui/number-input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import {
  useCreateDeliveryBatch, useDepotsForFilter, usePfiList, DeliveryBatchPartial,
} from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { useToast } from '#/lib/hooks/useToast'
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

interface TruckPick {
  loadedQty: string
}

/**
 * What this form needs off a fleet truck.
 *
 * Named here rather than imported: useAllocatableTrucks builds each row by
 * spreading a FleetTruck and adding aliases, and the inferred return type
 * keeps only the aliases — so plateNumber and id are not on it despite being
 * on every row it returns.
 */
interface FleetPick {
  id?: number | string
  _id?: string
  plateNumber?: string
  capacity?: number | null
  capacity_litres?: number | null
  driver?: string
  driver_name?: string
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const today = () => new Date().toISOString().slice(0, 10)

export function NewBatchDialog({ open, onOpenChange, existingCodes = [] }: NewBatchDialogProps) {
  const navigate = useNavigate()
  const toast = useToast()

  const { data: depots = [] } = useDepotsForFilter()
  const { data: productData } = useProductList()
  const { data: trucksData } = useAllocatableTrucks()
  const { data: pfisData } = usePfiList()

  const createBatch = useCreateDeliveryBatch()

  // useProductList answers `res.data.data`, which is the envelope on some
  // deployments and the bare array on others.
  const products = useMemo(() => {
    const list = productData?.products ?? productData ?? []
    return (Array.isArray(list) ? list : []) as Array<{ id?: number | string; _id?: string; name: string }>
  }, [productData])

  const trucks = useMemo(() => (trucksData?.trucks ?? []) as unknown as FleetPick[], [trucksData])

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
  const [picked, setPicked] = useState<Record<string, TruckPick>>({})
  const [truckSearch, setTruckSearch] = useState('')

  const reset = () => {
    setMode('new'); setCode(''); setExistingPfiId(''); setDepotId(''); setProductId('')
    setDate(today()); setSellAt([]); setPicked({}); setTruckSearch('')
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

  const filteredTrucks = useMemo(() => {
    const q = truckSearch.trim().toLowerCase()
    if (!q) return trucks
    return trucks.filter((t) =>
      (t.plateNumber || '').toLowerCase().includes(q) ||
      (t.driver || t.driver_name || '').toLowerCase().includes(q),
    )
  }, [trucks, truckSearch])

  const toggleTruck = (id: string, capacity: number) =>
    setPicked((prev) => {
      if (prev[id]) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: { loadedQty: capacity > 0 ? String(capacity) : '' } }
    })

  const toggleSellAt = (id: number) =>
    setSellAt((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const pickedIds = Object.keys(picked)

  const totals = useMemo(() => {
    let loaded = 0
    let capacity = 0
    for (const id of pickedIds) {
      loaded += num(picked[id].loadedQty)
      const t = trucks.find((x) => String(x.id ?? x._id) === id)
      capacity += num(t?.capacity ?? t?.capacity_litres)
    }
    return { loaded, capacity, short: capacity - loaded }
  }, [picked, pickedIds, trucks])

  // ── What stops a save ───────────────────────────────────────────────────
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '-')
  const codeTaken = mode === 'new' && normalizedCode.length > 0 && (
    existingCodes.some((c) => c.trim().toUpperCase() === normalizedCode) ||
    deliveryBatches.some((p) => (p.pfiNumber || '').trim().toUpperCase() === normalizedCode)
  )
  // A truck with no quantity would go in as zero and quietly shrink the batch.
  const missingQty = pickedIds.filter((id) => !(num(picked[id].loadedQty) > 0))
  const overloaded = pickedIds.filter((id) => {
    const t = trucks.find((x) => String(x.id ?? x._id) === id)
    const cap = num(t?.capacity ?? t?.capacity_litres)
    return cap > 0 && num(picked[id].loadedQty) > cap
  })

  const problem =
    mode === 'new' && !normalizedCode ? 'Give the batch a code'
    : codeTaken ? `${normalizedCode} is already in use`
    : mode === 'new' && !depotId ? 'Say which depot it loads at'
    : mode === 'existing' && !existingPfiId ? 'Choose the batch to add to'
    : pickedIds.length === 0 ? 'Pick at least one truck'
    : missingQty.length > 0 ? `${missingQty.length} truck${missingQty.length === 1 ? ' has' : 's have'} no quantity`
    : overloaded.length > 0 ? `${overloaded.length} truck${overloaded.length === 1 ? '' : 's'} loaded beyond capacity`
    : null

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
        trucks: pickedIds.map((id) => {
          const t = trucks.find((x) => String(x.id ?? x._id) === id)
          return {
            truckId: Number(id) || null,
            plateNumber: t?.plateNumber || '',
            capacity: num(t?.capacity ?? t?.capacity_litres) || null,
            loadedQty: num(picked[id].loadedQty),
          }
        }),
      })

      toast.success(
        `${pickedIds.length} truck${pickedIds.length === 1 ? '' : 's'} on ${
          mode === 'new' ? normalizedCode : chosenBatch?.pfiNumber
        } · ${totals.loaded.toLocaleString()} loaded`,
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
          <DialogTitle>New delivery batch</DialogTitle>
          <DialogDescription>
            Name it, say where it loaded, and tick the trucks that carried it. The batch quantity
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
                {m === 'new' ? 'New batch' : 'Add to an existing batch'}
              </button>
            ))}
          </div>

          {mode === 'new' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batch-code">Batch code</Label>
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
                    : 'It is the PFI number, so the batch appears under this name everywhere.'}
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
                <Label htmlFor="batch-existing">Batch</Label>
                <NativeSelect
                  id="batch-existing" value={existingPfiId}
                  onChange={(e) => setExistingPfiId(e.target.value)}
                >
                  <option value="">Select a batch…</option>
                  {deliveryBatches.map((p) => (
                    <option key={String(p.id ?? p._id)} value={String(p.id ?? p._id)}>
                      {p.pfiNumber}{p.locationName ? ` · ${p.locationName}` : ''}
                    </option>
                  ))}
                </NativeSelect>
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  {chosenBatch
                    ? `${chosenBatch.productName || 'No product'} · loaded at ${chosenBatch.locationName || '—'}`
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
          <section className="rounded-lg border border-foreground/15">
            <div className="flex flex-wrap items-center gap-3 border-b border-foreground/15 px-4 py-3">
              <Truck className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Trucks</p>
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  Tick a truck and it takes its rated capacity. Change it to what actually went on.
                </p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8"
                  placeholder="Plate or driver…"
                  value={truckSearch}
                  onChange={(e) => setTruckSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="max-h-64 divide-y divide-foreground/10 overflow-y-auto">
              {filteredTrucks.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {trucks.length === 0 ? 'No trucks in the fleet yet.' : 'No truck matches that.'}
                </p>
              )}

              {filteredTrucks.map((t) => {
                const id = String(t.id ?? t._id)
                const cap = num(t.capacity ?? t.capacity_litres)
                const pick = picked[id]
                const load = pick ? num(pick.loadedQty) : 0
                const over = cap > 0 && load > cap
                const short = cap > 0 && load > 0 && load < cap ? cap - load : 0
                return (
                  <div
                    key={id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors duration-250 ease-luxe',
                      pick ? 'bg-muted/40' : 'hover:bg-muted/20',
                    )}
                  >
                    <Checkbox
                      id={`truck-${id}`}
                      checked={!!pick}
                      onCheckedChange={() => toggleTruck(id, cap)}
                    />
                    <label htmlFor={`truck-${id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-sm font-semibold">
                        {t.plateNumber || 'No plate'}
                      </span>
                      <span className={cn(MICRO, 'text-muted-foreground')}>
                        {t.driver || t.driver_name || 'No driver'}
                        {cap > 0 ? ` · holds ${cap.toLocaleString()}` : ' · no capacity on record'}
                      </span>
                    </label>

                    {pick && (
                      <div className="flex items-center gap-2">
                        <NumberInput
                          allowDecimal
                          className="h-8 w-28 text-right"
                          placeholder="Loaded"
                          aria-label={`Quantity loaded on ${t.plateNumber}`}
                          aria-invalid={over || undefined}
                          value={pick.loadedQty}
                          onValueChange={(v) => setPicked((prev) => ({ ...prev, [id]: { loadedQty: v } }))}
                        />
                        {/* The shortfall on the row it belongs to — "why is
                            this batch 4,550 down" is answered here. */}
                        <span className={cn(
                          MICRO, 'w-20 shrink-0',
                          over ? 'text-destructive' : short ? 'text-warning' : 'text-muted-foreground',
                        )}>
                          {over ? 'over' : short ? `${short.toLocaleString()} short` : cap > 0 && load > 0 ? 'full' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2.5 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{totals.loaded.toLocaleString()}</span>
                <span className="text-muted-foreground">
                  {' '}across {pickedIds.length} truck{pickedIds.length === 1 ? '' : 's'}
                </span>
              </span>
              {totals.capacity > 0 && totals.short > 0 && (
                <span className={cn(MICRO, 'text-muted-foreground')}>
                  {totals.short.toLocaleString()} under the {totals.capacity.toLocaleString()} they can hold
                </span>
              )}
            </div>
          </section>

          {/* ── Where it may be sold ────────────────────────────────────── */}
          {mode === 'new' && (
            <section className="rounded-lg border border-foreground/15">
              <div className="border-b border-foreground/15 px-4 py-3">
                <p className="text-sm font-semibold">Locations that may sell from it</p>
                <p className={cn(MICRO, 'text-muted-foreground')}>
                  Optional. Leave it empty and the batch is sellable only at the depot it loaded at.
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
            {problem && pickedIds.length > 0 && (missingQty.length > 0 || overloaded.length > 0) && (
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
              {mode === 'new' ? 'Create batch' : 'Add trucks'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
