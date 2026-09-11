import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, Truck, MapPin, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NumberInput } from '#/components/ui/number-input'
import {
  usePfiLocations, useSetPfiLocations,
  usePfiTrucks, useSetPfiTrucks,
  useDepotsForFilter,
  type PfiTruck,
} from '#/lib/hooks/usePfis'
import { qty } from '#/routes/pfi/-pfi-utils'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * The two things a delivery batch has that a cargo does not.
 *
 * A coastal cargo lands at a depot, is measured into a tank, and is sold from
 * that depot. A delivery allocation is loaded at one depot onto trucks and
 * sold at several others — so it needs to say where it may be sold, and what
 * actually went out on each truck.
 *
 * ── The manifest no longer decides the quantity ────────────────────────────
 *
 * It used to: saving here rewrote the batch's quantity to the sum of what the
 * trucks loaded. That left a PFI type whose headline figure nobody could
 * state — owned by these rows, unable to be typed on the PFI form, and liable
 * to move under the batch whenever this panel was saved.
 *
 * The batch's quantity is typed on the PFI form now, like every other type's.
 * This is a record of what carried it, which is a different question.
 *
 * What it still does well is show the gap. A truck rated 50,000 that took
 * 47,300 has carried 47,300, and the shortfall is shown per truck rather than
 * only in the total, because "why is this batch 4,550 down" is answered by
 * the row and not by the sum.
 */
