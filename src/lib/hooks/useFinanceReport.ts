import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

/**
 * The finance report, as the bank statement has it.
 *
 * ── What this file used to be ──────────────────────────────────────────────
 *
 * Roughly six hundred lines of helpers that reconstructed meaning the server
 * could not state: which credit had paid for an order, whether a "surplus" was
 * real money or a bookkeeping artefact, whether a row was a bank payment or a
 * wallet draw dressed as one, and where a transfer had gone (recovered from a
 * sentence in a description field). None of it was the reader's fault and none
 * of it was reliable.
 *
 * The server now records the link when the payment is confirmed and sends it
 * flat: one row per payment, each carrying the statement line's own date,
 * payer, narration, reference and receiving account. So the helpers below read
 * fields rather than infer them, and the ones that inferred are gone.
 *
 * See Sman-Backend/db/migrations/0021_order_payments.sql.
 */

/**
 * How money reached an order.
 *
 *   statement     a bank statement line matched to THIS order. The only kind
 *                 an external auditor can verify, and the only kind the desk
 *                 can create.
 *   transfer_in   surplus moved onto this order from another.
 *   transfer_out  surplus moved off this order to another. NEGATIVE amount, so
 *                 an order that gave money away nets down to what it kept
 *                 instead of sitting there looking overpaid.
 *   legacy        recorded before payments were kept against orders. Carries
 *                 no bank evidence and is never presented as though it does.
 */
export type PaymentSource = 'statement' | 'transfer_in' | 'transfer_out' | 'legacy'

/** One payment recorded against an order. */
export interface OrderPayment {
  id: number
  orderId: number
  /** The bank row this payment IS. Null on a transfer leg or a legacy row. */
  statementLineId: number | null
  /** Signed: negative on the outgoing leg of a transfer. */
  amount: number
  source: PaymentSource

  // ── the statement line, verbatim ──
  /** Value date on the statement — when the money actually landed. */
  txnDate: string | null
  /** Who sent it, as the bank names them. */
  depositor: string
  narration: string
  /** The teller reference. What somebody holding the statement searches for. */
  bankRef: string
  bankName: string
  accountName: string
  accountNumber: string

  note: string
  createdAt: string
  transferId: number | null
  /** The staff member who recorded it — not the payer. */
  recorderFirstName: string | null
  recorderSurname: string | null
  /** On a transfer leg, the order at the other end. */
  counterpartOrderId: number | null
  counterpartOrderRef: string | null
  transferReason: string | null
}

export interface FinanceReportOrder {
  id: number
  orderNumber: string
  reference: string
  customerId: number
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  /** The company recorded on the order itself — what the report shows. */
  companyName?: string | null
  customerCompanyName?: string | null
  depotName?: string | null
  productId?: number | null
  productName?: string | null
  pfiId?: number | null
  pfiNumber?: string | null
  /** The location the selected PFI operates out of. */
  pfiLocationName?: string | null
  quantity: number
  price: string | number
  totalAmount: string | number
  deliveryType: 'delivery' | 'pickup'
  paymentStatus: 'Unpaid' | 'Part Paid' | 'Paid'
  amountPaid?: string | number
  status: string
  paymentConfirmedAt?: string | null
  createdAt?: string

  /** Every payment on this order, in banking-date order. */
  payments: OrderPayment[]
  /** What the order got, net of any surplus it has since given away. */
  received: number
  /** What settled the order's value. Never more than the value. */
  applied: number
  /** Money on this order beyond its value, still sitting on it. */
  surplus: number
  /** Money still owed on it. */
  shortfall: number
  /**
   * At least one bank statement line stands behind this order.
   *
   * The single most important flag on the report: it separates what an
   * external auditor can verify from what they cannot.
   */
  reconciled: boolean
  /** The account(s) the money was actually paid into. */
  paidInto: string[]
}

export interface FinanceReportParams {
  search?: string
  /**
   * Omitted means "money has landed" — the server reads that as Paid AND Part
   * Paid. Sending 'Paid' explicitly is narrower and excludes instalments, so
   * the two are genuinely different requests and the page offers both.
   */
  paymentStatus?: 'Paid' | 'Part Paid' | 'Unpaid' | 'all'
  /** Narrow to what an audit can check, or to what it cannot. */
  reconciliation?: 'reconciled' | 'unreconciled'
  dateFrom?: string
  dateTo?: string
  depotId?: string | number
  pfiId?: string | number
  productId?: string | number
}

export interface FinanceReportTotals {
  count: number
  totalAmount: number
  totalQuantity: number
  /** Money actually received against the listed orders. */
  totalReceived: number
  /** Summed per order, never netted against shortfall — see the note below. */
  totalSurplus: number
  totalShortfall: number
  /** How much of the book an external audit can actually check. */
  reconciledCount: number
  unreconciledCount: number
  partPaidCount: number
}

/**
 * Unpaginated by design — the whole filtered set in one fetch, newest first.
 * The default date filter the page applies (today) is what keeps this fast;
 * widening the range fetches more, on purpose.
 */
