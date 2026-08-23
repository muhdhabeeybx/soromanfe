import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { PaystackDetails } from '#/lib/types'

export type { PaystackDetails }

/** One credit deposit that contributed to an order's payment. */
export interface OrderFunding {
  depositId: number
  amount: string | number
  depositReference: string | null
  depositCreatedAt: string | null
  paystackDetails: PaystackDetails | null
  recorderFirstName: string | null
  recorderSurname: string | null
  /** Depositor named on the matched bank statement line — null if this deposit has no line. */
  statementDepositor?: string | null
  /** Value date on the matched bank statement line — when the money actually landed. */
  statementTxnDate?: string | null
}

export interface FinanceReportOrder {
  id: number
  orderNumber: string
  reference: string
  customerId: number
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
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
  return f.statementDepositor || ps.senderName || ps.depositorName || ''
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
 * The company on the row.
 *
 * Deliberately the customer's own saved company, never orders.companyName —
 * that one is typed at the point of order and drifts from the customer
 * record ("NNPC Retail" against a saved "NNPC"). A customer with no company
 * saved reads blank rather than borrowing whatever was typed that day.
 */
export function orderCompany(o: { customerCompanyName?: string | null }): string {
  return (o.customerCompanyName || '').trim()
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
