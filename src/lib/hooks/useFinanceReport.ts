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

/**
 * HOW a payment came to be attached to its order — the provenance question,
 * which is not the same as whether a bank line exists.
 *
 * Until this was recorded (Sman-Backend migration 0023), a line a colleague
 * matched by hand and one the old oldest-credit-first wallet walk picked on
 * its own rendered identically on this report. They are not the same fact and
 * the page no longer pretends they are.
 */
export type ConfirmationBasis =
  /** A person named this bank line for this order. Checkable against a statement. */
  | 'bank_matched'
  /** The bank line is real; a migration chose which order it settles. */
  | 'bank_inferred'
  /** The old wallet walk picked a deposit. No bank line at all. */
  | 'auto_allocated'
  /** No funding record ever existed; the amount is the order's own figure. */
  | 'no_record'
  /** A person moved surplus between orders deliberately. */
  | 'transfer_desk'
  /** A migration converted an old wallet draw into a transfer. Nobody chose it. */
  | 'transfer_auto'
  | 'unknown'

/** What the report prints for each basis. Mirrors the server's own labels. */
export const CONFIRMATION_BASIS_LABEL: Record<ConfirmationBasis, string> = {
  bank_matched: 'Matched to bank statement by staff',
  bank_inferred: 'Bank line real — order chosen by the system',
  auto_allocated: 'Auto-allocated from wallet — no bank line',
  no_record: 'No payment record exists',
  transfer_desk: 'Transfer recorded by staff',
  transfer_auto: 'Transfer auto-created by the system',
  unknown: 'Unknown',
}

/** Short form, for a chip in a table cell where the full label will not fit. */
export const CONFIRMATION_BASIS_SHORT: Record<ConfirmationBasis, string> = {
  bank_matched: 'Bank · staff',
  bank_inferred: 'Bank · system chose order',
  auto_allocated: 'Auto-allocated',
  no_record: 'No record',
  transfer_desk: 'Transfer · staff',
  transfer_auto: 'Transfer · system',
  unknown: 'Unknown',
}

/** The two an external auditor can tie to a statement line. */
export const VERIFIABLE_BASES: ConfirmationBasis[] = ['bank_matched', 'bank_inferred']

/** Bases where no person chose the attribution — software did. */
export const SYSTEM_DECIDED_BASES: ConfirmationBasis[] = [
  'bank_inferred', 'auto_allocated', 'no_record', 'transfer_auto', 'unknown',
]