export function DeliveryBatchPanel({
  pfiId, productUnit, loadedAtDepotId,
}: {
  pfiId: number
  productUnit?: string | null
  /** The depot it is loaded AT — offered as a sell-at location too, but noted. */
  loadedAtDepotId?: number | null
}) {
  const { data: depots = [] } = useDepotsForFilter()
  const { data: allowed = [], isLoading: loadingLocations } = usePfiLocations(pfiId)
  const { data: manifest, isLoading: loadingTrucks } = usePfiTrucks(pfiId)

  const saveLocations = useSetPfiLocations(pfiId)
  const saveTrucks = useSetPfiTrucks(pfiId)

  /**
   * Null until something is edited, then the local copy wins.
   *
   * Deliberately not seeded into state by an effect. Copying server data into
   * state on every fetch means a refetch — a window refocus is enough —
   * silently discards whatever is half-typed. Falling through to the server's
   * answer while untouched, and holding the edit once made, keeps both: the
   * screen follows the server until somebody has something to lose, and stops
   * following it the moment they do. Saving clears the local copy, so the
   * server's version resumes being the truth.
   */
  const [editedDepots, setEditedDepots] = useState<number[] | null>(null)
  const [editedRows, setEditedRows] = useState<PfiTruck[] | null>(null)

  const selected = editedDepots ?? allowed.map((d) => Number(d.id))
  // Memoised because the totals below depend on it: a fresh array identity on
  // every render would recompute them every render.
  const rows = useMemo(
    () => editedRows ?? manifest?.trucks ?? [],
    [editedRows, manifest],
  )

  const toggle = (id: number) =>
    setEditedDepots(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  const addRow = () => setEditedRows([...rows, { plateNumber: '', capacity: null, loadedQty: 0 }])
  const removeRow = (i: number) => setEditedRows(rows.filter((_, x) => x !== i))
  const setRow = (i: number, patch: Partial<PfiTruck>) =>
    setEditedRows(rows.map((row, x) => (x === i ? { ...row, ...patch } : row)))

  const totals = useMemo(() => {
    let loaded = 0
    let capacity = 0
    for (const r of rows) {
      loaded += Number(r.loadedQty) || 0
      capacity += Number(r.capacity) || 0
    }
    return { loaded, capacity, short: capacity - loaded }
  }, [rows])

  /**
   * A row is only saveable once it says how much went on. Everything else is
   * optional — a plate can be filled in later, a capacity may not be known —
   * but a truck with no quantity contributes nothing and would silently
   * shrink the batch if it were counted as zero.
   */
  const invalid = rows.filter((r) => !(Number(r.loadedQty) > 0))
  const overloaded = rows.filter(
    (r) => Number(r.capacity) > 0 && Number(r.loadedQty) > Number(r.capacity),
  )
  const canSaveTrucks = invalid.length === 0 && overloaded.length === 0 && !saveTrucks.isPending

  return (
    <div className="space-y-6">
      {/* ── Where it may be sold ─────────────────────────────────────── */}
      <section className="rounded-lg border border-foreground/15">
        <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3">
          <MapPin className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Locations that may sell from this batch</p>
            <p className={cn(MICRO, 'text-muted-foreground')}>
              Tick every depot that can place orders against it. Leave it empty and the batch
              behaves like any other — sellable only at the depot it was loaded at.
            </p>
          </div>
          <Button
            size="sm"
            disabled={saveLocations.isPending}
            onClick={() => saveLocations.mutate(selected, { onSuccess: () => setEditedDepots(null) })}
          >
            {saveLocations.isPending && <Loader2 className="animate-spin" />}
            Save locations
          </Button>
        </div>

        {loadingLocations ? (
          <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin" /></div>
        ) : (
          <div className="grid gap-1 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {depots.map((d) => {
              const id = Number(d.id ?? d._id)
              const isSource = loadedAtDepotId != null && id === Number(loadedAtDepotId)
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={selected.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{d.name}</span>
                    {/* Named rather than hidden: the loading depot can already
                        sell from the batch without being ticked, so ticking it
                        changes nothing and its absence is not a mistake. */}
                    {isSource && (
                      <span className={cn(MICRO, 'text-muted-foreground')}>loaded here · always allowed</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </section>

      {/* ── What carried it ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-foreground/15">
        <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3">
          <Truck className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Trucks</p>
            <p className={cn(MICRO, 'text-muted-foreground')}>
              What each truck actually loaded, not what it can hold. The batch quantity is the
              sum of these.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" />
            Add truck
          </Button>
        </div>

        {loadingTrucks ? (
          <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin" /></div>
        ) : (
          <div className="space-y-2 p-3">
            {rows.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No trucks yet. Add one and the batch quantity follows.
              </p>
            )}

            {rows.map((r, i) => {
              const cap = Number(r.capacity) || 0
              const load = Number(r.loadedQty) || 0
              const short = cap > 0 ? cap - load : null
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                  <div className="space-y-1">
                    {i === 0 && <Label className={cn(MICRO, 'text-muted-foreground')}>Plate number</Label>}
                    <Input
                      value={r.plateNumber}
                      placeholder="ABC-123XA"
                      onChange={(e) => setRow(i, { plateNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label className={cn(MICRO, 'text-muted-foreground')}>Capacity</Label>}
                    <NumberInput
                      allowDecimal placeholder="50,000"
                      value={r.capacity == null ? '' : String(r.capacity)}
                      onValueChange={(v) => setRow(i, { capacity: v === '' ? null : Number(v) })}
                    />
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label className={cn(MICRO, 'text-muted-foreground')}>Loaded</Label>}
                    <NumberInput
                      allowDecimal placeholder="47,300"
                      value={r.loadedQty ? String(r.loadedQty) : ''}
                      onValueChange={(v) => setRow(i, { loadedQty: Number(v) || 0 })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-0.5">
                    {/* The shortfall on the row it belongs to. "Why is this
                        batch down 4,550" is answered here, not in the total. */}
                    <span className={cn(
                      MICRO, 'w-24 shrink-0 text-right',
                      load > cap && cap > 0 ? 'text-destructive'
                        : short && short > 0 ? 'text-warning' : 'text-muted-foreground',
                    )}>
                      {cap <= 0 ? '' : load > cap ? 'over capacity' : short ? `${short.toLocaleString()} short` : 'full'}
                    </span>
                    <Button
                      variant="ghost" size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeRow(i)}
                      aria-label="Remove this truck"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{qty(totals.loaded, productUnit)}</span>
            <span className="text-muted-foreground">
              {' '}across {rows.length} truck{rows.length === 1 ? '' : 's'}
              {totals.capacity > 0 && (
                <> · {qty(totals.capacity, productUnit)} of capacity, {qty(totals.short, productUnit)} short</>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {(invalid.length > 0 || overloaded.length > 0) && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                {invalid.length > 0
                  ? `${invalid.length} truck${invalid.length === 1 ? '' : 's'} with no quantity`
                  : `${overloaded.length} loaded beyond capacity`}
              </span>
            )}
            <Button
              disabled={!canSaveTrucks}
              onClick={() => saveTrucks.mutate(rows, { onSuccess: () => setEditedRows(null) })}
            >
              {saveTrucks.isPending && <Loader2 className="animate-spin" />}
              Save manifest
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
