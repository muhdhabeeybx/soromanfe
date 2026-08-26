import { useQuery } from '@tanstack/react-query'
import api from '#/lib/api/http'

/**
 * One truck's passage through the gate.
 *
 * Anchored on entry, not exit: a truck that came in and has not left is the
 * one a security officer most needs to see, and a report keyed on exit hid
 * them completely. `exitedAt` stays null until it leaves.
 */
export interface GateMovement {
  id: number
  orderId: number
  truckIndex: number
  truckNumber: string | null
  quantity: string | number | null
  compartments: unknown
  gantry: string | null
  status: string
  /** The driver on the ticket when the load was allocated. */
  driverName: string | null
  driverPhone: string | null
  /** The driver who actually presented at the gate — often the same, not always. */
  entryDriverName: string | null
  entryDriverPhone: string | null
  loaderName: string | null
  loaderPhone: string | null
  enteredAt: string
  exitedAt: string | null
  loadedAt: string | null
  enteredByFirstName: string | null
  enteredBySurname: string | null
  exitedByFirstName: string | null
  exitedBySurname: string | null
  orderNumber: string | null
  companyName: string | null
  customerName: string | null
  customerPhone: string | null
  depotName: string | null
  productName: string | null
  pfiNumber: string | null
}

export interface GateTotals {
  entered: number
  exited: number
  /** Entered and not yet gated out — what is still inside. */
  onSite: number
  quantityEntered: number
  quantityExited: number
}

export interface GateMovementParams {
  dateFrom?: string
  dateTo?: string
  depotId?: string | number
  pfiId?: string | number
  search?: string
}

/**
 * The gate register for a period, in one request.
 *
 * This page used to fetch every order, guess which might hold a load in range,
 * then issue one `/orders/:id/trucks` call per candidate — dozens of
 * round-trips, which is the only reason it ever had a "Run report" button.
 * One endpoint does it now, so the page just shows today on arrival.
 */
export function useGateMovements(params: GateMovementParams) {
  return useQuery({
    queryKey: ['gate-movements', params],
    queryFn: async () => {
      // Mounted at /api/reports, not /api/reporting — the router file is
      // named reporting.route.js but app.js mounts it under "reports", and
      // nothing in the dashboard called it before this, so the mismatch had
      // never had a chance to show up.
      const res = await api.get('/reports/gate-movements', { params })
      return res.data?.data as { trucks: GateMovement[]; totals: GateTotals }
    },
    placeholderData: (prev) => prev,
  })
}

/** A staff name from the two columns it arrives in, blank if nobody is recorded. */
export function officerName(first: string | null, last: string | null): string {
  return first ? `${first} ${last || ''}`.trim() : ''
}

/**
 * Who was driving, preferring whoever actually turned up at the gate.
 *
 * The allocated driver and the one who presents can differ — a swap between
 * ticketing and arrival is routine. The gate's own record is the one that
 * matters for security; the ticket name travels alongside it rather than
 * replacing it, so a swap is visible instead of silently resolved.
 */
export function gateDriver(t: GateMovement): { name: string; phone: string; swapped: boolean } {
  const name = t.entryDriverName || t.driverName || ''
  const phone = t.entryDriverPhone || t.driverPhone || ''
  const swapped = Boolean(
    t.entryDriverName && t.driverName && t.entryDriverName.trim() !== t.driverName.trim(),
  )
  return { name, phone, swapped }
}

/** Litres on the load, as a number. */
export function gateQuantity(t: GateMovement): number {
  return Number(t.quantity || 0)
}

/** How long the truck was inside, or null while it is still there. */
export function timeOnSite(t: GateMovement): string | null {
  if (!t.exitedAt) return null
  const mins = Math.max(0, Math.round((new Date(t.exitedAt).getTime() - new Date(t.enteredAt).getTime()) / 60000))
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}