export function useFinanceReport(params: FinanceReportParams) {
  return useQuery({
    queryKey: ['finance-report', params],
    queryFn: async () => {
      const res = await api.get('/finance-report', { params })
      return res.data?.data as {
        orders: FinanceReportOrder[]
        totals: FinanceReportTotals
      }
    },
    placeholderData: (prev) => prev,
  })
}

// ── Reading one payment row ─────────────────────────────────────────────────

/** The staff member who recorded this payment, blank if unknown. */
export function paymentRecorder(p: OrderPayment): string {
  return p.recorderFirstName ? `${p.recorderFirstName} ${p.recorderSurname || ''}`.trim() : ''
}

/**
 * A payer's name out of a bank narration.
 *
 * Nigerian statement narrations put the sender in a different field depending
 * on the rail:
 *
 *   NIP/FDP/DIMKPA INTEGRATED SERVICES/COB TRF …   -> field 3
 *   CIP CR/ JOE BROWN OIL TOOLS  amp  EQUIP/AT132  -> field 2
 *   NISS INFLOW/ACTION ENERGY LTD/United Bank …    -> field 2
 *
 * Taking field 3 from a CIP line yields the transaction id, not a name.
 * Anything not matching a known shape ("TRF FRM SAUDAT GLOBAL ENTERPRISE TO …")
 * keeps its full text rather than being sliced into nonsense.
 */
export function shortDepositor(narration: string | null | undefined): string {
  // "&" arrives HTML-escaped and then stripped to a bare "amp" by whatever
  // wrote the statement; put it back before anyone reads it.
  const clean = (v: string) => v.replace(/\s+amp\s+/gi, ' & ').replace(/\s+/g, ' ').trim()

  const raw = (narration || '').trim()
  if (!raw) return ''
  const parts = raw.split('/')
  if (parts.length >= 3 && /^NIP\b/i.test(parts[0])) return clean(parts[2]) || clean(raw)
  if (parts.length >= 2 && /^(CIP|NISS)\b/i.test(parts[0])) return clean(parts[1]) || clean(raw)
  return clean(raw)
}

/**
 * Who paid this in, as the report should print it.
 *
 * The depositor column on the statement first, its narration second — the two
 * fields a bank fills in, in the order they can be trusted. A transfer leg
 * names the order at the other end instead, because that is genuinely where
 * the money came from or went. A legacy row has nobody to name, and says so
 * rather than borrowing a plausible name from somewhere else.
 */
export function paymentPayer(p: OrderPayment): string {
  if (p.source === 'transfer_in') return `From ${p.counterpartOrderRef || 'another order'}`
  if (p.source === 'transfer_out') return `To ${p.counterpartOrderRef || 'another order'}`
  return p.depositor || shortDepositor(p.narration)
}

/** The account the money landed in — "Zenith Bank · 1311924890". */
export function paymentPaidInto(p: OrderPayment): string {
  return [p.bankName, p.accountNumber].filter(Boolean).join(' · ')
}

/** Money that moved inside the business rather than arriving from a bank. */
export function isTransferLeg(p: OrderPayment): boolean {
  return p.source === 'transfer_in' || p.source === 'transfer_out'
}

/**
 * A row with no bank evidence behind it.
 *
 * Only ever true of a `legacy` row — an order confirmed before payments were
 * recorded against orders. The report marks these rather than filling their
 * bank columns with a plausible-looking guess, which is what it used to do.
 */
export function isUnreconciled(p: OrderPayment): boolean {
  return p.source === 'legacy'
}

// ── Reading one order ───────────────────────────────────────────────────────

/** Sales value as the report computes it — rate × litres, not the stored total. */
export function orderSalesValue(o: FinanceReportOrder): number {
  return Number(o.price || 0) * Number(o.quantity || 0)
}

/**
 * Positive means still owed, negative means surplus held on the order.
 *
 * One subtraction, from two figures the rows underneath already show. It used
 * to be assembled from a stored `amountPaid`, an inferred funding trail and a
 * regex over deposit descriptions, and those three could and did disagree.
 */
export function orderDifferential(o: FinanceReportOrder): number {
  return Number(o.totalAmount || 0) - o.received
}

/** The account(s) this order's money was paid into. */
export function orderPaidInto(o: FinanceReportOrder): string {
  return (o.paidInto || []).join(', ')
}

export function orderCompany(o: { companyName?: string | null; customerCompanyName?: string | null }): string {
  return o.companyName || o.customerCompanyName || ''
}

/** Net movement between orders on this one — negative if it gave money away. */
export function orderTransfers(o: FinanceReportOrder): number {
  return o.payments.filter(isTransferLeg).reduce((sum, p) => sum + p.amount, 0)
}

// ── The summary ─────────────────────────────────────────────────────────────

/**
 * Where a filtered set stands, in the four states an order can be in.
 *
 * Deliberately simpler than what it replaced. The old breakdown had to split
 * every surplus into "still held" and "unaccounted", because a surplus was
 * derived from an inferred funding trail and most of it turned out to be an
 * artefact — ₦961m of apparent overpayment against ₦17.7m actually held.
 *
 * A surplus is now `received − order value`, where received is the sum of
 * payments actually recorded against the order. There is nothing to split: it
 * is money that arrived, it is on this order, and it is either moved to another
 * order or refunded.
 */
