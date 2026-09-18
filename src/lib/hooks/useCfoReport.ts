import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

/**
 * The CFO report — one block per day, one row per batch.
 *
 * Every figure is computed on the server by
 * Sman-Backend/services/cfoReport.service.js, which carries the full account
 * of where each column comes from. What matters on this side is the shape of
 * a row, and there are three layers to it:
 *
 *   computed   what the book says, untouched
 *   overrides  what somebody typed over it, or null where nobody has
 *   the row    the effective value the sheet actually prints
 *
 * All three are sent. The screen shows the effective figure, marks the cell
 * when it has been corrected, and shows the computed one underneath — the
 * difference between a correction and a number nobody can account for.
 */

/** A quantity or a naira figure a person may type over. */
export type CfoOverrideField =
  | 'initialQty'
  | 'cumulativeVolume'
  | 'dayVolume'
  | 'salesValue'
  | 'bankInflow'

/**
 * The columns that can be corrected, in the order they appear on the sheet.
 *
 * Stock balance and surplus/deficit are deliberately absent. They are derived
 * from the cells beside them —
 *
 *     stock balance   = initial qty − cumulative sales volume
 *     surplus/deficit = bank inflow − sales value to date
 *
 * — and letting them be typed independently would let a sheet go out on which
 * the numbers in a row do not add up to the number at the end of it. Correct
 * an input; the answer follows.
 */
export const CFO_OVERRIDE_FIELDS: CfoOverrideField[] = [
  'initialQty',
  'cumulativeVolume',
  'dayVolume',
  'salesValue',
  'bankInflow',
]

/** What the system holds, before anybody corrected anything. */
export interface CfoComputed {
  initialQty: number
  cumulativeVolume: number
  dayVolume: number
  salesValue: number
  bankInflow: number
  /**
   * Of that inflow, how much a bank statement line actually stands behind.
   *
   * The rest is legacy wallet-era money and transfers between orders — real,
   * recorded, and not checkable against a statement. Shown as a second figure
   * rather than folded in, because "₦33.5bn received" and "₦30.9bn of it
   * verifiable" are two different assurances.
   */
  statementInflow: number
  stockBalance: number
  surplusDeficit: number
}

export interface CfoRow {
  pfiId: number
  pfiNumber: string
  locationName: string
  productName: string
  /** 'Litres' or 'kg'. Quantities are never totalled across two of these. */
  productUnit: string
  status: string
  pfiType: string
  date: string

  initialQty: number
  cumulativeVolume: number
  dayVolume: number
  salesValue: number
  bankInflow: number
  /** Derived. Always initialQty − cumulativeVolume, override or not. */
  stockBalance: number
  /** Derived. Always bankInflow − salesValue. Negative is money still owed. */
  surplusDeficit: number

  /** Confirmed orders on the batch to this date, and on this date. */
  orders: number
  dayOrders: number

  computed: CfoComputed
  /** Which cells a person has typed over. Empty on an untouched row. */
  edited: CfoOverrideField[]
  remarks: string
  updatedBy: number | null
  updatedByName: string | null
  updatedAt: string | null
}

/**
 * A totals row.
 *
 * Money is a plain sum. Quantities are kept per unit, because the book holds
 * litres and kilogrammes side by side and adding 160,000 kg of LPG to
 * 26,992,931 L of petrol produces a number that is not a quantity of anything.
 */
export interface CfoUnitTotals {
  unit: string
  initialQty: number
  cumulativeVolume: number
  dayVolume: number
  stockBalance: number
}

export interface CfoTotals {
  rows: number
  salesValue: number
  bankInflow: number
  surplusDeficit: number
  orders: number
  dayOrders: number
  byUnit: Record<string, CfoUnitTotals>
  /**
   * Volume actually moved across the whole period, per unit — the one figure
   * that genuinely sums across days. Present on the report total only.
   */
  periodByUnit?: Record<string, number>
}

export interface CfoDay {
  date: string
  rows: CfoRow[]
  totals: CfoTotals
}

