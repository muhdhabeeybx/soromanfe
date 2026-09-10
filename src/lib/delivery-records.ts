import type { DeliveryCustomer, DeliveryInventory, DeliverySale } from '#/lib/types'
import { isFillingStation, normalizePlate, salesForLoading, toNum } from '#/lib/sales-ledger-utils'
import { lookupCustomer, type CustomerLookup, type LoadShare, type LoadSplit } from '#/lib/load-split'

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
  loaded: { key: 'loaded', label: 'Unsold', cls: 'bg-warning/10 text-warning border-warning/40' },
  offloaded: { key: 'offloaded', label: 'Sold', cls: 'bg-accent/10 text-accent border-accent/40' },
  empty: { key: 'empty', label: 'Empty', cls: 'bg-muted text-muted-foreground border-border' },
  unknown: { key: 'unknown', label: 'Unrecorded', cls: 'bg-muted text-muted-foreground border-border' },
}

/**
 * A load carrying money is sold, whatever the column says. So is one that
 * went to a filling station.
 *
 * `loading_status` is set by hand — a truck was marked offloaded on the
 * operations screen, or it was not. Recording the sale is a different screen,
 * so the two drifted constantly in one direction: a truck with a rate and a
 * payment against it, still sitting in the unsold count because nobody went
 * back to flip a status that the payment had already made untrue.
 *
 * A rate or a payment is only ever entered against a load that has been
 * delivered, so it is the more reliable of the two facts and it wins here.
 *
 * ── Why a filling station counts on assignment alone ──────────────────────
 *
 * A filling station is ours. Sending a truck to one is not an offer that may
 * yet fall through — the load has left the trading stock the moment it is
 * assigned, and it is then dispensed over days at the pump, so the money
 * arrives long after the truck did and in hundreds of pieces. Waiting for a
 * rate or a payment to call it sold left those loads sitting in the unsold
 * column for weeks, which overstated what was still available to sell.
 *
 * Everything else is unchanged: `empty` stays `empty`, and a load with
 * neither money nor a filling station on it reads exactly as before.
 */
export function statusOf(
  entry: { loadingStatus?: string | null },
  sales: DeliverySale[] = [],
  /** True when this load is assigned to a filling station. */
  toFillingStation = false,
): StatusDisplay {
  if (toFillingStation || sales.some(hasMoneyOn)) return STATUS_DISPLAY.offloaded
  const raw = String(entry?.loadingStatus || '').toLowerCase()
  if (raw === 'loaded' || raw === 'offloaded' || raw === 'empty') return STATUS_DISPLAY[raw]
  return STATUS_DISPLAY.unknown
}

/**
 * Is this load assigned to a filling station — on the allocation itself, or
 * on any of the sales rows that divide it?
 *
 * Both, because a load reaches a customer either way: the allocation carries
 * one customer, and splitting it puts the rest on the ledger rows.
 */
export function goesToFillingStation(
  customer: DeliveryCustomer | null | undefined,
  sales: DeliverySale[] = [],
  customers?: CustomerLookup,
): boolean {
  if (isFillingStation(customer)) return true
  if (!customers) return false
  return sales.some((s) => isFillingStation(lookupCustomer(customers, s.customerId)))
}

/**
 * Is there a rate or a payment on this sale?
 *
 * A ledger row can exist with neither — assigning a customer to a truck
 * writes one before any figure is known — and that is not yet a sale. The
 * negative leg of a transfer is money leaving, so its amount is read as an
 * absolute: a truck whose surplus was moved away was still sold.
 */
export function hasMoneyOn(sale: DeliverySale): boolean {
  return toNum(sale.rate) > 0 || Math.abs(toNum(sale.paymentAmount)) > 0
}

// ── Field resolution ──────────────────────────────────────────────────────

export interface ResolveContext {
  truck?: FleetTruck | null
  customer?: DeliveryCustomer | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pfi?: any
  /** The sales-ledger entries already matched to this allocation. */
  sales?: DeliverySale[]
  /**
   * Every customer, keyed by id — so the customers on a SPLIT load can be
   * read too. Without it only the allocation's own customer is known, and a
   * load split between two filling stations would look unsold.
   */
  customers?: CustomerLookup
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
  const status = statusOf(entry, sales, goesToFillingStation(ctx.customer, sales, ctx.customers))
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

// ── Money on a load ───────────────────────────────────────────────────────

export interface LoadMoney {
  /** What this load is worth: rate × quantity, or the ledger's own figure. */
  expected: number
  paid: number
  /** expected − paid. Positive is owed to us; negative is an overpayment. */
  balance: number
}

/**
 * What a load is worth and what has come in against it.
 *
 * The same arithmetic useLedgerGroups does, over a split rather than over the
 * ledger's rows, so the batch table and the sales ledger cannot report
 * different money for the same truck. Per customer, because a split load is
 * two sales at two rates and summing the truck as one would be neither.
 *
 * `salesValue` wins over rate × quantity where the ledger carries it: it is
 * the figure actually billed, and the two disagree on loads whose quantity
 * was later corrected.
 *
 * A load nobody has priced is worth nothing here, not "unknown" — every
 * caller sums these, and a batch's value is the part of it that has been
 * priced. What has NOT been priced is legible from the quantity beside it.
 */
export function loadMoney(split: LoadSplit, fallbackRate = 0): LoadMoney {
  if (split.shares.length === 0) {
    // Nobody on it yet. A rate typed onto the allocation still prices it.
    const expected = fallbackRate > 0 ? fallbackRate * split.total : 0
    return { expected, paid: 0, balance: expected }
  }

  return split.shares.reduce<LoadMoney>((acc, share) => {
    const m = shareMoney(share, fallbackRate)
    return {
      expected: acc.expected + m.expected,
      paid: acc.paid + m.paid,
      balance: acc.balance + m.balance,
    }
  }, { expected: 0, paid: 0, balance: 0 })
}

/** One customer's line of a load, priced the same way as the whole. */
export function shareMoney(share: LoadShare, fallbackRate = 0): LoadMoney {
  const billed = share.payments.reduce((mx, s) => Math.max(mx, toNum(s.salesValue)), 0)
  const rate = share.rate > 0 ? share.rate : fallbackRate
  const expected = billed > 0 ? billed : (rate > 0 ? rate * share.quantity : 0)
  return { expected, paid: share.totalPaid, balance: expected - share.totalPaid }
}