export function isSystemDecided(basis: ConfirmationBasis | null | undefined): boolean {
  return !!basis && SYSTEM_DECIDED_BASES.includes(basis)
}

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

  /** How this payment came to be on this order. See ConfirmationBasis. */
  confirmationBasis: ConfirmationBasis
  /**
   * Who has since examined a system-made attribution and vouched for it.
   *
   * Deliberately alongside confirmationBasis rather than replacing it: how the
   * payment got here and who signed it off afterwards are two different facts.
   * Overwriting the first with the second is what migration 0021 did, and it is
   * why nobody could tell a decision a person made from one the software made.
   */
  reviewedAt: string | null
  reviewNote: string
  reviewerFirstName: string | null
  reviewerSurname: string | null

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
  /**
   * What a transfer leg's money originally was, at the bank.
   *
   * A transfer leg has no statement line of its own, so its date, payer and
   * reference columns were empty — which next to real statement rows read as
   * corrupt data rather than as "this money arrived on the other order's bank
   * line". These carry that line's payer and reference across, and are null
   * where the source order had several payers and naming one would be a guess.
   */
  originDepositor: string | null
  originBankRefs: string | null
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
  /**
   * The bank statement's own figure — money paid IN against this order, never
   * reduced by a transfer made afterwards.
   *
   * This is what the Amount Paid column shows and what a reconciliation ticks
   * off against the statement. It used to be netted, so an order that received
   * ₦163,350,000 and later moved ₦54,450,000 elsewhere displayed
   * ₦108,900,000 — a figure on no statement anywhere.
   */
  amountPaidIn: number
  /** Sales value less the bank figure, BEFORE any transfer. Positive is owed. */
  differential: number
  transferredIn: number
  /** Negative — money that left this order. */
  transferredOut: number
  /** Signed net of the two. */
  netTransfers: number
  /** What is left after the bank figure AND the transfers. Zero when settled. */
  balance: number
  /** What the order holds now, after transfers. */
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

  /**
   * The WEAKEST basis on the order — an order is only as auditable as its
   * least defensible payment, so one unaccountable row is not allowed to hide
   * behind a clean one.
   */
  confirmationBasis: ConfirmationBasis | null
  confirmationBasisLabel: string | null
  /** Every distinct basis on the order, so a mixed order can say so. */
  confirmationBases: ConfirmationBasis[]
  /**
   * No person chose how this order was funded — the system did. This is the
   * set of orders whose story nobody in the building can tell.
   */
  systemDecided: boolean
  /** Money on this order that an external auditor can check. */
  verifiableAmount: number
  /** System-decided AND nobody has vouched for it yet — the work queue. */
  needsReview: boolean

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
  /**
   * Narrow by who decided the attribution. 'system' is every order carrying a
   * payment nobody chose; 'staff' is the complement; a bare basis is exact.
   */
  confirmationBasis?: 'system' | 'staff' | ConfirmationBasis
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
  /** The bank statement total — what the Amount Paid column sums to. */
  totalAmountPaidIn: number
  /** Sales value against the bank figure, before any transfer. */
  totalDifferential: number
  /** Netted; zero over a window holding both ends of every transfer. */
  totalNetTransfers: number
  /** The outgoing side unsigned — how much money actually moved. */
  totalTransferredOut: number
  /** What the listed orders hold once transfers are accounted for. */
  totalReceived: number
  /** What is left after both. Zero on a fully settled window. */
  totalBalance: number
  /** Summed per order, never netted against shortfall — see the note below. */
  totalSurplus: number
  totalShortfall: number
  /** How much of the book an external audit can actually check. */
  reconciledCount: number
  unreconciledCount: number
  partPaidCount: number
  /**
   * Orders holding at least one payment the system attributed on its own.
   * Distinct from unreconciledCount: an order can have a genuine bank line and
   * still have had the order chosen for it by a migration.
   */
  systemDecidedCount: number
  /** Of those, how many nobody has vouched for yet. Shrinks as work is done. */
  needsReviewCount: number
  /** Naira backed by a bank statement line, whoever attributed it. */
  totalVerifiableAmount: number
  /** Naira with no bank line behind it at all. */
  totalUnverifiableAmount: number
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
  /**
   * A name here has to mean "this person did this". On the rows migration 0021
   * created, it did not.
   *
   * The backfill copied `recorded_by` off the underlying DEPOSIT, so all 17
   * auto-created transfers carry a staff name — 12 read as Oladaride Bilkis,
   * five as Abdulrasheed Zakari — for movements between orders that neither of
   * them made, and that nobody made: the migration converted them out of the
   * old oldest-credit-first wallet draws. Printing those names next to a
   * transfer is not a small inaccuracy, it is the report attributing a
   * money-movement decision to a person who never took it, and it is the
   * specific thing that made these rows impossible to account for.
   *
   * The same applies to an auto-allocated row: the name belongs to whoever
   * keyed the deposit in, not to anyone who chose which order it settled.
   *
   * So for anything the system decided, this returns nothing and the
   * confirmation basis speaks instead. A real staff decision still names its
   * author, which is the whole point of keeping the column.
   */
  if (isSystemDecided(p.confirmationBasis)) return ''
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
  // "Transfer to/from", not a bare order reference: on a row sitting under a
  // column headed Depositor, a bare "AM11595" reads as the name of whoever
  // paid, which is exactly what it is not.
  if (p.source === 'transfer_in') return `Transfer from ${p.counterpartOrderRef || 'another order'}`
  if (p.source === 'transfer_out') return `Transfer to ${p.counterpartOrderRef || 'another order'}`
  return p.depositor || shortDepositor(p.narration)
}

/**
 * The date to print against a payment, and whether it is a banking date.
 *
 * A statement payment has a real value date — when the money reached the
 * account. A transfer leg has none, because no bank was involved; what it has
 * is the day somebody moved it. Printing an empty cell there made a legitimate
 * row look like missing data, and quietly printing `createdAt` under a column
 * headed with a banking date would be worse — that is the exact substitution
 * migration 0017 exists to prevent. So the caller is told which it got.
 */
