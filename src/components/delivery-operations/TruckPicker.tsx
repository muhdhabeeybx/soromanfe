import { useMemo, useState } from 'react'
import { Search, Truck } from 'lucide-react'

import { Input } from '#/components/ui/input'
import { Checkbox } from '#/components/ui/checkbox'
import { NumberInput } from '#/components/ui/number-input'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

/**
 * Which trucks carried a batch, and what each one actually loaded.
 *
 * One implementation, used by the New PFI dialog and by the PFI form's
 * delivery section. They were not going to stay in step as two: the dialog
 * collected real trucks while the form collected a typed COUNT of them, so a
 * delivery PFI raised on the form recorded the number twenty and identified no
 * trucks at all — nothing to put in the inventory register, and nothing on the
 * form to say so. A batch created there simply never appeared on the delivery
 * pages.
 *
 * ── Loaded, not capacity ──────────────────────────────────────────────────
 *
 * Ticking a truck seeds its quantity from its rated capacity, because that is
 * the closest thing to a right answer and most loads are near it. It stays
 * editable: the old allocation screen wrote capacity straight through, so a
 * truck rated 50,000 that took 47,300 went into the books as 50,000 and the
 * batch overstated itself on every truck that loaded short.
 */

/** What this picker needs off a fleet truck. */
export interface FleetPick {
  id?: number | string
  _id?: string
  plateNumber?: string
  capacity?: number | null
  capacity_litres?: number | null
  driver?: string
  driver_name?: string
}

/** One truck as the picker hands it back. */
export interface PickedTruck {
  truckId: number | null
  plateNumber: string
  capacity: number | null
  loadedQty: number
}

/** Keyed by fleet id; the value is the raw text in the quantity box. */
export type TruckSelection = Record<string, { loadedQty: string }>

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * The fleet, as the picker sees it.
 *
 * useAllocatableTrucks builds each row by spreading a FleetTruck and adding
 * aliases, and the inferred return type keeps only the aliases — so
 * plateNumber and id are not on it despite being on every row it returns.
 */
export function useFleetPicks(): FleetPick[] {
  const { data } = useAllocatableTrucks()
  return useMemo(() => (data?.trucks ?? []) as unknown as FleetPick[], [data])
}

/** Everything a caller needs to validate and submit a selection. */
export function truckSelectionSummary(selection: TruckSelection, fleet: FleetPick[]) {
  const ids = Object.keys(selection)
  const byId = new Map(fleet.map((t) => [String(t.id ?? t._id), t]))

  let loaded = 0
  let capacity = 0
  const missingQty: string[] = []
  const overloaded: string[] = []

  for (const id of ids) {
    const qty = num(selection[id].loadedQty)
    const cap = num(byId.get(id)?.capacity ?? byId.get(id)?.capacity_litres)
    loaded += qty
    capacity += cap
    // A truck with no quantity would go in as zero and quietly shrink the batch.
    if (!(qty > 0)) missingQty.push(id)
    if (cap > 0 && qty > cap) overloaded.push(id)
  }

  const trucks: PickedTruck[] = ids.map((id) => {
    const t = byId.get(id)
    return {
      truckId: Number(id) || null,
      plateNumber: t?.plateNumber || '',
      capacity: num(t?.capacity ?? t?.capacity_litres) || null,
      loadedQty: num(selection[id].loadedQty),
    }
  })

  return {
    ids,
    trucks,
    count: ids.length,
    loaded,
    capacity,
    short: capacity - loaded,
    missingQty,
    overloaded,
    /** The one sentence to show beside a disabled submit, or null. */
    problem:
      ids.length === 0 ? 'Pick at least one truck'
      : missingQty.length > 0
        ? `${missingQty.length} truck${missingQty.length === 1 ? ' has' : 's have'} no quantity`
      : overloaded.length > 0
        ? `${overloaded.length} truck${overloaded.length === 1 ? '' : 's'} loaded beyond capacity`
      : null,
  }
}

export function TruckPicker({
  fleet,
  value,
  onChange,
  title = 'Trucks',
  hint = 'Tick a truck and it takes its rated capacity. Change it to what actually went on.',
  unit,
  className,
}: {
  fleet: FleetPick[]
  value: TruckSelection
  onChange: (next: TruckSelection) => void
  title?: string
  hint?: string
  /** Named on the footer total, so litres are never implied over kilograms. */
  unit?: string
  className?: string
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return fleet
    return fleet.filter((t) =>
      (t.plateNumber || '').toLowerCase().includes(q) ||
      (t.driver || t.driver_name || '').toLowerCase().includes(q),
    )
  }, [fleet, search])

  const totals = truckSelectionSummary(value, fleet)

  const toggle = (id: string, capacity: number) => {
    if (value[id]) {
      const next = { ...value }
      delete next[id]
      onChange(next)
      return
    }
    onChange({ ...value, [id]: { loadedQty: capacity > 0 ? String(capacity) : '' } })
  }

  return (
    <section className={cn('rounded-lg border border-foreground/15', className)}>
      <div className="flex flex-wrap items-center gap-3 border-b border-foreground/15 px-4 py-3">
        <Truck className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className={cn(MICRO, 'text-muted-foreground')}>{hint}</p>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            placeholder="Plate or driver…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="max-h-64 divide-y divide-foreground/10 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {fleet.length === 0 ? 'No trucks in the fleet yet.' : 'No truck matches that.'}
          </p>
        )}

        {filtered.map((t) => {
          const id = String(t.id ?? t._id)
          const cap = num(t.capacity ?? t.capacity_litres)
          const pick = value[id]
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
                onCheckedChange={() => toggle(id, cap)}
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
                    onValueChange={(v) => onChange({ ...value, [id]: { loadedQty: v } })}
                  />
                  {/* The shortfall on the row it belongs to — "why is this
                      batch 4,550 down" is answered here, not in the total. */}
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
          {unit ? <span className="text-muted-foreground"> {unit}</span> : null}
          <span className="text-muted-foreground">
            {' '}across {totals.count} truck{totals.count === 1 ? '' : 's'}
          </span>
        </span>
        {totals.capacity > 0 && totals.short > 0 && (
          <span className={cn(MICRO, 'text-muted-foreground')}>
            {totals.short.toLocaleString()} under the {totals.capacity.toLocaleString()} they can hold
          </span>
        )}
      </div>
    </section>
  )
}
