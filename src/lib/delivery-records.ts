import type { DeliveryCustomer, DeliveryInventory, DeliverySale } from '#/lib/types'
import { isFillingStation, normalizePlate, salesForLoading, toNum } from '#/lib/sales-ledger-utils'

export { normalizePlate }

/**
 * One place that decides what a truck allocation actually says.
 *
 * Three screens each grew their own copy of "truck plate or dash, depot or
 * PFI location or dash, rate or dash" — and each copy stopped one fallback
 * short of the answer. The result was columns reading "—" on rows whose
 * data was sitting in the next table over: half the allocations never
 * resolved their fleet truck at all, so the driver was blank; every row's
 * rate is 0 in the database, so the rate was blank; a third of them carry
 * no load date of their own, so the date was blank.
 *
 * A blank should mean "nobody recorded this", never "we did not look".
 */

// Plates are written both ways — "BWR 826 XB" in some rows, "BWR826XB" in
// others, and the fleet register has no spaces at all. Comparing them
// literally is why 116 of 234 allocations could not find their own truck.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FleetTruck = Record<string, any>

export interface TruckIndex {
  find: (entry: { truckId?: number | string | null; truckNumber?: string | null }) => FleetTruck | null
}

/** By id where there is one, by normalised plate where there is not. */
export function buildTruckIndex(trucks: FleetTruck[]): TruckIndex {
  const byId = new Map<string, FleetTruck>()
  const byPlate = new Map<string, FleetTruck>()

  for (const t of trucks) {
    if (t?.id != null) byId.set(String(t.id), t)
    if (t?._id != null) byId.set(String(t._id), t)
    const plate = normalizePlate(t?.plateNumber)
    if (plate && !byPlate.has(plate)) byPlate.set(plate, t)
  }

  return {
    find: (entry) => {
      if (entry?.truckId != null && entry.truckId !== '') {
        const hit = byId.get(String(entry.truckId))
        if (hit) return hit
      }
      const plate = normalizePlate(entry?.truckNumber)
      return plate ? byPlate.get(plate) || null : null
    },
  }
}

/** Driver as the fleet register has it, however the plate was written. */
export const driverOf = (truck: FleetTruck | null): string =>
  truck?.driverName || truck?.driver || truck?.driver_name || ''

// ── Status ────────────────────────────────────────────────────────────────

export type LoadingStatusKey = 'loaded' | 'offloaded' | 'empty' | 'unknown'

export interface StatusDisplay {
  key: LoadingStatusKey
  label: string
  /** Tailwind classes for a badge. */
  cls: string
}

/**
 * Every value the `loading_status` enum can hold gets a badge.
 *
 * `empty` is a real enum value with 36 rows behind it, but no screen had a
 * label for it, so those rows showed a bare dash and were counted as neither
 * in transit nor sold. What it means operationally is the owner's call; until
 * that is settled it says "Empty" rather than nothing.
 */
export const STATUS_DISPLAY: Record<LoadingStatusKey, StatusDisplay> = {
  loaded: { key: 'loaded', label: 'In Transit', cls: 'bg-warning/10 text-warning border-warning/40' },
  offloaded: { key: 'offloaded', label: 'Sold', cls: 'bg-accent/10 text-accent border-accent/40' },
  empty: { key: 'empty', label: 'Empty', cls: 'bg-muted text-muted-foreground border-border' },
  unknown: { key: 'unknown', label: 'Unrecorded', cls: 'bg-muted text-muted-foreground border-border' },
}

export function statusOf(entry: { loadingStatus?: string | null }): StatusDisplay {
  const raw = String(entry?.loadingStatus || '').toLowerCase()
  if (raw === 'loaded' || raw === 'offloaded' || raw === 'empty') return STATUS_DISPLAY[raw]
  return STATUS_DISPLAY.unknown
}

// ── Field resolution ──────────────────────────────────────────────────────

export interface ResolveContext {
  truck?: FleetTruck | null
  customer?: DeliveryCustomer | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pfi?: any
  /** The sales-ledger entries already matched to this allocation. */
  sales?: DeliverySale[]
}

/** The load date: the allocation's own, else the earliest on its sales. */
export function resolveLoadDate(entry: DeliveryInventory, sales: DeliverySale[] = []): string {
  if (entry.dateAllocated) return entry.dateAllocated
  return sales.map(s => s.dateLoaded).filter(Boolean).sort()[0] || ''
}