export function paymentDate(p: OrderPayment): { date: string | null; banking: boolean } {
  if (p.txnDate) return { date: p.txnDate, banking: true }
  if (isTransferLeg(p) && p.createdAt) return { date: p.createdAt, banking: false }
  return { date: null, banking: false }
}

/**
 * What a transfer leg says in the reference column.
 *
 * Its own identifier first — TRF-9 — because a transfer is a real, single
 * event with two legs, and both legs printing the same handle is what lets a
 * reader pair them up and cite one. That is the thing an auditor needs and the
 * one thing a transfer genuinely has.
 *
 * A bank reference is appended ONLY where the source order has exactly one
 * statement line, so it is unambiguous which payment the money came out of.
 * This used to append every reference on the source order: the three transfers
 * out of AM11589 each printed the same four references, which read as though
 * each transfer had come from all four lines. Nothing records which line a
 * transfer came out of — a transfer moves surplus, and surplus is not
 * attributable to a particular line — so where there is more than one, the
 * honest answer is to say nothing rather than list them all.
 */
export function transferOrigin(p: OrderPayment): string {
  const handle = p.transferId != null ? `TRF-${p.transferId}` : 'Transfer'
  const from = p.originBankRefs ? `from ref ${p.originBankRefs}` : ''
  return [handle, from].filter(Boolean).join(' · ')
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
 * Sales value against the BANK figure. Positive is still owed, negative is
 * more received than the order was worth.
 *
 * Deliberately unaffected by a transfer made afterwards — "does the bank money
 * match what we billed" has one answer, and moving a surplus elsewhere later
 * does not change it. What is left after transfers is `balance`, which is a
 * different question and has its own column.
 *
 * Computed server-side so the screen, the workbook and the PDF cannot each
 * arrive at their own version of it.
 */
export function orderDifferential(o: FinanceReportOrder): number {
  return o.differential
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

/**
 * The payments worth printing as their own row.
 *
 * Legacy rows are excluded. There are ~5,700 of them — every order confirmed
 * before payments were recorded against orders — and each one says the same
 * sentence: no bank record exists. Printed per row that is five thousand lines
 * of noise shouting at somebody trying to read a day's trading; the fact
 * belongs on the ORDER line instead, once, quietly, as a tag.
 *
 * Their money is not dropped. `legacyAmount` below puts it on the order row,
 * so the Amount Paid column still sums to what the order received.
 */
export function visiblePayments(o: FinanceReportOrder): OrderPayment[] {
  return o.payments.filter((p) => p.source !== 'legacy')
}

/** What an order was paid with no bank record behind it — 0 for most orders. */
export function legacyAmount(o: FinanceReportOrder): number {
  return o.payments.filter(isUnreconciled).reduce((sum, p) => sum + p.amount, 0)
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

/**
 * Vouch for an attribution the system made on its own.
 *
 * Not a correction and not a reversal — no money moves. Reversal was the first
 * instinct and the data ruled it out: none of the auto-created transfers or
 * inferred bank lines can be undone without dropping an already-released,
 * already-ticketed order below its own value. What was actually missing was a
 * person's name and a reason against the decision, which is what this records.
 *
 * The payment keeps its confirmationBasis. The report goes on saying the system
 * made the original call, and adds who has since stood behind it.
 */
export function useReviewOrderPayment() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (vars: { orderId: number; paymentId: number; note: string }) => {
      const res = await api.post(
        `/orders/${vars.orderId}/payments/${vars.paymentId}/review`,
        { note: vars.note },
      )
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['finance-report'] })
      qc.invalidateQueries({ queryKey: ['order-payments'] })
      toast.success(data?.message || 'Payment vouched for')
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
}

/** Vouch for a movement between orders — both legs at once. */
export function useReviewOrderTransfer() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (vars: { orderId: number; transferId: number; note: string }) => {
      const res = await api.post(
        `/orders/${vars.orderId}/payments/transfer/${vars.transferId}/review`,
        { note: vars.note },
      )
      return res.data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['finance-report'] })
      qc.invalidateQueries({ queryKey: ['order-payments'] })
      toast.success(data?.message || 'Movement vouched for')
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
