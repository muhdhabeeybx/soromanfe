import type { DeliveryCustomer, DeliveryInventory, DeliverySale } from '#/lib/types'
import { idKey, isFillingStation, toNum } from '#/lib/sales-ledger-utils'

/**
 * One truck load, and how it was divided between customers.
 *
 * A truck is allocated once and can then be sold to several customers — 45,000
 * litres leaving the depot as 30,000 for one buyer and 15,000 for another. The
 * ledger records that as one sale row per customer, each carrying that
 * customer's share; the allocation row keeps the whole load in
 * `quantity_allocated`. Two different numbers with two different meanings, and
 * every screen that showed only one of them was showing a fraction of a truck
 * as if it were the truck.
 *
 * Worse, the stored total was not safe to trust on its own: Row Setup wrote the
 * quantity typed for one customer straight onto the shared allocation, so five
 * loads across four batches had their total quietly overwritten with one
 * customer's share — PFI-40B's KUJ228XC read 30,000 for a truck that carried
 * 45,000. That write is fixed at source, but the rows it already damaged are
 * repaired here as well: where the shares add up to more than the stored total,
 * the shares are the better record of what left the depot. On every one of the
 * five, the shares add up to exactly the truck's registered capacity.
 */

export interface LoadShare {
  /** '' when the sale has no customer against it yet. */
  customerId: string
  customerName: string
  /** This customer's share of the load. */
  quantity: number
  rate: number
  destination: string
  isFillingStation: boolean
  payments: DeliverySale[]
  totalPaid: number
}

export interface LoadSplit {
  /** One per customer on the load, in the order they were recorded. */
  shares: LoadShare[]
  /** More than one customer on this truck. */
  isSplit: boolean
  /** `quantity_allocated` as stored on the allocation. */
  allocated: number
  /** What the shares add up to. */
  assigned: number
  /** What the truck actually carried — the larger of the two. */
  total: number
  /** Loaded but not yet sold to anyone. Never negative. */
  unassigned: number
  /**
   * The shares exceed the stored allocation, so `total` came from the shares.
   * Either the load was over-assigned or the stored figure was overwritten.
   */
  understated: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CustomerLookup = { get: (key: any) => DeliveryCustomer | undefined } | null | undefined

/**
 * What one sale row says its volume was.
 *
 * The `quantity` column is the weakest field on the row. Splitting a load
 * rewrites some of a customer's rows and leaves others behind, so a customer
 * can end up holding 45,000 on one row and 30,500 on the next two — and which
 * of them is stale differs case by case: BWR840XB's first row kept the old
 * whole-truck figure, KUJ243XC's later rows picked up a wrong one.
 *
 * The money on the row settles it. A row carrying both a rate and a sales
 * value states its volume twice, and the second statement is the one the
 * ledger actually bills against, so where they disagree the money wins.
 * Filling-station rows — hundreds of small dispensings at a real rate — are
 * unaffected: their two figures already agree.
 */
function quantityOf(sale: DeliverySale): number {
  const quantity = toNum(sale.quantity)
  const rate = toNum(sale.rate)
  const salesValue = toNum(sale.salesValue)
  if (rate > 0 && salesValue > 0) {
    const implied = salesValue / rate
    // A litre of tolerance: these are floats, and rounding is not a discrepancy.
    if (Math.abs(implied - quantity) > 1) return implied
  }
  return quantity
}

/**
 * A customer's share is the LARGEST quantity across their sale rows, never the
 * sum: every follow-up payment repeats the load's quantity, so adding them up
 * reported a 45,000 L share as 135,000 once it had been paid in three parts.
 */
export function buildLoadSplit(
  loading: DeliveryInventory | null | undefined,
  sales: DeliverySale[],
  customers?: CustomerLookup,
): LoadSplit {
  const lookup = (id: string): DeliveryCustomer | null => {
    if (!id || !customers) return null
    return customers.get(id) || customers.get(Number(id)) || null
  }

  const byCustomer = new Map<string, LoadShare>()

  for (const sale of sales) {
    const cid = idKey(sale.customerId)
    const existing = byCustomer.get(cid)
    const customer = lookup(cid)
    const fillingStation = isFillingStation(customer)
    const name = customer?.name || sale.customerName || ''
    const destination = fillingStation
      ? (customer?.name || sale.customerName || '')
      : (sale.location || '')

    if (existing) {
      existing.quantity = Math.max(existing.quantity, quantityOf(sale))
      existing.rate = Math.max(existing.rate, toNum(sale.rate))
      if (!existing.customerName && name) existing.customerName = name
      if (!existing.destination && destination) existing.destination = destination
      existing.payments.push(sale)
      existing.totalPaid += toNum(sale.paymentAmount)
    } else {
      byCustomer.set(cid, {
        customerId: cid,
        customerName: name,
        quantity: quantityOf(sale),
        rate: toNum(sale.rate),
        destination,
        isFillingStation: fillingStation,
        payments: [sale],
        totalPaid: toNum(sale.paymentAmount),
      })
    }
  }

  // Insertion order, not largest-first: this is the order the customers were
  // recorded on the load, and the ledger lists its rows the same way.
  const shares = [...byCustomer.values()]
  const allocated = toNum(loading?.quantityAllocated)
  const assigned = shares.reduce((sum, s) => sum + s.quantity, 0)

  /*
   * The load is the larger of what was allocated and what was sold off it. A
   * truck cannot deliver more than it carried, so shares adding up to more
   * than the stored figure mean the stored figure is the one that is wrong —
   * either overwritten by the old Row Setup bug, or never filled in at all on
   * the allocations that came over from the previous system carrying a zero.
   */
  const understated = assigned > allocated
  const total = Math.max(allocated, assigned)

  return {
    shares,
    isSplit: shares.length > 1,
    allocated,
    assigned,
    total,
    unassigned: Math.max(0, total - assigned),
    understated,
  }
}

/** "30,000 + 15,000" — the shares as they read on a row. */
export function formatShareBreakdown(split: LoadSplit): string {
  if (!split.isSplit) return ''
  const parts = split.shares.map(s => s.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 }))
  if (split.unassigned > 0) {
    parts.push(`${split.unassigned.toLocaleString(undefined, { maximumFractionDigits: 0 })} unassigned`)
  }
  return parts.join(' + ')
}

/** "Kano FS 30,000 L · Alkaleri FS 15,000 L" — for exports and tooltips. */
export function formatShareList(split: LoadSplit): string {
  if (!split.shares.length) return ''
  const parts = split.shares.map(s => {
    const name = s.customerName || 'Unassigned'
    return s.quantity > 0
      ? `${name} ${s.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`
      : name
  })
  if (split.unassigned > 0) {
    parts.push(`Unassigned ${split.unassigned.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`)
  }
  return parts.join(' · ')
}