/** The rate: the ledger's, else whatever was typed onto the allocation. */
export function resolveRate(entry: DeliveryInventory, sales: DeliverySale[] = []): number {
  const fromSales = sales.reduce((mx, s) => Math.max(mx, toNum(s.rate)), 0)
  return fromSales > 0 ? fromSales : toNum(entry.rate)
}

/** Depot: the allocation's, the PFI's, else where the sales say it loaded. */
export function resolveDepot(
  entry: DeliveryInventory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pfi?: any,
  sales: DeliverySale[] = [],
): string {
  return entry.depot
    || entry.pfiLocation
    || pfi?.locationName
    || sales.map(s => s.depotLoaded).find(Boolean)
    || ''
}

/** Customer: the allocation's, the linked record's, else the sales'. */
export function resolveCustomerName(
  entry: DeliveryInventory,
  customer?: DeliveryCustomer | null,
  sales: DeliverySale[] = [],
): string {
  return entry.customerName
    || customer?.name
    || sales.map(s => s.customerName).find(Boolean)
    || ''
}

/**
 * Destination. A filling station IS the destination, so its name wins; for
 * everyone else it is the location typed on the allocation, and failing that
 * the one recorded against the sale.
 */
export function resolveDestination(
  entry: DeliveryInventory,
  customer?: DeliveryCustomer | null,
  sales: DeliverySale[] = [],
): string {
  if (isFillingStation(customer)) return customer?.name || entry.customerName || ''
  return entry.location
    || sales.map(s => s.location).find(Boolean)
    || ''
}

/** Product: the allocation's, else the PFI it was drawn against. */
export function resolveProduct(
  entry: DeliveryInventory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pfi?: any,
): string {
  return entry.pfiProduct || pfi?.productName || ''
}

/**
 * The label for the batch this truck belongs to.
 *
 * The PFI number where one is linked — 71 allocations have no PFI at all now
 * that allocating no longer asks for one — else the allocation code, which is
 * what people actually call these batches ("PFI-36C").
 */
export function resolveBatchLabel(
  entry: DeliveryInventory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pfi?: any,
): string {
  return entry.pfiNumber || pfi?.pfiNumber || (entry.allocationCode || '').trim().toUpperCase() || ''
}

export interface ResolvedLoading {
  status: StatusDisplay
  truckPlate: string
  driverName: string
  capacity: number
  product: string
  depot: string
  customerName: string
  destination: string
  rate: number
  dateLoaded: string
  batchLabel: string
}

/** Everything above, applied to one allocation. */
export function resolveLoading(entry: DeliveryInventory, ctx: ResolveContext = {}): ResolvedLoading {
  const sales = ctx.sales ?? []
  const status = statusOf(entry)
  return {
    status,
    truckPlate: entry.truckNumber || ctx.truck?.plateNumber || '',
    driverName: driverOf(ctx.truck ?? null),
    capacity: toNum(ctx.truck?.capacity_litres ?? ctx.truck?.capacity ?? ctx.truck?.maxCapacity),
    product: resolveProduct(entry, ctx.pfi),
    depot: resolveDepot(entry, ctx.pfi, sales),
    customerName: resolveCustomerName(entry, ctx.customer, sales),
    destination: resolveDestination(entry, ctx.customer, sales),
    rate: resolveRate(entry, sales),
    dateLoaded: resolveLoadDate(entry, sales),
    batchLabel: resolveBatchLabel(entry, ctx.pfi),
  }
}

/**
 * Matches every allocation in a list to its sales, once.
 *
 * Dated allocations claim their sales first so an undated row for the same
 * truck cannot swallow them — the ordering useLedgerGroups already relies on.
 */
export function matchSalesByRecord(
  entries: DeliveryInventory[],
  allSales: DeliverySale[],
): Map<string, DeliverySale[]> {
  const map = new Map<string, DeliverySale[]>()
  const claimed = new Set<string>()
  const ordered = [
    ...entries.filter(e => !!e.dateAllocated),
    ...entries.filter(e => !e.dateAllocated),
  ]

  for (const entry of ordered) {
    const matched = salesForLoading(allSales, {
      truckNumber: entry.truckNumber,
      dateAllocated: entry.dateAllocated,
      allocationCode: entry.allocationCode,
    }).filter(s => !claimed.has(String(s._id ?? s.id ?? '')))
    matched.forEach(s => claimed.add(String(s._id ?? s.id ?? '')))
    map.set(entry._id || entry.id || '', matched)
  }

  return map
}
