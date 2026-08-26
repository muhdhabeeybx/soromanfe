import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { PaystackDetails } from '#/lib/types'

export type { PaystackDetails }

/**
 * How money reached an order, as the allocation records it.
 *
 *   bank    a statement line matched to THIS order when it was confirmed —
 *           recorded at the line's face value, so it reconciles against the
 *           bank statement one line at a time
 *   wallet  a draw from balance already in the wallet, carrying the reference
 *           the money originally arrived under
 *   legacy  written before any of this was recorded, by a walk over the
 *           wallet oldest-credit-first. Nothing says why that credit and not
 *           another, and the report says so rather than implying otherwise.
 */
/**
 *   transfer_out  the other leg of a surplus moved to another order — a
 *                 NEGATIVE row, so the order it left nets down to what it
 *                 actually kept instead of sitting there looking overpaid
 */
export type FundingSource = 'bank' | 'wallet' | 'legacy' | 'transfer_out'

/** One credit deposit that contributed to an order's payment. */
export interface OrderFunding {
  depositId: number
  /**
   * What was RECEIVED against this order.
   *
   * On a bank row this is the statement line at face value — deliberately not
   * a slice of it. An 18,075,000 payment against a 10,224,500 order reads as
   * 18,075,000 here and the surplus lands in the Differential column, which
   * is what someone holding the statement is looking for.
   */
  amount: string | number
  /** What the order CONSUMED of it — capped at the order's own value. */
  appliedAmount?: string | number | null
  source?: FundingSource | null
  /**
   * What is left of this credit, or null where nothing tracks it.
   *
   * Tells a surplus still sitting in the wallet from one that has already
   * gone somewhere else — the difference between a real overpayment and a
   * pre-ledger credit whose remainder quietly paid for other orders.
   */
  depositRemaining?: string | number | null
  /** transfer_out only: the order the money went to. */
  toOrderId?: number | null
  toOrderRef?: string | null
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
  /** How many orders this one credit paid for. 1 for almost all of them. */
  sharedOrderCount?: number | null
  /** The order that took the largest share of it — where the statement line belongs. */
  primaryOrderId?: number | null
  primaryOrderRef?: string | null
}

/**
 * One bank credit behind an internal wallet transfer, as the statement has it.
 *
 * Present only where the credits reconcile to the transfer amount exactly —
 * the server drops an inexact set rather than guess. See traceWalletSources.
 */
export interface WalletStatementSource {
  depositId: number
  amount: number
  depositor: string
  narration: string
  txnDate: string | null
  reference: string
  recorderFirstName: string | null
  recorderSurname: string | null
}

/**
 * A credit that was sitting in the wallet when this order took its money.
 *
 * The server works back from the hold amount and date. Rendered through
 * walletStatementRows, which drops the wallet hop and shows only the bank
 * credits behind it.
 */