export interface CfoMeta {
  dateFrom: string
  dateTo: string
  /** Africa/Lagos. Every day on this report is a Lagos calendar day. */
  timezone: string
  batches: Array<{ id: number; pfiNumber: string; locationName: string; status: string }>
  /**
   * Money this report drops and the audited finance report keeps.
   *
   * Migration 0021 gave orders that RECEIVED a transfer both the transfer and
   * a duplicate placeholder for the same amount. The finance report has been
   * audited against those figures and does not move; this report reads past
   * them and says by how much, so the two documents reconcile line by line
   * instead of silently disagreeing.
   */
  duplicatesExcluded: number
  duplicateRows: number
  /**
   * Money on part-paid orders, counted on NEITHER side of this report.
   *
   * A part-paid order is not a confirmed sale, so its litres and its value are
   * absent — and its money has to be absent too, or the surplus column would
   * show cash against sales that were never booked. Excluding both sides is
   * right; excluding them silently is not.
   */
  partPaidHeld: number
  partPaidOrders: number
}

export interface CfoReport {
  days: CfoDay[]
  /** The position on the LAST day of the range — cumulative columns already are. */
  totals: CfoTotals
  meta: CfoMeta
}

export interface CfoReportParams {
  dateFrom: string
  dateTo: string
  depotId?: string | number
  pfiId?: string | number
  /** Every batch that had started by the date, not only the ones trading. */
  includeAll?: boolean
}

/**
 * Unpaginated by design — the whole range in one fetch, because the document
 * is read and exported as a whole. The server caps the range at 366 days.
 */
export function useCfoReport(params: CfoReportParams, enabled = true) {
  return useQuery({
    queryKey: ['cfo-report', params],
    enabled: enabled && !!params.dateFrom && !!params.dateTo,
    queryFn: async () => {
      const res = await api.get('/cfo-report', {
        params: { ...params, includeAll: params.includeAll ? 'true' : undefined },
      })
      return res.data?.data as CfoReport
    },
    placeholderData: (prev) => prev,
  })
}

export interface CfoEntryPayload {
  reportDate: string
  pfiId: number
  remarks?: string
  initialQty?: number | null
  cumulativeVolume?: number | null
  dayVolume?: number | null
  salesValue?: number | null
  bankInflow?: number | null
}

/**
 * Save a correction against one batch on one date.
 *
 * A key sent as null CLEARS that override and hands the cell back to the
 * computed figure; a key left out entirely leaves whatever is saved alone.
 * Callers must build the payload from the fields they mean to change, never
 * by spreading a whole form — spreading sends every untouched field as
 * undefined at best and 0 at worst.
 */
export function useSaveCfoEntry() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (payload: CfoEntryPayload) => {
      const res = await api.put('/cfo-report/entries', payload)
      return res.data?.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cfo-report'] })
      toast.success('Saved')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

/** Drop every correction on a row, putting it back to what the system says. */
export function useResetCfoEntry() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ reportDate, pfiId }: { reportDate: string; pfiId: number }) => {
      const res = await api.delete('/cfo-report/entries', { params: { reportDate, pfiId } })
      return res.data?.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cfo-report'] })
      toast.success('Row reset to the system figures')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

// ── Reading a row ───────────────────────────────────────────────────────────

/** Has anybody typed over this row at all — a figure or a remark? */
export function isCorrected(row: CfoRow): boolean {
  return row.edited.length > 0 || !!row.remarks
}

/**
 * How much of a row's inflow an external auditor could check.
 *
 * Null once the inflow has been overridden: the statement-backed portion is a
 * property of the payment rows the system found, and it says nothing about a
 * figure somebody typed in. Printing it beside a corrected total would be
 * quoting evidence for a number that evidence does not cover.
 */
export function verifiableShare(row: CfoRow): number | null {
  if (row.edited.includes('bankInflow')) return null
  if (row.computed.bankInflow <= 0) return null
  return row.computed.statementInflow / row.computed.bankInflow
}

/** The quantity units present in a set of totals, litres first. */
export function unitsOf(totals: CfoTotals | undefined): string[] {
  const units = Object.keys(totals?.byUnit || {})
  return units.sort((a, b) => (a === 'Litres' ? -1 : b === 'Litres' ? 1 : a.localeCompare(b)))
}
