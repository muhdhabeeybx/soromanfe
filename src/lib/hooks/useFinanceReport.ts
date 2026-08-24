import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { PaystackDetails } from '#/lib/types'

export type { PaystackDetails }

/** One credit deposit that contributed to an order's payment. */
export interface OrderFunding {
  depositId: number
  /** The slice of the deposit FIFO attributed to this order — not what landed. */
  amount: string | number
  /** What the payment actually was, before any split across orders or surplus to wallet. */
  depositAmount?: string | number | null
  depositReference: string | null
  depositCreatedAt: string | null
  paystackDetails: PaystackDetails | null
  recorderFirstName: string | null
  recorderSurname: string | null
  /** Depositor named on the matched bank statement line — null if this deposit has no line. */
  statementDepositor?: string | null
  /** Value date on the matched bank statement line — when the money actually landed. */
  statementTxnDate?: string | null
  /** The deposit's own description — the only record of source for an internal wallet movement. */
  depositDescription?: string | null
  /** Customer the money came from, resolved from a "customer #N" in the description. */
  transferFromCustomerName?: string | null
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
  customerVirtualAccountNumber?: string | null
  customerVirtualAccountBank?: string | null
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
  virtualAccountNumber?: string | null
  virtualAccountBank?: string | null
  virtualAccountName?: string | null
  paymentStatus: 'Unpaid' | 'Paid'
  status: string
  paymentConfirmedAt?: string | null
  createdAt?: string
  /** One entry per credit deposit this order drew from — empty if untracked. */
  funding: OrderFunding[]
  /** false = this order predates the allocation ledger; not an error. */
  fundingTracked: boolean
  /** >0 only on a tracked order whose balance partly came from untracked deposits. */
  unattributedAmount: number
  /** The customer's wallet balance the instant before this order took its amount — null if undeterminable (order predates wallet-hold tracking). */
  walletBalanceBefore: number | null
  /** The customer's wallet balance the instant after. walletBalanceBefore − totalAmount. */
  walletBalanceAfter: number | null
}