export interface WalletSource {
  depositId: number
  amount: number
  createdAt: string | null
  description: string
  reference: string
  statementDepositor: string
  statementNarration: string
  statementTxnDate: string | null
  recorderFirstName: string | null
  recorderSurname: string | null
  transferFromCustomerId: number | null
  transferFromCustomerName: string
  /** The bank credits behind a wallet transfer, when they reconcile exactly. */
  statementSources: WalletStatementSource[]
  reconciled: boolean
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
  /** Traced wallet credits, for a wallet-funded order the ledger has nothing for. */
  walletSource: WalletSource[]
  /** A wallet hold exists — this was paid from wallet balance, tracked or not. */
  walletFunded: boolean
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
/**
 * Money that moved inside the business rather than arriving from a bank.
 *
 * A transfer between customers' wallets, or surplus carried off another
 * order. Both land as a deposit with no statement line and no reference,
 * because no bank payment happened — which is exactly what makes them
 * indistinguishable from missing data unless they are called out. The report
 * marks them so a reader can tell "no bank reference because none exists"
 * from "no bank reference because nobody filled it in".
 */
/**
 * How this money reached the order.
 *
 * Rows written before the source was recorded carry none, and are read as
 * 'legacy' — which is what they are: an oldest-credit-first guess with
 * nothing behind it. Never silently promoted to 'bank'; an unverifiable
 * attribution has to look unverifiable.
 */
export function fundingSource(f: OrderFunding): FundingSource {
  return f.source === 'bank' || f.source === 'wallet' ? f.source : 'legacy'
}

/**
 * A remainder carried off another order's bank credit.
 *
 * One credit can settle one order and leave a tail that pays for the next. The
 * report prints a row per (order, credit) pair, so that tail appeared under
 * the second order carrying the SAME bank reference as the first — which reads
 * as one statement line being spent twice.
 *
 * Legacy rows only, now. Where the source is recorded there is nothing to
 * infer: a wallet draw says it is a wallet draw and names the reference its
 * balance arrived under, which is both more specific than this and actually
 * checkable. This survives for the rows that predate that, where largest-share
 * remains the only clue available.
 */
export function carriedFromOrder(
  f: OrderFunding,
  orderId: number,
): { ref: string; orderId: number } | null {
  if (fundingSource(f) !== 'legacy') return null
  if (!f.sharedOrderCount || f.sharedOrderCount < 2) return null
  if (f.primaryOrderId == null || f.primaryOrderId === orderId) return null
  return { ref: f.primaryOrderRef || `#${f.primaryOrderId}`, orderId: f.primaryOrderId }
}

/**
 * Money that reached this order from inside the business rather than from a
 * bank payment made for it.
 *
 * A wallet draw is the recorded case: staff chose to put existing balance
 * toward this order. It still names the reference that balance originally
 * arrived under, so it is traceable — it is simply not a payment made against
 * THIS order, and totalling it as one would double-count the credit it came
 * from. Legacy rows fall back to reading their description, which for a
 * customer-to-customer transfer is the only record there is.
 */
export function isInternalTransfer(f: OrderFunding): boolean {
  if (fundingSource(f) === 'wallet' || fundingSource(f) === 'transfer_out') return true
  if (fundingSource(f) === 'bank') return false
  if (f.statementDepositor || f.depositReference) return false
  return /wallet transfer from customer|overpayment received from order/i.test(
    f.depositDescription || '',
  )
}

/**
 * What a wallet draw is drawing on — "Balance from 32923089257".
 *
 * The surplus of an overpayment stays in the wallet under the reference it
 * arrived with, so when it is later put toward another order the report can
 * name the bank payment it came out of instead of showing a bare dash, or
 * worse, an unexplained figure that appears on no statement.
 */
export function walletOriginLabel(f: OrderFunding): string {
  const ref = f.depositReference || ''
  if (ref) return `Balance from ${ref}`
  // A surplus moved off another order already writes that order's reference
  // into its own description ("From TRF FROM ORDER AG11212 — …"). Pulling it
  // out gives the incoming leg the same short name the outgoing leg uses, so
  // the pair reads as one movement instead of a tidy row facing a paragraph.
  const named = /TRF FROM ORDER\s+([A-Z0-9]+)/i.exec(f.depositDescription || '')
  if (named) return `From ${named[1].toUpperCase()}`
  const from = internalSource(f)
  return from ? `Balance — ${from}` : 'Balance from wallet'
}

/**
 * Where a surplus went — "Transferred to AA11214".
 *
 * The outgoing half of a movement whose incoming half was already on the
 * report. Order 11212 received ₦180m across three bank lines against a
 * ₦153.4m order and ₦26.6m of it was deliberately moved to order 11214 —
 * which the report showed on 11214 and nowhere else, leaving 11212 reading as
 * ₦26.6m overpaid with nothing to say otherwise.
 */
export function transferOutLabel(f: OrderFunding): string {
  return f.toOrderRef ? `Transferred to ${f.toOrderRef}` : 'Transferred to another order'
}

function internalSource(f: OrderFunding): string {
  if (f.transferFromCustomerName && /from customer #/i.test(f.depositDescription || '')) {
    return `${f.transferFromCustomerName} (wallet transfer)`
  }
  return (f.depositDescription || '').trim()
}

/**
 * A wallet-funded order's payment source, as one flat list of bank credits.
 *
 * The intermediate wallet hop is deliberately not rendered anywhere. Nobody
 * reconciling a payment wants to be told the money came "from wallet" or
 * "via a transfer from BALA" — they want the lines they can find on the bank
 * statement, so that is all that is returned: the credits themselves, in the
 * order the bank lists them.
 *
 * Where the chain cannot be resolved to statement lines, the wallet credit
 * itself is emitted as a single row carrying whatever it does name, rather
 * than nothing.
 */
export interface StatementRow {
  key: string
  depositor: string
  narration: string
  txnDate: string | null
  amount: number
  reference: string
  /** The staff member who keyed this credit in — not the payer. */
  recordedBy: string
}

/** A recorder's name from the two columns it arrives in, blank if unknown. */
function recorderName(first: string | null | undefined, last: string | null | undefined): string {
  return first ? `${first} ${last || ''}`.trim() : ''
}

export function walletStatementRows(order: FinanceReportOrder): StatementRow[] {
  const rows: StatementRow[] = []
  for (const w of order.walletSource ?? []) {
    if (w.statementSources.length > 0) {
      for (const s of w.statementSources) {
        rows.push({
          key: `s${s.depositId}`,
          depositor: shortDepositor(s.depositor),
          narration: s.narration || s.depositor || '',
          txnDate: s.txnDate,
          amount: s.amount,
          reference: s.reference,
          recordedBy: recorderName(s.recorderFirstName, s.recorderSurname),
        })
      }
      continue
    }
    // Nothing to trace to: show what the credit itself records.
    rows.push({
      key: `w${w.depositId}`,
      depositor: shortDepositor(w.statementDepositor) || w.transferFromCustomerName || w.description || '—',
      narration: w.statementNarration || w.description || '',
      txnDate: w.statementTxnDate || w.createdAt,
      amount: w.amount,
      reference: w.reference,
      recordedBy: recorderName(w.recorderFirstName, w.recorderSurname),
    })
  }
  return rows
}

/**
 * The payer's name out of a bank narration.
 *
 * Statement text is machine-written, long, and shaped differently by each
 * rail. Two slash shapes cover ~2,050 of the lines here and put the payer in
 * different fields, so they are handled separately rather than by one index:
 *
 *   NIP/FDP/DIMKPA INTEGRATED SERVICES/COB TRF …   -> field 3
 *   CIP CR/ JOE BROWN OIL TOOLS  amp  EQUIP/AT132  -> field 2
 *   NISS INFLOW/ACTION ENERGY LTD/United Bank …    -> field 2
 *
 * Taking field 3 from a CIP line yields the transaction id, not a name —
 * which is exactly what it did before this. Anything not matching a known
 * shape ("TRF FRM SAUDAT GLOBAL ENTERPRISE TO …") keeps its full text rather
 * than being sliced into nonsense.
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
 * What was received against THIS order through this payment.
 *
 * On a bank row that is the statement line at face value. It is the whole
 * point of the column: this report is audited by putting it beside a bank
 * statement, and a figure that has been netted down to what the order happened
 * to need appears on no statement anywhere. An 18,075,000 credit matched to a
 * 10,224,500 order reads 18,075,000, and the 7,850,500 surplus shows up in
 * Differential — where an auditor can see it and ask about it.
 *
 * On a wallet row it is what was drawn from balance, which is also what the
 * order consumed. The two only ever differ on a bank row, and only when a
 * payment overshot the order it was made for.
 */
export function fundingAmount(f: OrderFunding): number {
  return Number(f.amount ?? 0)
}

/** What the order actually consumed of this payment — see appliedAmount. */
export function fundingApplied(f: OrderFunding): number {
  return Number(f.appliedAmount ?? f.amount ?? 0)
}

/** Received against the order beyond what the order consumed. */
export function fundingSurplus(f: OrderFunding): number {
  if (fundingSource(f) !== 'bank') return 0
  return Math.max(0, fundingAmount(f) - fundingApplied(f))
}

/**
 * The part of a row's surplus that is demonstrably still in the wallet.
 *
 * A surplus is only an overpayment if the money is still there, and exactly
 * one thing on the record says so: the credit's own remainder. Where it is
 * null — a credit predating the allocation ledger — nothing is known, and
 * "nothing is known" must not resolve to "the customer is owed this".
 *
 * The direction here is deliberate and was wrong the first time. Deriving the
 * held figure as whatever was left over after the unexplainable part meant
 * every surplus with no explanation at all defaulted into money-we-owe:
 * ₦234.9m, against ₦13,975,500 actually sitting in wallets. Most of it was
 * duplicated legacy deposits (order OG10190 carries ₦48,420,000 and
 * ₦11,724,000 twice each) and orders whose rate × litres disagrees with their
 * stored total — neither of which is anybody's money.
 *
 * So held is now the conservative, evidence-backed side, and everything
 * unexplained falls to unaccounted, where it is visible and named.
 */
export function fundingHeldSurplus(f: OrderFunding): number {
  const surplus = fundingSurplus(f)
  if (surplus <= 0 || f.depositRemaining == null) return 0
  return Math.min(surplus, Number(f.depositRemaining))
}

/** Sales value as the report computes it — rate × litres, not the stored total. */
export function orderSalesValue(o: FinanceReportOrder): number {
  return Number(o.price || 0) * Number(o.quantity || 0)
}

/**
 * What this order was paid — every payment recorded against it, at the figure
 * the bank statement shows.
 *
 * This is the number the whole report is audited on, so it is the sum of the
 * rows printed underneath the order and nothing else: `f.amount` for each,
 * plus `unattributedAmount` for the part of an order's value that came from
 * balance predating the allocation ledger and has no row of its own.
 *
 * It no longer nets a bank credit down to the order's own value. That netting
 * is why 18,075,000 from TETRIS ENERGY on order 11453 was being reported as
 * 9,724,500 — a figure that appears nowhere in the bank, on a report whose
 * only job is to agree with the bank. The surplus is not hidden by making the
 * received figure smaller; it is shown, in Differential, as the overpayment
 * it is.
 *
 * An order with no funding tracked at all has no per-deposit record to sum.
 * Its status is the only evidence available: Paid means the wallet hold
 * covered the total in full, so that is what it was paid.
 */
export function orderAmountPaid(o: FinanceReportOrder): number {
  if (!o.fundingTracked) {
    return o.paymentStatus === 'Paid' ? Number(o.totalAmount || 0) : 0
  }
  // Receipts only. A surplus leaving for another order is a movement, not a
  // negative payment, and netting it in here made two things go wrong at once:
  // AG11212 read as fully paid when 180,000,000 had actually landed against a
  // 153,400,000 order, and the Amount Paid column stopped being a column of
  // money received that anyone could add up. The movement now lives in its own
  // Transfers column — see transferAmount — so this stays a plain total and
  // Differential shows the 26,600,000 for what it is.
  const received = o.funding
    .filter((f) => fundingSource(f) !== 'transfer_out')
    .reduce((sum, f) => sum + fundingAmount(f), 0)
  return received + Number(o.unattributedAmount || 0)
}

/**
 * Money moving between orders, kept out of Amount Paid.
 *
 * Negative where a surplus leaves, positive where it lands, so the column is a
 * self-contained record of internal movement that nets to zero over any period
 * containing both ends of a movement — checkable on its own, without disturbing
 * the payment figures beside it.
 */
export function transferAmount(f: OrderFunding): number {
  const source = fundingSource(f)
  if (source === 'transfer_out') return fundingAmount(f)
  // The incoming leg: a wallet credit whose description names the order the
  // surplus came off. It counts as money this order received, so it stays in
  // Amount Paid — it appears here too, as the other half of the movement.
  if (source === 'wallet' && /TRF FROM ORDER/i.test(f.depositDescription || '')) {
    return fundingAmount(f)
  }
  return 0
}

/**
 * Money the order was paid that has no funding row to sit on.
 *
 * Two cases, and between them they are why summing the Amount Paid column in
 * Excel came up short of the report's own total: an order with no allocations
 * at all contributes its whole value to the total and prints no sub-rows, and
 * a tracked order's untraced balance had nowhere to appear either. Both now
 * get a row, so the column adds up to the total above it.
 */
/**
 * When payment tracking actually began.
 *
 * The deposits ledger has no rows before June 2026 and no order carried an
 * allocation until then; July is the first month where every paid order has
 * one (966 paid orders since, exactly one untracked). Orders confirmed before
 * this date were marked Paid without any payment ever being recorded against
 * them — 4,682 of them, ~₦325bn.
 *
 * That figure is not a receipt and never came from a bank statement, so it
 * cannot be reconciled against one. The report keeps showing it — the orders
 * were paid, and zeroing them would invent ₦325bn of shortfall that nobody
 * owes — but says plainly what it is, so nobody spends another evening
 * hunting for it on a statement.
 */
export const PAYMENT_LEDGER_START = new Date('2026-07-01T00:00:00.000Z')

/**
 * Why an order has money with no funding row behind it.
 *
 *   pre-ledger  confirmed before payment tracking existed; nothing was ever
 *               recorded, and nothing can be. Expected, not a fault.
 *   unrecorded  confirmed after tracking began and still has no source —
 *               a real gap, and worth chasing.
 */
export function untracedReason(o: FinanceReportOrder): 'pre-ledger' | 'unrecorded' {
  if (o.fundingTracked) return 'unrecorded'
  const confirmed = o.paymentConfirmedAt ? new Date(o.paymentConfirmedAt) : null
  // No confirmation date at all puts an order in the same era: 801 of them,
  // every one created before tracking began.
  if (!confirmed || confirmed < PAYMENT_LEDGER_START) return 'pre-ledger'
  return 'unrecorded'
}

/** What the untraced row should be called, for whichever reason it exists. */
export function untracedLabel(o: FinanceReportOrder): string {
  return untracedReason(o) === 'pre-ledger'
    ? 'Pre-ledger — no payment recorded'
    : 'No recorded source'
}

export function untracedAmount(o: FinanceReportOrder): number {
  const paid = orderAmountPaid(o)
  const shown = o.fundingTracked
    ? o.funding
        .filter((f) => fundingSource(f) !== 'transfer_out')
        .reduce((sum, f) => sum + fundingAmount(f), 0)
    : walletStatementRows(o).reduce((sum, r) => sum + r.amount, 0)
  // Whatever the printed rows do not already account for. Deriving it as the
  // gap — rather than reading unattributedAmount directly — is what makes the
  // column sum to the total for BOTH kinds of order, including an untracked
  // one whose inferred wallet credits happen to cover part of it.
  return Math.max(0, paid - shown)
}

/**
 * Sales value less what this order was paid.
 *
 * Positive is a shortfall — money still owed. Negative is an overpayment:
 * more arrived against this order than it was worth, and the surplus is
 * sitting in the customer's wallet under the reference it came in on.
 *
 * That second case is now common and is meant to be. An order is not marked
 * Paid until its hold covers the total, so this column used to read zero
 * almost everywhere — because a payment larger than the order was quietly
 * trimmed to fit before it ever reached the report. It isn't any more, so an
 * overpayment shows here as a figure that can be checked against the
 * statement, which is the only way the surplus is ever noticed.
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

/**
 * Where a report's money actually differs from what it billed.
 *
 * The report gave a Sales Value, an Amount Paid and a net Differential, and
 * nothing in between — so a total that looked wrong could not be checked
 * against anything. On PFI 39/26 the figures were exact (11,008,317,654.50
 * billed, 169,552.50 overpaid across six orders, 11,008,487,207.00 received)
 * and still unverifiable by eye, because nothing said which six orders or by
 * how much.
 *
 * Every figure here is computed from the same orderAmountPaid the Differential
 * column uses, so the breakdown always adds back to the totals above it:
 *
 *     totalSalesValue - totalAmountPaid === shortTotal - overpaidTotal
 *                                      === netDifferential
 */
export interface PaymentBreakdown {
  /** Orders whose payment matches their sales value to the kobo. */
  exactCount: number
  overpaidCount: number
  /**
   * Positive: surplus received beyond what was billed AND still in the wallet.
   *
   * This used to be every naira of surplus, which made it ₦961m when the money
   * actually held was ₦17.7m — the rest being pre-ledger credits whose
   * remainder had long since paid for other orders. A figure nobody could act
   * on, sitting where the amount owed back to customers should be. The part
   * that cannot be accounted for now travels separately, below.
   */
  overpaidTotal: number
  /** Orders carrying surplus on a credit that predates the allocation ledger. */
  unaccountedCount: number
  /** Positive: surplus with no record of where it went. Not money owed to anyone. */
  unaccountedTotal: number
  shortCount: number
  /** Positive: how much is still owed. */
  shortTotal: number
  /** Funding entries that moved inside the business rather than from a bank. */
  internalCount: number
  internalTotal: number
  /** Positive is owed, negative is overpaid — the sum of the column. */
  netDifferential: number
}

export function paymentBreakdown(orders: FinanceReportOrder[]): PaymentBreakdown {
  const b: PaymentBreakdown = {
    exactCount: 0,
    overpaidCount: 0, overpaidTotal: 0,
    unaccountedCount: 0, unaccountedTotal: 0,
    shortCount: 0, shortTotal: 0,
    internalCount: 0, internalTotal: 0,
    netDifferential: 0,
  }

  for (const o of orders) {
    const d = orderDifferential(o)
    b.netDifferential += d
    // Half a kobo, so a rounding artefact never reports as a shortfall.
    if (Math.abs(d) < 0.005) b.exactCount += 1
    else if (d > 0) { b.shortCount += 1; b.shortTotal += d }
    else {
      const surplus = Math.abs(d)
      // Split, never double-counted: what the credits themselves prove is
      // still unspent, capped at the surplus the order actually shows —
      // everything else falls to unaccounted. The two halves always sum back
      // to the surplus, so the summary still reconciles exactly as before:
      // shortTotal − (overpaidTotal + unaccountedTotal) === netDifferential.
      const held = Math.min(
        surplus,
        o.funding.reduce((sum, f) => sum + fundingHeldSurplus(f), 0),
      )
      if (held > 0.005) { b.overpaidCount += 1; b.overpaidTotal += held }
      const unaccounted = surplus - held
      if (unaccounted > 0.005) { b.unaccountedCount += 1; b.unaccountedTotal += unaccounted }
    }

    for (const f of o.funding) {
      // Every kind of money that did not arrive from a bank on this order: a
      // wallet draw, a surplus leaving for another order, and (on legacy rows)
      // a remainder carried off another order's credit. They are the same
      // thing to a reader — money moved inside the business — and counting
      // only some of them understated it. Absolute value, so an outgoing leg
      // adds to the total moved rather than cancelling an incoming one.
      if (!isInternalTransfer(f) && !carriedFromOrder(f, o.id)) continue
      b.internalCount += 1
      b.internalTotal += Math.abs(fundingAmount(f))
    }
  }

  return b
}
