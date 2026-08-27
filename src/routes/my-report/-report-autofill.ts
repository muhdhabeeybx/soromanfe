import { useQuery } from '@tanstack/react-query'
import { endOfDay, isWithinInterval, startOfDay } from 'date-fns'
import api from '#/lib/api/http'
import type { Order } from '#/lib/types'
import type { ReportType } from './-report-config'

const PAGE_LIMIT = 100

/** An order that actually reached a truck, as against one merely placed. */
export const LOADED_STATUSES = ['Loading', 'Completed']

/**
 * Every order created on one date, company-wide.
 *
 * Reports are filed per PFI, but the API has no "orders for this PFI on this
 * date" endpoint — only date-bounded listing. Fetching one day and grouping
 * client-side (by pfiId, by price, by customer) is what the Reports Hub and
 * the security report already do for the same reason.
 */
async function fetchOrdersForDate(date: string): Promise<Order[]> {
  const all: Order[] = []
  let page = 1
  while (true) {
    const res = await api.get('/orders', {
      params: { dateFrom: date, dateTo: date, page, limit: PAGE_LIMIT },
    })
    const { orders, pagination } = res.data.data as { orders: Order[]; pagination?: { pages?: number } }
    all.push(...orders)
    if (!pagination?.pages || page >= pagination.pages || orders.length < PAGE_LIMIT) break
    page++
  }
  return all
}

export function useDayOrders(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['daily-reports-day-orders', date],
    queryFn: () => fetchOrdersForDate(date),
    enabled: enabled && !!date,
  })
}

export const ordersForPfi = (orders: Order[], pfiId: string | number | null | undefined) => (
  pfiId ? orders.filter((o) => Number(o.pfiId) === Number(pfiId)) : []
)

export const loadedOrders = (orders: Order[]) => orders.filter((o) => LOADED_STATUSES.includes(o.status))

export const sumQuantity = (orders: Order[]) => orders.reduce((s, o) => s + Number(o.quantity || 0), 0)
export const countCustomers = (orders: Order[]) =>
  new Set(orders.map((o) => o.customerId).filter(Boolean)).size

/** Groups by unit price so a day sold at several prices seeds one band each. */
export function suggestPriceBands(orders: Order[]): Array<{ price: number; litres: number }> {
  const byPrice = new Map<number, number>()
  for (const o of orders) {
    const price = Math.round(Number(o.price || 0) * 100) / 100
    byPrice.set(price, (byPrice.get(price) || 0) + Number(o.quantity || 0))
  }
  return [...byPrice.entries()]
    .map(([price, litres]) => ({ price, litres }))
    .sort((a, b) => a.price - b.price)
}

export type TopCustomer = { name: string; phone: string; litres: number }

export function topCustomersFrom(orders: Order[], n = 5): TopCustomer[] {
  const byCustomer = new Map<number, TopCustomer>()
  for (const o of orders) {
    if (!o.customerId) continue
    const cur = byCustomer.get(o.customerId) || { name: o.customerName || '', phone: o.customerPhone || '', litres: 0 }
    cur.litres += Number(o.quantity || 0)
    byCustomer.set(o.customerId, cur)
  }
  return [...byCustomer.values()].sort((a, b) => b.litres - a.litres).slice(0, n)
}

export type TruckCounts = { entered: number; exited: number; loaded: number }

/**
 * The trucks behind a set of orders: how many were made ready, and how many
 * the gate saw in and out on the day.
 *
 * Read from the real truck records rather than hand-typed guesses. There is no
 * truck count on an order, so each one's trucks are fetched — N+1, but bounded
 * to a single PFI's or location's single day, which is the precedent the
 * security report set for exactly this data.
 *
 * Callers scope the orders themselves (by PFI, by location, by status), and
 * every caller scopes to something smaller than the whole company — a
 * company-wide day would be a request per order with nothing to show for it.
 */
export function useTruckCounts(orders: Order[] | undefined, date: string, enabled: boolean) {
  const ids = (orders || []).map((o) => o._id).sort()
  return useQuery({
    queryKey: ['daily-reports-truck-counts', date, ids],
    queryFn: async (): Promise<TruckCounts> => {
      const range = { start: startOfDay(new Date(date)), end: endOfDay(new Date(date)) }
      const batches = await Promise.all(
        ids.map((id) => (
          api.get(`/orders/${id}/trucks`)
            .then((r) => r.data.data.trucks || [])
            .catch(() => [])
        )),
      )
      let entered = 0
      let exited = 0
      let loaded = 0
      for (const trucks of batches) {
        for (const t of trucks as Array<{ securityEnteredAt?: string; securityExitedAt?: string }>) {
          loaded++
          if (t.securityEnteredAt && isWithinInterval(new Date(t.securityEnteredAt), range)) entered++
          if (t.securityExitedAt && isWithinInterval(new Date(t.securityExitedAt), range)) exited++
        }
      }
      return { entered, exited, loaded }
    },
    enabled: enabled && !!date && !!orders,
  })
}

/** Yesterday's report for the same PFI and role — the read-only reference
 * a product manager's "remarks from yesterday" line points at, and where the
 * sales manager's two settlement figures start from. */
export function useYesterdayReport(
  type: ReportType, location: string, pfiNumber: string, yesterday: string, enabled: boolean,
) {
  return useQuery({
    queryKey: ['daily-reports-yesterday', type, location, pfiNumber, yesterday],
    queryFn: async () => {
      const res = await api.get('/daily-reports', {
        params: { reportType: type, location, pfiNumber, dateFrom: yesterday, dateTo: yesterday, limit: 1 },
      })
      const reports = res.data.data.reports as Array<{ remarks?: string; differentials?: string | number }>
      return reports[0] || null
    },
    enabled: enabled && !!location && !!pfiNumber,
  })
}

/** Deposits unambiguously matched to this PFI — most of the book isn't
 * attributed yet (see the deposit repo), so this reads as a floor, not a
 * guaranteed total. */
export function usePfiDeposits(pfiId: string | number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['daily-reports-pfi-deposits', pfiId],
    queryFn: async () => {
      const res = await api.get('/deposits', { params: { pfiId, limit: 500 } })
      return res.data.data.deposits as Array<{ amount: string | number; createdAt?: string }>
    },
    enabled: enabled && !!pfiId,
  })
}