export interface FinanceReportParams {
  search?: string
  paymentStatus?: 'Paid' | 'Unpaid' | 'all'
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
  trackedCount: number
  notTrackedCount: number
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

/**
 * Which way a funding entry's money came in.
 *
 * Paystack is not a live integration — this only classifies historical
 * deposit records that happen to carry that shape, it does not imply the
 * gateway is in use today. See FundingCard for where that distinction is
 * (deliberately) not surfaced any further.
 */
export function isPaystackFunding(f: OrderFunding): boolean {
  const ps = f.paystackDetails as Record<string, any> | null | undefined
  return Boolean(
    ps?.transactionId ||
    ps?.paystackCustomerCode ||
    (ps?.gatewayResponse && String(ps.gatewayResponse).toLowerCase() !== 'manual') ||
    (ps?.channel && ps.channel !== 'manual_bank_transfer' && ps.channel !== 'manual')
  )
}

/**
 * Which bank the money landed in, for one funding entry — the same
 * receiver-side fields for a manual transfer or a (legacy) Paystack DVA, so
 * this needs no branch on isPaystackFunding: whichever shape the record
 * carries, these are the fields that describe the receiving account.
 */
export function fundingBankInfo(f: OrderFunding): { bankName: string; accountNumber: string; accountName: string } {
  const ps = (f.paystackDetails || {}) as Record<string, any>
  return {
    bankName: ps.bankName || ps.receiverBankName || '',
    accountNumber: ps.accountNumber || ps.receiverAccountNumber || '',
    accountName: ps.accountName || ps.receiverAccountName || '',
  }
}

export function fundingRecorder(f: OrderFunding): string {
  return f.recorderFirstName ? `${f.recorderFirstName} ${f.recorderSurname || ''}`.trim() : ''
}

/**
 * Who actually paid the money in — the sender/depositor, not the receiver.
 *
 * The statement line comes first because it is the source of truth and is
 * populated for every matched deposit; the deposit's own JSON only began
 * carrying senderName recently, so on historical matches it is empty even
 * though the line behind them names the payer. The JSON still answers for
 * deposits typed in by hand, which have no line at all.
 */
export function fundingDepositor(f: OrderFunding): string {
  const ps = (f.paystackDetails || {}) as Record<string, any>
  return f.statementDepositor || ps.senderName || ps.depositorName || internalSource(f)
}

/**
 * Where an internal wallet movement came from, when no bank paid it in.
 *
 * A transfer between customers and an overpayment carried over from another
 * order both land as a deposit with no statement line and no reference, so
 * the report showed a bare dash in both the payer and reference columns —
 * looking like missing data when the source was in fact recorded, just only
 * ever in the free-text description.
 *
 * Two shapes appear there: "Wallet transfer from customer #1533", whose id
 * the server resolves to a name, and a typed note naming the order the
 * surplus came off ("Overpayment received from order #11169"). The first is
 * rewritten to read as a name; the second is already legible as written.
 */
function internalSource(f: OrderFunding): string {
  if (f.transferFromCustomerName && /from customer #/i.test(f.depositDescription || '')) {
    return `${f.transferFromCustomerName} (wallet transfer)`
  }
  return (f.depositDescription || '').trim()
}

/**
 * What this payment actually was — the deposit's own amount, not the slice
 * of it FIFO attributed to this order.
 *
 * The two differ whenever one payment covered several orders, or part of it
 * went to the wallet as surplus. Showing the attributed slice nets those
 * movements away silently, so a row could read less than the money that
 * genuinely arrived; showing the real figure leaves the differential against
 * sales value visible, which is the point of the column.
 */
export function fundingAmount(f: OrderFunding): number {
  return Number(f.depositAmount ?? f.amount ?? 0)
}

/** Sales value as the report computes it — rate × litres, not the stored total. */
export function orderSalesValue(o: FinanceReportOrder): number {
  return Number(o.price || 0) * Number(o.quantity || 0)
}

/**
 * What this order was actually paid — the money attributed to IT, which is
 * not the same thing as the deposits listed under it.
 *
 * fundingAmount (the Amount Paid column) deliberately shows each deposit in
 * full, because one payment can cover several orders and showing the slice
 * would hide money that genuinely arrived. That makes it the wrong basis for
 * a per-order differential: a ₦50m deposit covering five orders would show
 * every one of them ₦40m in surplus.
 *
 * So this sums `f.amount`, the slice FIFO attributed to this order, plus
 * `unattributedAmount` — the part of the balance that came from deposits
 * predating the allocation ledger.
 *
 * An order with no funding tracked at all has no per-deposit record to sum.
 * Its status is the only evidence available: Paid means the wallet hold
 * covered the total in full, so that is what it was paid.
 */
export function orderAmountPaid(o: FinanceReportOrder): number {
  if (!o.fundingTracked) {
    return o.paymentStatus === 'Paid' ? Number(o.totalAmount || 0) : 0
  }
  const attributed = o.funding.reduce((sum, f) => sum + Number(f.amount || 0), 0)
  return attributed + Number(o.unattributedAmount || 0)
}

/**
 * Sales value less what this order was paid.
 *
 * Positive is a shortfall — money still owed. Negative is an overpayment,
 * money received beyond the order's value. Normally zero on a paid order,
 * since an order is not marked Paid until its hold covers the total; it goes
 * nonzero when a total was corrected by hand after the fact, which is
 * precisely the case worth surfacing.
 */
export function orderDifferential(o: FinanceReportOrder): number {
  return orderSalesValue(o) - orderAmountPaid(o)
}

/**
 * What to show in the reference column. An internal movement has no bank
 * reference to show — it is named for what it is rather than left blank, so
 * an empty cell always means genuinely unknown.
 */
export function fundingReference(f: OrderFunding): string {
  if (f.depositReference) return f.depositReference
  return internalSource(f) ? 'Internal transfer' : ''
}

/**
 * When the money actually landed, ISO or null — the statement line's value
 * date ahead of the JSON's paidAt, for the same reason as fundingDepositor.
 * Falls back to when the deposit row was created, which is the only date a
 * hand-typed deposit has.
 */
export function fundingPaidAt(f: OrderFunding): string | null {
  const ps = (f.paystackDetails || {}) as Record<string, any>
  return f.statementTxnDate || ps.paidAt || ps.paymentDate || f.depositCreatedAt || null
}

/** "Zenith Bank · 1311924890" — the same "bank · account number" shape the Order DVA row already uses. */
export function fundingAccountPaidTo(f: OrderFunding): string {
  const { bankName, accountNumber } = fundingBankInfo(f)
  return [bankName, accountNumber].filter(Boolean).join(' · ')
}

/** "Zenith Bank · 1311924890 · JOHN DOE" — bank, account number and account name in one field. */
export function fundingPaidInto(f: OrderFunding): string {
  const { accountName } = fundingBankInfo(f)
  return [fundingAccountPaidTo(f), accountName].filter(Boolean).join(' · ')
}

/**
 * Where this order was paid into — its own dedicated virtual account, as
 * "Zenith Bank · 1312722134 · SOROMAN CALABAR". An order-level fact, not a
 * per-deposit one: it's the account the order itself names, which is why it
 * reads the same in the detail dialog's Order DVA row.
 */
export function orderPaidInto(o: {
  virtualAccountBank?: string | null
  virtualAccountNumber?: string | null
  virtualAccountName?: string | null
}): string {
  return [o.virtualAccountBank, o.virtualAccountNumber, o.virtualAccountName]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The company on the row — the one recorded on the order itself.
 *
 * This is the order-time value, not the customer's saved company: an order
 * is often placed on behalf of a specific company that isn't the one on the
 * customer record, and the report is a record of what was actually
 * transacted. Falls back to the customer's saved company only when the order
 * carries none of its own.
 */
export function orderCompany(o: { companyName?: string | null; customerCompanyName?: string | null }): string {
  return (o.companyName || o.customerCompanyName || '').trim()
}

/**
 * Point a paid order at the statement line(s) that actually paid for it.
 *
 * The correction for a wrong match that could not be undone: a MATCHED line
 * had no way back, so the report named the wrong payment for that order
 * permanently. The replaced line returns to the unmatched pool, ready to be
 * matched to the order it really belongs to.
 */
export function useRematchOrderFunding() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({
      orderId, bankAccountId, lineIds, description,
    }: {
      orderId: number | string
      bankAccountId: string | number
      lineIds: number[]
      description?: string
    }) => (await api.post(`/orders/${orderId}/rematch-funding`, { bankAccountId, lineIds, description })).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['finance-report'] })
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] })
      toast.success(res?.message || 'Payment re-matched')
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}