export interface PaymentBreakdown {
  /** Orders whose payment matches their value to the kobo. */
  exactCount: number
  /** Orders holding money beyond their value. */
  surplusCount: number
  surplusTotal: number
  /** Orders still owed money. */
  shortCount: number
  shortTotal: number
  /** Orders with at least one bank statement line behind them. */
  reconciledCount: number
  /** Orders with none — nothing an external audit can verify. */
  unreconciledCount: number
  /** Legs of money moved between orders. */
  transferCount: number
  transferTotal: number
  /** Positive is owed, negative is surplus — the sum of the column. */
  netDifferential: number
}

export function paymentBreakdown(orders: FinanceReportOrder[]): PaymentBreakdown {
  const b: PaymentBreakdown = {
    exactCount: 0,
    surplusCount: 0, surplusTotal: 0,
    shortCount: 0, shortTotal: 0,
    reconciledCount: 0, unreconciledCount: 0,
    transferCount: 0, transferTotal: 0,
    netDifferential: 0,
  }

  for (const o of orders) {
    const d = orderDifferential(o)
    b.netDifferential += d
    // Half a kobo, so a rounding artefact never reports as a shortfall.
    if (Math.abs(d) < 0.005) b.exactCount += 1
    else if (d > 0) { b.shortCount += 1; b.shortTotal += d }
    else { b.surplusCount += 1; b.surplusTotal += -d }

    if (o.reconciled) b.reconciledCount += 1
    else b.unreconciledCount += 1

    for (const p of o.payments) {
      if (!isTransferLeg(p)) continue
      b.transferCount += 1
      // Absolute value: an outgoing leg adds to the total moved rather than
      // cancelling an incoming one.
      b.transferTotal += Math.abs(p.amount)
    }
  }

  return b
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Confirm payment on an order from the bank statement lines that paid for it.
 *
 * No amount is sent. The amount of a payment is the amount on the statement
 * line — a figure nobody types, so nobody can mistype it.
 */
export function useConfirmOrderPayment() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (vars: {
      orderId: number
      bankAccountId: number
      lineIds: number[]
      note?: string
    }) => {
      const res = await api.post(`/orders/${vars.orderId}/payments`, {
        bankAccountId: vars.bankAccountId,
        lineIds: vars.lineIds,
        note: vars.note,
      })
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['finance-report'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['payable-orders'] })
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
      qc.invalidateQueries({ queryKey: ['orders-with-surplus'] })
      toast.success(data?.message || 'Payment confirmed')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
}

/** Every payment on one order, with its bank details. */
export function useOrderPayments(orderId: number | null) {
  return useQuery({
    queryKey: ['order-payments', orderId],
    enabled: orderId != null,
    queryFn: async () => {
      const res = await api.get(`/orders/${orderId}/payments`)
      return res.data?.data as {
        payments: OrderPayment[]
        summary: {
          received: number
          orderTotal: number
          applied: number
          surplus: number
          shortfall: number
          reconciled: boolean
        }
      }
    },
  })
}

/**
 * Take a payment back off an order — it was matched to the wrong one.
 *
 * Its statement line returns to the unmatched pool, so it can be recorded
 * against the order it really belongs to. This is the correction path the old
 * model had none of: a MATCHED line could never be released, so a mis-match
 * was permanent and the report named the wrong payment for that order forever.
 */
export function useRemoveOrderPayment() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (vars: { orderId: number; paymentId: number; reason: string }) => {
      const res = await api.delete(`/orders/${vars.orderId}/payments/${vars.paymentId}`, {
        data: { reason: vars.reason },
      })
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['finance-report'] })
      qc.invalidateQueries({ queryKey: ['order-payments'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
      qc.invalidateQueries({ queryKey: ['orders-with-surplus'] })
      toast.success(data?.message || 'Payment removed')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
}

/** Move surplus from the order holding it to the order that needs it. */
export function useTransferOrderSurplus() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (vars: {
      fromOrderId: number
      toOrderId: number
      amount: number
      reason: string
    }) => {
      const res = await api.post(`/orders/${vars.fromOrderId}/payments/transfer`, {
        toOrderId: vars.toOrderId,
        amount: vars.amount,
        reason: vars.reason,
      })
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['finance-report'] })
      qc.invalidateQueries({ queryKey: ['order-payments'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['orders-with-surplus'] })
      toast.success(data?.message || 'Surplus moved')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
}

export interface OrderWithSurplus {
  id: number
  orderNumber: string
  companyName: string | null
  customerId: number
  customerName: string | null
  totalAmount: string
  paymentStatus: string
  received: string
  surplus: string
}

/** Orders currently holding money beyond their own value. */
export function useOrdersWithSurplus(params: { customerId?: number | null } = {}) {
  return useQuery({
    queryKey: ['orders-with-surplus', params],
    queryFn: async () => {
      const res = await api.get('/orders/with-surplus', {
        params: params.customerId ? { customerId: params.customerId } : undefined,
      })
      return (res.data?.data?.orders || []) as OrderWithSurplus[]
    },
  })
}
