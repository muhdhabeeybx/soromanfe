import { format } from 'date-fns'
import { unitNames } from '#/routes/pfi/-pfi-utils'
import {
  paymentRecorder, paymentPayer, paymentDate, transferOrigin,
  visiblePayments, legacyAmount, isTransferLeg,
  orderPaidInto, orderCompany, orderSalesValue, orderDifferential,
  type FinanceReportOrder, type OrderPayment, type CustomerDifferential,
} from '#/lib/hooks/useFinanceReport'
import {
  XL, PDF, NGN, QTY, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, SUMMARY_FILL,
  TOTAL_FILL, GRAND_TOTAL_FILL, HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, pdfNairaIso, applySatoshi, triggerDownload,
} from '#/lib/report-theme'

/**
 * Red is money still owed, green is money received beyond the bill.
 *
 * Deliberately NOT the theme's `paintSigned`, which colours by sign alone.
 * Every signed column here is order value MINUS money received, so a POSITIVE
 * number is a shortfall and has to read as the warning. Sign alone says the
 * opposite, and did: an overpaid order printed red in both exports while an
 * order still owing printed green — the exact inverse of the screen, on the
 * one report where colour is supposed to mean something.
 *
 * sales-ledger has the same inversion and its own `paintBalance` for exactly
 * this reason; the comment there warns about `paintSigned` explicitly.
 *
 * Transfers take neither colour. Money moving between two orders is not a gain
 * or a loss to anybody, and the screen has always shown it in the same blue
 * this uses.
 */
/**
 * Signed money, printed plain: no brackets, no minus, no colour code.
 *
 * NGN_SIGNED — which these columns used — carries `[Color10]` for positives
 * and `[Red](...)` for negatives INSIDE the number format. An Excel format's
 * own colour beats the cell font, so it painted every positive green and every
 * negative red whatever paintOwed set. That is the inversion itself, and the
 * reason correcting the font alone would never have shown up in the workbook.
 *
 * With the colour code gone the font wins and paintOwed decides. The brackets
 * go with it: colour carries the sign now, on screen and in both exports.
 */
const NGN_PLAIN = '₦#,##0.00;₦#,##0.00;₦0.00'

/**
 * The same money, with the direction kept.
 *
 * For the Transferred column only. NGN_PLAIN deliberately drops the sign
 * because colour carries it — right for a differential, where the question is
 * how much is owed and red already says which way. On a transfer the
 * direction IS the fact: in from another order, or out to one. A workbook is
 * also read printed and re-sorted, where the colour is gone and the row's
 * neighbours are not the ones it was filed next to, so the sign has to be in
 * the cell. No brackets — an accountant reads them as a minus and everybody
 * else reads them as a footnote.
 */
const NGN_SIGNED_PLAIN = '+₦#,##0.00;-₦#,##0.00;₦0.00'


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paintOwed(cell: any, value: number, key?: string) {
  const ink =
    key === 'transfers'
      ? (Math.abs(value) < 0.005 ? null : XL.internal)
      : value > 0.005
        ? XL.loss
        : value < -0.005
          ? XL.gain
          : null
  if (ink) cell.font = { ...(cell.font || {}), color: { argb: ink } }
}

/**
 * Amounts and quantities are written as real numbers with a cell format,
 * never as pre-formatted strings — a column that looks like money or litres
 * but is text cannot be summed, and summing a column is the first thing
 * anyone does with one of these sheets. Figures are always written out in
 * full — no "1.2bn" abbreviations — since a finance report is exactly the
 * place a rounded figure would be read as the real one.
 *
 * The palette, borders, fills, number formats and autotable presets all come
 * from lib/report-theme so this sheet and the station ledger look like they
 * came from the same company. They used to each define their own.
 */

export interface FinanceReportFilters {
  /** Human label — "Today", "This Week", "21 Aug 2026", etc. */
  periodLabel: string
  /** Short yyyy-MM-dd bounds, for the filename only — '' means all time. */
  dateFrom: string
  dateTo: string
  paymentStatus: string
  search: string
  locationName: string
  pfiNumber: string
  product: string
}

export interface FinanceReportSummary {
  count: number
  totalQuantity: number
  totalSalesValue: number
  /**
   * Everything the listed orders have been paid, transfers included — what
   * the summary means by "amount paid", and what Net Differential is measured
   * against.
   *
   * The table splits the same money across two columns, because a desk
   * reading one order needs to know which part a bank statement will show.
   * `totalBankPaid` + `totalTransferred` is this figure.
   */
  totalAmountPaid: number
  /** The Amount Paid column's own sum — bank lines and pre-ledger rows. */
  totalBankPaid: number
  /** The Transferred column's own sum. Zero over a window holding both ends. */
  totalTransferred: number
  /** Sales value less totalAmountPaid. Positive is owed, negative is overpaid. */
  totalDifferential: number
  /**
   * The PFI's tank quantity — `startingQtyLitres`, the measured figure that
   * landed in the tank.
   *
   * Printed as "Tank Quantity", the same words the PFI report and the PFI form
   * use, because it is the same number and two names for one figure is how a
   * reader ends up believing there are two. The field keeps its older name
   * only to avoid a rename across this module for no reader's benefit.
   *
   * Only meaningful — and only shown — when a single PFI is selected.
   */
  initialStock: number | null
  tankBalanceAfter: number | null
}

/** One row of the PFI Stock Summary block — every active PFI, stock and revenue side by side with the period's own sales. */
export interface PfiStockRow {
  pfiNumber: string
  locationName: string
  productName: string
  /**
   * The unit this batch is bought and sold in.
   *
   * Not decoration. LPG is kilograms and this block printed every figure as
   * litres regardless, so three cooking-gas batches reported kilograms under
   * a litre label — a wrong number, not a differently-worded one.
   */
  productUnit: string | null
  /** What measured into the tank when the batch landed. */
  initialStock: number
  /** Litres sold within the report's current filters — not all-time. */
  volumeSoldPeriod: number
  /**
   * What those litres were billed at, over the same filters.
   *
   * Volume alone cannot be read as performance: a period that moved more
   * litres at a worse price is not a better period, and the two columns beside
   * each other are what makes that visible at a glance.
   */
  salesValuePeriod: number
  volumeSoldAllTime: number
  volumeRemaining: number
  /** Every naira this batch has ever billed, not just the period's. */
  revenue: number
}

/**
 * The definitive column set — the on-screen table
 * (confirmed-payments/index.tsx) mirrors this exactly, same order, same set,
 * so what's on screen is always what comes out of the export.
 *
 * Each column declares which row kind fills it in: an order row carries the
 * order's own facts, a funding sub-row underneath it carries one payment.
 * `scope` is what drives the blank cells on both sides, rather than the
 * index arithmetic this used to do — that assumed the two groups were each
 * contiguous, which stopped being true once Paid Into landed between the
 * payment columns and Recorded By.
 *
 * "Amount Paid" is deliberately funding-only. The order row leaves it empty
 * so the column reads as a list of the actual payments received, with Sales
 * Value alongside as what was owed.
 *
 * "Differential" is order-scoped and is NOT Sales Value minus the Amount Paid
 * cells beneath it. Those show each deposit in full, and one deposit can
 * cover several orders — subtracting them would show every order in a shared
 * payment as massively overpaid. It is Sales Value minus the amount
 * ATTRIBUTED to this order; see orderDifferential. Positive means still
 * owed, negative means overpaid.
 */
type ColumnScope = 'order' | 'funding'
const COLUMNS: Array<{
  header: string
  key: string
  width: number
  fmt?: string
  scope: ColumnScope
  /** Green when positive, red when negative. Only for figures whose sign carries meaning. */
  signed?: boolean
}> = [
  { header: 'S/N', key: 'sn', width: 6, scope: 'order' },
  { header: 'Date', key: 'date', width: 13, scope: 'order' },
  { header: 'Order Reference', key: 'ref', width: 18, scope: 'order' },
  { header: 'PFI', key: 'pfi', width: 14, scope: 'order' },
  { header: 'Customer', key: 'customer', width: 24, scope: 'order' },
  { header: 'Company', key: 'company', width: 22, scope: 'order' },
  { header: 'Qty (Litres)', key: 'qty', width: 14, fmt: QTY, scope: 'order' },
  { header: 'Product', key: 'product', width: 14, scope: 'order' },
  { header: 'Rate', key: 'rate', width: 14, fmt: NGN, scope: 'order' },
  { header: 'Sales Value', key: 'salesValue', width: 16, fmt: NGN, scope: 'order' },
  { header: 'Deposit Date', key: 'depositDate', width: 13, scope: 'funding' },
  { header: 'Depositor', key: 'depositor', width: 22, scope: 'funding' },
  // Wide enough for a teller reference and for a transfer's own handle
  // ("TRF-9 · from ref 33531928491"), which both live in this column.
  { header: 'Bank Reference', key: 'depositRef', width: 30, scope: 'funding' },
  /**
   * Money the bank paid in against this order — a matched statement line, or
   * a pre-ledger record. Receipts only, never netted by a transfer made
   * afterwards, so the column can be ticked off against a statement and
   * summed straight down the page.
   *
   * Transfers are deliberately NOT here. Reading this column beside the one
   * after it is how you tell money that arrived from a bank from money that
   * came off another order, which is the distinction the desk works in.
   */
  { header: 'Amount Paid', key: 'amount', width: 18, fmt: NGN, scope: 'funding' },
  /**
   * Sales value less EVERYTHING on the order — the bank figure and the
   * transfers together. Positive is still owed, negative is more received
   * than the order was worth, and a dash all the way down is a clean day.
   *
   * It used to be measured against the bank figure alone, with a Balance
   * column measuring it again after transfers. That made an order settled
   * entirely by a transfer read as owing its whole value: ORD-8442394D95CF
   * is ₦54,450,000, was paid for by ₦54,450,000 moved off ORD-7B4D47DE5567,
   * and showed a ₦54,450,000 shortfall. There is one gap now and it is this
   * one; Balance is gone because it was already this subtraction.
   */
  { header: 'Differential', key: 'differential', width: 16, fmt: NGN_PLAIN, scope: 'order', signed: true },
  /**
   * Movement between orders, on its own. Negative where money left, positive
   * where it landed, so it nets to zero across a window holding both ends —
   * and the sub-row beneath names the order at the other end.
   */
  { header: 'Transferred', key: 'transfers', width: 18, fmt: NGN_SIGNED_PLAIN, scope: 'funding', signed: true },
  { header: 'Paid Into', key: 'paidInto', width: 38, scope: 'order' },
  { header: 'Recorded By', key: 'recordedBy', width: 18, scope: 'funding' },
]

/** The columns, in order, with whether each is filled on an order row or a funding sub-row. */
export const REPORT_COLUMNS = COLUMNS.map((c) => ({ header: c.header, key: c.key, scope: c.scope }))
export const TOTAL_COLUMN_COUNT = COLUMNS.length

/** Exported text reads upper-cased throughout — the on-screen table doesn't. */
const up = (v: string) => v.toUpperCase()

/**
 * The Stock Summary's total label. Filtering to a single PFI is now the
 * common case, and the count was unconditionally pluralised — "Total (1
 * PFIs)" on the one report most likely to be printed and sent on.
 */
const stockTotalLabel = (n: number) => `Total (${n} PFI${n === 1 ? '' : 's'})`

function rowValues(o: FinanceReportOrder, i: number) {
  const qty = Number(o.quantity || 0)
  const rate = Number(o.price || 0)
  const company = orderCompany(o)
  return {
    sn: i + 1,
    date: o.createdAt ? new Date(o.createdAt) : null,
    ref: up(o.reference),
    pfi: up(o.pfiNumber || '—'),
    customer: up(o.customerName || 'Unknown'),
    // Blank, not a dash, when neither the order nor the customer names one —
    // see orderCompany for which of the two wins.
    company: company ? up(company) : '',
    qty,
    product: up(o.productName || '—'),
    rate,
    salesValue: orderSalesValue(o),
    differential: orderDifferential(o),
    paidInto: up(orderPaidInto(o) || '—'),
    /**
     * Money with no bank record behind it, carried on the ORDER line.
     *
     * Every order confirmed before payments were tracked has one, and printing
     * each as its own sub-row put ~5,700 identical "no bank record" lines into
     * the sheet. Stated once, on the order it belongs to. The amount stays in
     * the Amount Paid column either way, or the column stops summing to the
     * total printed above it — the first thing anyone checks.
     */
    ...(legacyAmount(o) > 0
      ? { amount: legacyAmount(o), depositRef: 'NO BANK RECORD' }
      : {}),
  }
}

/**
 * Oldest payment first — the order an exported ledger is read in, and the
 * opposite of the on-screen table, which leads with the most recent because
 * that is what someone scanning the page is looking for. So the sort lives
 * here rather than in the query: the two views want genuinely different
 * orders, and S/N then numbers 1..n down the page in payment sequence.
 *
 * By ORDER DATE, the same column the report is filtered and dated by, so the
 * sheet runs in the order its own Date column shows. It used to lead with the
 * confirmation date, which put an order placed on 24 August and confirmed on
 * 1 September a week away from where its printed date says it belongs.
 */
function chronological(rows: FinanceReportOrder[]): FinanceReportOrder[] {
  const at = (o: FinanceReportOrder) => new Date(o.createdAt || 0).getTime()
  return [...rows].sort((a, b) => at(a) - at(b) || a.id - b.id)
}

/**
 * One payment, as the bank statement has it.
 *
 * Every field on this row is copied from the payment record, which copied it
 * from the statement line when the payment was confirmed. Nothing here is
 * derived, inferred or reconstructed — which is the difference between a sheet
 * that can be checked against a statement and the three earlier variants of
 * this function, which between them printed a FIFO guess, a regex over a
 * description field, and a "balancing" row invented to make the column add up.
 */
function paymentRowValues(p: OrderPayment) {
  const transfer = isTransferLeg(p)
  const when = paymentDate(p)
  const origin = transferOrigin(p)
  return {
    // Receipts only. A movement between orders is a signed figure in the
    // Transfers column, not a negative in a column of money received — that
    // column has to stay something you can select and sum, which is the first
    // thing anyone does with this sheet.
    amount: transfer ? null : p.amount,
    transfers: transfer ? p.amount : null,
    depositor: up(paymentPayer(p) || '—'),
    /**
     * Never blank. A transfer leg has no statement line of its own, so it
     * names the bank payment its money actually arrived as — an auditor
     * following it lands on a reference they can find on a statement, which is
     * the only question they will be asking. Blank cells here read as missing
     * data and sent people hunting for a line that was never there.
     */
    depositRef: transfer ? up(origin) : up(p.bankRef || '—'),
    // The banking date on a statement row; on a transfer leg, the day it was
    // moved — those are different facts and the column below says which.
    depositDate: when.date ? new Date(when.date) : null,
    recordedBy: up(paymentRecorder(p) || '—'),
  }
}

/**
 * The PDF's own columns, deliberately fewer than the workbook's.
 *
 * A spreadsheet can carry eighteen columns because it scrolls and every column
 * can be widened. An A4 landscape page cannot: at eighteen, a company name
 * wrapped to three lines or truncated to nothing, which is the state this
 * replaces.
 *
 * Four columns go and two pairs merge:
 *
 *   PFI          dropped — it is named in the stock summary at the top, and on
 *                a report filtered to one PFI it repeated on every row.
 *   Paid Into    dropped from the rows, stated once in the summary as the set
 *   Recorded By  of accounts used and the people who recorded, which is the
 *                only form in which either is actually read.
 *   Customer     merged with Company: the name, and the company beneath it in
 *                bold, since the company is who the invoice is actually to.
 *   Qty          merged with Product: the figure in bold, the product beneath.
 *
 * The workbook keeps all eighteen. It is a different document with different
 * constraints, and narrowing it would lose data somebody filters on.
 */
const PDF_COLUMNS: Array<{ header: string; key: string; scope: ColumnScope; width?: number; signed?: boolean }> = [
  { header: 'S/N', key: 'sn', scope: 'order', width: 7 },
  { header: 'Date', key: 'date', scope: 'order', width: 14 },
  { header: 'Order Reference', key: 'ref', scope: 'order', width: 22 },
  { header: 'Customer', key: 'customerBlock', scope: 'order', width: 34 },
  { header: 'Qty / Product', key: 'qtyBlock', scope: 'order', width: 21 },
  { header: 'Rate', key: 'rate', scope: 'order', width: 16 },
  { header: 'Sales Value', key: 'salesValue', scope: 'order', width: 22 },
  { header: 'Deposit Date', key: 'depositDate', scope: 'funding', width: 14 },
  { header: 'Depositor', key: 'depositor', scope: 'funding', width: 25 },
  { header: 'Bank Reference', key: 'depositRef', scope: 'funding', width: 25 },
  { header: 'Amount Paid', key: 'amount', scope: 'funding', width: 22 },
  { header: 'Transferred', key: 'transfers', scope: 'funding', width: 19, signed: true },
  { header: 'Differential', key: 'differential', scope: 'order', width: 19, signed: true },
]

/** The two columns drawn by hand, because each carries two lines at two weights. */
const STACKED = new Set(['customerBlock', 'qtyBlock'])

/**
 * A quantity written in the unit its batch is actually measured in.
 *
 * Petrol is litres, cooking gas is kilograms, an LPG cargo is metric tonnes.
 * Printing all three as "L" is not a labelling slip — it states a figure that
 * is wrong by three orders of magnitude and looks entirely plausible.
 */
function qtyText(value: number, unit: string | null): string {
  return `${Number(value || 0).toLocaleString()} ${unitNames(unit).short}`
}

/**
 * Period volume totalled per unit, joined.
 *
 * A kilogram cannot be added to a litre, so one number across a mixed set is
 * arithmetic on two different things. Each unit gets its own figure.
 */
function totalByUnit(rows: PfiStockRow[]): string {
  const byUnit = new Map<string, number>()
  for (const r of rows) {
    const short = unitNames(r.productUnit).short
    byUnit.set(short, (byUnit.get(short) || 0) + r.volumeSoldPeriod)
  }
  return [...byUnit.entries()].map(([u, t]) => `${t.toLocaleString()} ${u}`).join(' · ') || '—'
}

/** "ZENITH-DEPOT PAYMENTS REPORT 22-08-26" — PFI takes precedence over location, since it's the narrower filter. */
export function buildFilename(filters: FinanceReportFilters) {
  const scope =
    filters.pfiNumber && filters.pfiNumber !== 'All PFIs'
      ? filters.pfiNumber
      : filters.locationName && filters.locationName !== 'All locations'
        ? filters.locationName
        : 'ALL'
  const dateTag = filters.dateTo
    ? format(new Date(filters.dateTo), 'dd-MM-yy')
    : format(new Date(), 'dd-MM-yy')
  return `${scope} PAYMENTS REPORT ${dateTag}`.toUpperCase().replace(/\s+/g, ' ')
}

/**
 * The summary as a row of columns rather than a label/value list — reads as
 * an actual table both in Excel and in the PDF, not a sidebar of captions.
 *
 * What the report is about, then what it adds up to. It used to carry surplus
 * held, money moved between orders, bank-verifiable and system-decided counts,
 * and a shortfall — provenance figures that belong to the desk correcting
 * records, not to somebody reading a period's trading. They are all still on
 * the order rows and in the payments dialog; they are not the summary.
 */
function summaryColumns(
  summary: FinanceReportSummary,
  filters: FinanceReportFilters,
): Array<{ header: string; value: string | number; fmt?: string; signed?: boolean }> {
  const cols: Array<{ header: string; value: string | number; fmt?: string; signed?: boolean }> = [
    // { header: 'Generated At', value: up(format(new Date(), 'd MMM yyyy, HH:mm')) },
    { header: 'Report for', value: up(filters.periodLabel) },
    { header: 'Location', value: up(filters.locationName) },
    { header: 'PFI', value: up(filters.pfiNumber) },
    { header: 'Product', value: up(filters.product) },
    { header: 'Number of Orders', value: summary.count },
    { header: 'Total Quantity', value: summary.totalQuantity, fmt: QTY },
    { header: 'Total Sales Value', value: summary.totalSalesValue, fmt: NGN },
    { header: 'Total Amount Paid', value: summary.totalAmountPaid, fmt: NGN },
    /**
     * Only on the exports, and only because they print the summary and the
     * table on one page: Total Amount Paid counts transfers, the Amount Paid
     * COLUMN does not, and without this cell the two look like they disagree
     * by exactly the transfers. On screen the table has no totals row, so
     * there is nothing to reconcile and the summary stays at nine items.
     */
    { header: 'Of Which Transferred', value: summary.totalTransferred, fmt: NGN_SIGNED_PLAIN, signed: true },
    { header: 'Total Differential', value: summary.totalDifferential, fmt: NGN_PLAIN, signed: true },
  ]
  // The same two words the screen uses. Both only exist when a PFI is
  // selected, and the PFI is named two cells to the left, so the "(PFI)" they
  // carried was restating the filter rather than labelling the figure.
  if (summary.initialStock != null) cols.push({ header: 'Initial Stock', value: summary.initialStock, fmt: QTY })
  if (summary.tankBalanceAfter != null) cols.push({ header: 'Tank Balance Now', value: summary.tankBalanceAfter, fmt: QTY })
  return cols
}

/** The caption is a note about a NON-default view, so this is the one it stays silent for. */
const PAYMENT_STATUS_DEFAULT_LABEL = 'Money received (paid & part paid)'

/** Filters that don't earn their own summary column — noted as a caption instead. */
function extraFilterNote(filters: FinanceReportFilters): string {
  const parts: string[] = []
  // Noted whenever it is not the default view. The default is now "money
  // received", which covers paid and part-paid alike.
  if (filters.paymentStatus !== PAYMENT_STATUS_DEFAULT_LABEL) {
    parts.push(`Payment status: ${filters.paymentStatus}`)
  }
  if (filters.search) parts.push(`Search: "${filters.search}"`)
  return parts.join('   ·   ')
}

/**
 * The payments table — header, one row per order with its funding sub-rows
 * indented beneath, and the totals bar.
 *
 * Extracted so the PFI report can put the SAME table on its own sheet for a
 * single batch. The two must not drift: a figure that reads one way on the
 * finance report and another on a PFI report is worse than either of them
 * being wrong on its own.
 *
 * Returns the row after the totals bar.
 */
export function writeFinanceTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  rows: FinanceReportOrder[],
  summary: Pick<
    FinanceReportSummary,
    | 'totalQuantity' | 'totalSalesValue' | 'totalDifferential'
    | 'totalBankPaid' | 'totalTransferred'
  >,
  startRow: number,
): number {
  let cursor = startRow

  const headerRow = ws.getRow(cursor)
  headerRow.values = COLUMNS.map((c) => c.header)
  headerRow.height = ROW_HEIGHT.header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headerRow.eachCell((cell: any) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  cursor++

  const tableStartRow = cursor
  rows.forEach((o, i) => {
    const values = rowValues(o, i)
    const row = ws.getRow(cursor)
    row.values = values
    row.height = ROW_HEIGHT.body
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (c.fmt) cell.numFmt = c.fmt
      if (c.signed) {
        const v = (values as Record<string, unknown>)[c.key]
        if (typeof v === 'number') paintOwed(cell, v, c.key)
      }
    }
    row.getCell('ref').font = { bold: true }
    if (row.getCell('date').value) row.getCell('date').numFmt = DATE_FMT
    cursor++

    // One sub-row per payment. There is no second branch and no balancing row:
    // the payments ARE what the order received, so the column sums to the
    // total above it by construction rather than by correction.
    for (const p of visiblePayments(o)) {
      // Blue, matching the screen: money that moved between orders, so it
      // names where it came from rather than a bank line it never had.
      const internal = isTransferLeg(p)
      const subRow = ws.getRow(cursor)
      subRow.values = paymentRowValues(p)
      subRow.height = ROW_HEIGHT.body
      for (const c of COLUMNS) {
        const cell = subRow.getCell(c.key)
        cell.border = ALL_BORDERS
        cell.fill = internal ? { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.internalTint } } : SUBROW_FILL
        if (internal) cell.font = { color: { argb: XL.internal } }
        if (c.key === 'amount') cell.numFmt = NGN
        if (c.key === 'transfers') cell.numFmt = NGN_SIGNED_PLAIN
      }
      if (subRow.getCell('depositDate').value) subRow.getCell('depositDate').numFmt = DATE_FMT
      cursor++
    }
  })
  ws.views = [{ state: 'frozen', ySplit: tableStartRow - 1 }]
  ws.autoFilter = {
    from: { row: tableStartRow - 1, column: 1 },
    to: { row: tableStartRow - 1, column: COLUMNS.length },
  }

  const totalRow = ws.getRow(cursor)
  totalRow.values = {
    ref: `Total (${rows.length} orders)`,
    qty: summary.totalQuantity,
    salesValue: summary.totalSalesValue,
    amount: summary.totalBankPaid,
    differential: summary.totalDifferential,
    transfers: summary.totalTransferred,
  }
  totalRow.height = ROW_HEIGHT.total
  // eachCell() alone would skip the columns this row never set a value for,
  // leaving the shading/border look like it stops partway across — walk
  // every column position instead so the totals row reads as one solid bar.
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  totalRow.getCell('differential').numFmt = NGN_PLAIN
  // The transfers total was the one money cell on this row with no format at
  // all, so it printed as a raw number while every column above it was
  // currency. Signed like the rows it foots.
  totalRow.getCell('transfers').numFmt = NGN_SIGNED_PLAIN
  paintOwed(totalRow.getCell('differential'), summary.totalDifferential, 'differential')
  paintOwed(totalRow.getCell('transfers'), summary.totalTransferred, 'transfers')
  totalRow.getCell('qty').numFmt = QTY
  totalRow.getCell('salesValue').numFmt = NGN
  totalRow.getCell('amount').numFmt = NGN

  return cursor + 1
}

/** The column widths the payments table needs, for a sheet that hosts only it. */
export const FINANCE_TABLE_COLUMNS = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

/**
 * One sheet: the summary table first, then a blank gap, then the payments
 * table — deliberately not split across sheets, so opening the file lands
 * on everything at once. Each order with tracked funding gets one indented
 * sub-row per deposit right underneath it, filling only the payment-source
 * columns so nothing about the order itself is repeated.
 */
export async function exportFinanceReportExcel(
  unsortedRows: FinanceReportOrder[],
  summary: FinanceReportSummary,
  filters: FinanceReportFilters,
  pfiStock: PfiStockRow[] = [],
  /** All-time, and deliberately not filtered by the period — see the block below. */
  customerDifferentials: CustomerDifferential[] = [],
) {
  const rows = chronological(unsortedRows)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const ws = wb.addWorksheet('Finance Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  // key + width only, no `header` — that would auto-write a header into row
  // 1, and row 1 here belongs to the title instead. Both header rows below
  // are written by hand once their block's position is known.
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const summaryCols = summaryColumns(summary, filters)
  // The summary table's own headers/values are often wider than the main
  // table's column widths were tuned for (e.g. "Total Amount Paid" vs the
  // 6-wide S/N column) — widen just the columns it actually occupies.
  summaryCols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width || 10, c.header.length + 2, String(c.value).length + 2)
  })

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — FINANCE REPORT',
    subtitle: [
      `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
      `Period: ${filters.periodLabel}`,
      `Location: ${filters.locationName}`,
      `PFI: ${filters.pfiNumber}`,
    ].join('   ·   '),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  const summaryHeaderRow = ws.getRow(cursor)
  summaryHeaderRow.values = summaryCols.map((c) => c.header)
  summaryHeaderRow.height = ROW_HEIGHT.header
  for (let i = 1; i <= summaryCols.length; i++) {
    const cell = summaryHeaderRow.getCell(i)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  cursor++

  const summaryValueRow = ws.getRow(cursor)
  summaryValueRow.values = summaryCols.map((c) => c.value)
  summaryValueRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= summaryCols.length; i++) {
    const col = summaryCols[i - 1]
    const cell = summaryValueRow.getCell(i)
    cell.border = ALL_BORDERS
    cell.fill = SUMMARY_FILL
    cell.font = TOTAL_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    if (col.fmt) cell.numFmt = col.fmt
    if (col.signed && typeof col.value === 'number') {
      paintOwed(cell, col.value, /Transferred/i.test(col.header) ? 'transfers' : undefined)
    }
  }
  cursor++

  const note = extraFilterNote(filters)
  if (note) {
    ws.getCell(cursor, 1).value = note
    ws.getCell(cursor, 1).font = { italic: true, size: 9, color: { argb: XL.inkSoft } }
    cursor++
  }
  cursor += 1

  cursor = writeFinanceTable(ws, rows, summary, cursor)
  cursor += 3

  if (pfiStock.length > 0) {
    cursor = writeSectionHeading(ws, cursor, 'PFI STOCK SUMMARY')
    cursor += 1

    // Named by the window each figure covers. "Volume Sold (Period)" left the
    // reader hunting for which period, and an all-time revenue sitting beside
    // a month's volume read as the same span.
    const per = filters.periodLabel
    const stockHeaders = [
      'PFI', 'Location', 'Product', 'Initial Stock',
      `Volume Sold (${per})`, `Sales Value (${per})`,
      'Volume Sold (All Time)', 'Volume Remaining', 'Total Revenue (All Time)',
    ]
    const stockHeaderRow = ws.getRow(cursor)
    stockHeaderRow.values = stockHeaders
    stockHeaderRow.height = ROW_HEIGHT.header
    stockHeaderRow.eachCell((cell) => {
      cell.font = HEADER_FONT
      cell.fill = HEADER_FILL
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    cursor++

    const periodTotal = totalByUnit(pfiStock)
    let valueTotal = 0
    for (const p of pfiStock) {
      const row = ws.getRow(cursor)
      row.values = [
        up(p.pfiNumber), up(p.locationName), up(p.productName),
        // Text with the unit attached rather than bare numbers: a column
        // holding both kilograms and litres cannot carry one number format,
        // and a figure whose unit is inferred from the header is the bug this
        // replaces.
        qtyText(p.initialStock, p.productUnit), qtyText(p.volumeSoldPeriod, p.productUnit),
        p.salesValuePeriod,
        qtyText(p.volumeSoldAllTime, p.productUnit), qtyText(p.volumeRemaining, p.productUnit),
        p.revenue,
      ]
      valueTotal += p.salesValuePeriod
      for (let i = 1; i <= 9; i++) {
        const cell = row.getCell(i)
        cell.border = ALL_BORDERS
        if (i === 4 || i === 5 || i === 7 || i === 8) cell.alignment = { horizontal: 'right' }
        if (i === 6 || i === 9) cell.numFmt = NGN
        // Negative remaining stock is a real deficit — the batch was
        // charged for more than the tank actually received.
        if (i === 8 && p.volumeRemaining < 0) cell.font = { color: { argb: XL.loss } }
      }
      cursor++
    }

    // Only the period columns are totalled — initial stock and remaining are
    // per-PFI positions in mixed batches, the all-time figures span
    // differently per batch, and neither sums meaningfully across PFIs.
    const stockTotalRow = ws.getRow(cursor)
    stockTotalRow.getCell(1).value = stockTotalLabel(pfiStock.length)
    stockTotalRow.getCell(5).value = periodTotal
    stockTotalRow.getCell(5).alignment = { horizontal: 'right' }
    stockTotalRow.getCell(6).value = valueTotal
    stockTotalRow.getCell(6).numFmt = NGN
    stockTotalRow.height = ROW_HEIGHT.total
    for (let i = 1; i <= 9; i++) {
      const cell = stockTotalRow.getCell(i)
      cell.border = TOTAL_BORDERS
      cell.fill = TOTAL_FILL
      cell.font = TOTAL_FONT
    }
  }

  /**
   * Where the customers on this report stand overall.
   *
   * Everything above this point describes a window — a day, a week, one PFI.
   * This does not: it is every order these customers have ever had money on,
   * whatever period or batch it belonged to. Without it, an overpayment seen
   * in the rows above cannot be told apart from one that was transferred onto
   * another order weeks later, because the order that consumed it falls
   * outside the export entirely.
   *
   * Over and under are printed side by side and never netted into each other.
   * A customer ₦5m over on one order and ₦5m under on another is two problems,
   * and a single netted column would show neither.
   */
  if (customerDifferentials.length > 0) {
    cursor += 3
    cursor = writeSectionHeading(ws, cursor, 'CUSTOMER DIFFERENTIALS — ALL TIME')

    cursor += 1

    const custHeaders = [
      'Customer', 'Company', 'Orders (All Time)', 'Out of Balance',
      'Overpaid', 'Underpaid', 'Net', 'Direction',
    ]
    /**
     * The first two columns were sized for "S/N" and a date, and a customer
     * name written into them is clipped to nothing. Widened the same way the
     * summary block above widens what it occupies — capped, so one long
     * company name cannot push the sheet's first column off the page.
     */
    const widen = (index: number, longest: number) => {
      const col = ws.getColumn(index)
      col.width = Math.min(34, Math.max(col.width || 10, longest + 2))
    }
    widen(1, Math.max(10, ...customerDifferentials.map((c) => (c.customerName || '').length)))
    widen(2, Math.max(10, ...customerDifferentials.map((c) => (c.customerCompanyName || '').length)))
    const custHeaderRow = ws.getRow(cursor)
    custHeaderRow.values = custHeaders
    custHeaderRow.height = ROW_HEIGHT.header
    custHeaderRow.eachCell((cell: any) => {
      cell.font = HEADER_FONT
      cell.fill = HEADER_FILL
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    cursor++

    let overTotal = 0
    let underTotal = 0
    for (const c of customerDifferentials) {
      const row = ws.getRow(cursor)
      row.values = [
        up(c.customerName || '—'),
        up(c.customerCompanyName || '—'),
        c.orderCount,
        c.openOrderCount,
        c.overpaid,
        c.underpaid,
        Math.abs(c.net),
        // The sign spelled out rather than left to a minus somewhere in the
        // column: "held" is the customer's money sitting with us, "owed" is
        // ours sitting with them, and the two are read by different people.
        Math.abs(c.net) < 0.005 ? 'Square' : c.net > 0 ? 'Owed to Soroman' : 'Held for customer',
      ]
      overTotal += c.overpaid
      underTotal += c.underpaid
      for (let i = 1; i <= custHeaders.length; i++) {
        const cell = row.getCell(i)
        cell.border = ALL_BORDERS
        if (i >= 3 && i <= 7) cell.alignment = { horizontal: 'right' }
        if (i >= 5 && i <= 7) cell.numFmt = NGN_PLAIN
      }
      // Green on money held for the customer, red on money owed — the same
      // reading as the Differential column, via the same helper, so a positive
      // never comes out green here while it reads red twenty rows above.
      if (c.overpaid >= 0.005) paintOwed(row.getCell(5), -c.overpaid)
      if (c.underpaid >= 0.005) paintOwed(row.getCell(6), c.underpaid)
      paintOwed(row.getCell(7), c.net)
      cursor++
    }

    const custTotalRow = ws.getRow(cursor)
    custTotalRow.getCell(1).value =
      `Total (${customerDifferentials.length} customer${customerDifferentials.length === 1 ? '' : 's'}) · all time`
    custTotalRow.getCell(5).value = overTotal
    custTotalRow.getCell(6).value = underTotal
    custTotalRow.getCell(7).value = Math.abs(underTotal - overTotal)
    custTotalRow.getCell(8).value =
      Math.abs(underTotal - overTotal) < 0.005
        ? 'Square'
        : underTotal > overTotal ? 'Owed to Soroman' : 'Held for customers'
    custTotalRow.height = ROW_HEIGHT.total
    for (let i = 1; i <= custHeaders.length; i++) {
      const cell = custTotalRow.getCell(i)
      cell.border = TOTAL_BORDERS
      cell.fill = TOTAL_FILL
      cell.font = TOTAL_FONT
      if (i >= 5 && i <= 7) {
        cell.numFmt = NGN_PLAIN
        cell.alignment = { horizontal: 'right' }
      }
    }
    cursor++
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${buildFilename(filters)}.xlsx`,
  )
}

export async function exportFinanceReportPdf(
  unsortedRows: FinanceReportOrder[],
  summary: FinanceReportSummary,
  filters: FinanceReportFilters,
  pfiStock: PfiStockRow[] = [],
  /** All-time, and deliberately not filtered by the period — see the block below. */
  customerDifferentials: CustomerDifferential[] = [],
) {
  const rows = chronological(unsortedRows)
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })

  /**
   * Set in Satoshi, the company's own face.
   *
   * Awaited before a single character is drawn: jsPDF resolves a font at draw
   * time, so registering it later would leave the header in Helvetica and the
   * tables in Satoshi. If the face cannot be loaded the report still prints,
   * in Helvetica — and keeps the ₦ sign, since only Satoshi lacks the glyph.
   */
  const satoshi = await applySatoshi(doc)
  const startY = drawPdfHeader(
    doc,
    'Payments Report',
    [
      // `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
      `For ${filters.periodLabel}`,
      `Location: ${filters.locationName}`,
      `PFI: ${filters.pfiNumber}`,
    ].join('   ·   '),
  )

  // Satoshi has no naira glyph, so a document set in it writes the ISO form
  // rather than a box beside every figure. See applySatoshi.
  const naira = satoshi ? pdfNairaIso : pdfNaira

  /**
   * autotable picks its own font and ignores whatever the document is set to,
   * so the face has to be handed to every table explicitly. Without this the
   * headings come out in Satoshi and the tables beneath them in Helvetica,
   * which is the tell that makes a generated document look assembled rather
   * than designed.
   */
  const face = satoshi ? { font: 'Satoshi' } : {}
  /**
   * Tighter than the shared theme's padding, and only here.
   *
   * Padding sits INSIDE the cell, so every millimetre of it is a millimetre
   * the text does not get. This report is the widest one in the system — a
   * customer name, a bank narration and a teller reference all competing for
   * room on one row — and at the theme's 2mm the columns were truncating text
   * that would otherwise have fitted. The grid still reads as a grid at
   * 1.2mm; it just stops throwing away a fifth of every cell.
   */
  const bodyStyle = { ...pdfStyles.body, ...face, cellPadding: 1.2 }
  const headStyle = { ...pdfStyles.head, ...face, cellPadding: 1.4 }
  const footStyle = { ...pdfStyles.foot, ...face, cellPadding: 1.4 }

  /**
   * Every table on the page starts and ends where the header rule and the
   * page number do.
   *
   * autotable's default margin works out at ~14.1mm here, which happens to be
   * close to the 14mm the header and footer are drawn at — but the columns
   * are declared as fixed widths totalling 260mm against 268.8mm of usable
   * page, so the payments table stopped ~9mm short of the right margin and
   * read as though it had been cut off. Stating the margin and scaling the
   * fixed widths to what is actually available fills the page exactly, and
   * keeps every table on the report flush with every other.
   */
  const PAGE_MARGIN = 14
  const tableMargin = { left: PAGE_MARGIN, right: PAGE_MARGIN }
  const usableWidth = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2
  const declaredWidth = PDF_COLUMNS.reduce((sum, c) => sum + (c.width || 0), 0)
  const widthScale = declaredWidth > 0 ? usableWidth / declaredWidth : 1
  /**
   * Signed money without the brackets — colour carries the sign, matching the
   * screen and the workbook. Every other money column here is positive by
   * construction, so they stay on pdfNaira.
   */
  const plain = (n: number) => pdfNaira(Math.abs(n))
  /**
   * A transfer keeps its direction, here as on screen and in the workbook.
   * Which way the money went is the fact the row exists to state.
   */
  const signed = (n: number) =>
    // ASCII + and -, not the typographic minus the screen uses: Satoshi is
    // already missing the naira glyph (see applySatoshi), and a sign that
    // renders as a box would be worse than no sign at all.
    Math.abs(n) < 0.005 ? pdfNaira(0) : `${n < 0 ? '-' : '+'}${pdfNaira(Math.abs(n))}`
  const displayValue = (c: { value: string | number; fmt?: string }) => {
    if (typeof c.value !== 'number') return c.value
    if (c.fmt === NGN) return naira(c.value)
    if (c.fmt === NGN_SIGNED_PLAIN) return signed(c.value)
    if (c.fmt === NGN_PLAIN) return plain(c.value)
    if (c.fmt === QTY) return `${c.value.toLocaleString()} L`
    return c.value.toLocaleString()
  }

  /**
   * One table, not three blocks.
   *
   * The page carried a totals table across the top, two floating lines of text
   * under it for the accounts and the recorders, and then a second PFI Stock
   * Summary table — three things to find before reaching the orders, and two
   * of them called a summary. Everything the reader needs before the rows now
   * sits in a single label/value table, which is also the only shape that can
   * hold a bank account name and a figure in the same list without one of them
   * setting the column width for the other.
   *
   * The workbook keeps its wide across-the-page tables. It scrolls, so width
   * costs it nothing, and the two documents are read differently enough that
   * matching them here would make the PDF worse rather than the pair
   * consistent.
   */
  type SummaryRow = {
    label: string
    text: string
    /** The number behind the text, when its sign should colour the cell. */
    signed?: number
    /** Transferred is signed but is neither a gain nor a loss — see paintOwed. */
    transfer?: boolean
  }

  const summaryRows: SummaryRow[] = []

  for (const c of summaryColumns(summary, filters)) {
    // Report for, Location and PFI are printed verbatim in the header two
    // lines above; in a single-column list they would sit directly beneath
    // themselves.
    if (['Report for', 'Location', 'PFI'].includes(c.header)) continue
    summaryRows.push({
      label: c.header,
      text: String(displayValue(c)),
      signed: c.signed && typeof c.value === 'number' ? c.value : undefined,
      transfer: /Transferred/i.test(c.header),
    })
  }

  /**
   * The two columns that were lifted out of the rows, now rows of their own.
   *
   * Both repeated the same handful of values down hundreds of rows and cost
   * two columns of page width to do it. As a set they answer the questions
   * actually asked of them: which accounts did the money land in, and who
   * keyed it.
   */
  const accountsUsed = [...new Set(rows.flatMap((o) => o.paidInto || []).filter(Boolean))]
  const recordedBy = [...new Set(
    rows.flatMap((o) => (o.payments || []).map((pay) => paymentRecorder(pay))).filter(Boolean),
  )]
  if (accountsUsed.length) {
    summaryRows.push({
      label: accountsUsed.length === 1 ? 'Paid Into' : `Paid Into (${accountsUsed.length})`,
      text: accountsUsed.join(',   '),
    })
  }
  if (recordedBy.length) {
    summaryRows.push({
      label: recordedBy.length === 1 ? 'Recorded By' : `Recorded By (${recordedBy.length})`,
      text: recordedBy.join(',   '),
    })
  }

  const note = extraFilterNote(filters)
  if (note) summaryRows.push({ label: 'Filters', text: note })

  autoTable(doc, {
    startY,
    margin: tableMargin,
    head: [['Summary', '']],
    body: summaryRows.map((r) => [r.label, r.text]),
    styles: { ...bodyStyle, fontSize: 7.5, cellPadding: 1.4 },
    headStyles: { ...headStyle, fillColor: PDF.brandGreen, fontSize: 7.5 },
    columnStyles: {
      // Fixed on the label so a long bank account name pushes the value
      // column rather than squeezing every label in the table.
      0: { cellWidth: 46, fontStyle: 'bold' },
      1: { cellWidth: 'auto' },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const row = summaryRows[data.row.index]
      if (!row) return
      if (data.column.index !== 1 || row.signed == null) return
      if (Math.abs(row.signed) < 0.005) return
      data.cell.styles.textColor = row.transfer
        ? PDF.internal
        : row.signed > 0 ? PDF.loss : PDF.gain
    },
  })

  /**
   * Stock by PFI, as a table rather than a sentence.
   *
   * Each batch used to be folded onto one line of the summary table, its five
   * figures strung together with middots: "PMS · initial 45,000 L · sold
   * 30,000 L for ₦45,000,000 · remaining 15,000 L · all-time …". It fitted,
   * and that was the whole of its case. Nothing lined up between one batch
   * and the next, so the eye could not compare two batches without reading
   * both sentences end to end, and the separators did the work that column
   * edges are for.
   *
   * As its own table the figures sit in columns, the units stay attached to
   * the numbers, and it matches the block the workbook and the screen already
   * show. Still nothing summed across batches — initial stock and remaining
   * are per-batch positions, and the all-time columns span different lengths
   * of time per batch, so a total row would be arithmetic on unlike things.
   */
  if (pfiStock.length > 0) {
    const per = filters.periodLabel
    autoTable(doc, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startY: (doc as any).lastAutoTable.finalY + 5,
      margin: tableMargin,
      head: [[
        'PFI', 'Location', 'Product', 'Initial Stock',
        `Sold (${per})`, `Sales Value (${per})`, 'Remaining',
        'Sold (All Time)', 'Revenue (All Time)',
      ]],
      body: pfiStock.map((p) => [
        up(p.pfiNumber), up(p.locationName), up(p.productName),
        qtyText(p.initialStock, p.productUnit),
        qtyText(p.volumeSoldPeriod, p.productUnit),
        naira(p.salesValuePeriod),
        qtyText(p.volumeRemaining, p.productUnit),
        qtyText(p.volumeSoldAllTime, p.productUnit),
        naira(p.revenue),
      ]),
      styles: { ...bodyStyle, fontSize: 7 },
      headStyles: { ...headStyle, fillColor: PDF.brandGreen, fontSize: 7 },
      columnStyles: {
        3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
        6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
      },
      didParseCell: (data) => {
        // A batch charged for more than the tank received shows a negative
        // remaining — a real deficit, and the same red it gets on screen.
        if (data.section !== 'body' || data.column.index !== 6) return
        if (pfiStock[data.row.index]?.volumeRemaining < 0) data.cell.styles.textColor = PDF.loss
      },
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cursorY = (doc as any).lastAutoTable.finalY + 6

  // Each row is laid out by walking COLUMNS and asking each one whether this
  // row kind fills it — so a column can be added, moved, or switched between
  // order and funding scope without any index arithmetic here needing to
  // follow it.
  const cellsFor = (scope: ColumnScope, values: Record<string, string | number>) =>
    PDF_COLUMNS.map((c) => (c.scope === scope ? (values[c.key] ?? '') : ''))

  /**
   * The two lines behind a stacked cell, keyed by row then column.
   *
   * autotable cannot set two weights inside one cell, so those cells are drawn
   * by hand in didDrawCell. The cell's own text is left as two blank lines so
   * autotable still reserves the right height — clearing it outright would
   * collapse the row to one line and the second would be drawn outside it.
   */
  const stacked: Array<Record<number, [string, string]>> = []

  /**
   * The unit an order's quantity is in, resolved through its batch.
   *
   * A finance report row carries no product unit of its own, and the report
   * has always assumed litres — wrong for the cooking-gas batches, which are
   * kilograms. The batch knows, so the batch is asked. Where it cannot be
   * resolved the figure is printed bare: the product name sits directly
   * beneath it and says what it is, which is better than a confident "L" on
   * a quantity of gas.
   */
  const unitByPfi = new Map(pfiStock.map((p) => [p.pfiNumber, unitNames(p.productUnit).short]))
  const qtyWithUnit = (o: FinanceReportOrder, n: number) => {
    const short = o.pfiNumber ? unitByPfi.get(o.pfiNumber) : undefined
    return short ? `${n.toLocaleString()} ${short}` : n.toLocaleString()
  }

  const body: (string | number)[][] = []
  /**
   * The signed value behind a printed cell, keyed by body row then column.
   *
   * With the brackets gone there is no sign left in the string to read, so
   * colour comes off the number itself. Written in lockstep with `body`, so a
   * row's figures are found by that row's own index.
   */
  const signedAt: Array<Record<number, number>> = []
  const indexOfCol = (key: string) => PDF_COLUMNS.findIndex((c) => c.key === key)
  const diffCol = indexOfCol('differential')
  const transfersCol = indexOfCol('transfers')

  rows.forEach((o, i) => {
    const v = rowValues(o, i)
    const orderRow = cellsFor('order', {
      sn: v.sn,
      date: v.date ? format(v.date, DATE_PATTERN) : '—',
      ref: v.ref,
      // Blank placeholders: the real content is drawn in didDrawCell, and the
      // height is reserved by the two lines set on the cell in didParseCell.
      customerBlock: '',
      qtyBlock: '',
      rate: naira(v.rate),
      salesValue: naira(v.salesValue),
      // Zero printed as zero: on the column that says whether an order is
      // settled, a dash reads as "no data" and not as "square".
      differential: plain(v.differential),
    })
    // cellsFor() only fills the columns of the scope it was asked for, so the
    // legacy amount — which lives in two funding-scope columns but belongs on
    // the ORDER line — is written in by hand. Without it the Amount Paid
    // column in the PDF would not sum to the total printed above it, while
    // the workbook's would: the two documents disagreeing on the same figure.
    const legacy = legacyAmount(o)
    if (legacy > 0) {
      if (indexOfCol('amount') >= 0) orderRow[indexOfCol('amount')] = naira(legacy)
      if (indexOfCol('depositRef') >= 0) orderRow[indexOfCol('depositRef')] = 'NO BANK RECORD'
    }
    body.push(orderRow)
    signedAt[body.length - 1] = { [diffCol]: v.differential }
    stacked[body.length - 1] = {
      [indexOfCol('customerBlock')]: [v.customer, v.company],
      [indexOfCol('qtyBlock')]: [qtyWithUnit(o, v.qty), v.product],
    }

    // The same rows as the workbook, built from the same function, so the two
    // documents cannot say different things.
    for (const p of visiblePayments(o)) {
      const pv = paymentRowValues(p)
      body.push(
        cellsFor('funding', {
          depositDate: pv.depositDate ? format(pv.depositDate, DATE_PATTERN) : '—',
          depositor: pv.depositor,
          depositRef: pv.depositRef,
          amount: pv.amount == null ? '' : naira(pv.amount),
          transfers: pv.transfers == null ? '' : signed(pv.transfers),
        }),
      )
      if (pv.transfers != null) signedAt[body.length - 1] = { [transfersCol]: pv.transfers }
    }
  })

  // Indexed by key, not position, so this can't silently point at the wrong
  // cell if a column is ever inserted before one of these.
  const footRow = new Array(PDF_COLUMNS.length).fill('')
  const footAt = (key: string, value: string) => {
    const idx = PDF_COLUMNS.findIndex((c) => c.key === key)
    if (idx >= 0) footRow[idx] = value
  }
  footAt('ref', `Total (${rows.length})`)
  footAt('qty', summary.totalQuantity.toLocaleString())
  footAt('salesValue', naira(summary.totalSalesValue))
  footAt('amount', naira(summary.totalBankPaid))
  footAt('differential', plain(summary.totalDifferential))
  footAt('transfers', signed(summary.totalTransferred))

  const refColumnIndex = PDF_COLUMNS.findIndex((c) => c.key === 'ref')
  const depositRefIndex = PDF_COLUMNS.findIndex((c) => c.key === 'depositRef')

  autoTable(doc, {
    startY: cursorY,
    head: [PDF_COLUMNS.map((c) => c.header)],
    body,
    foot: [footRow],
    /**
     * The totals bar belongs at the end of the report, not at the foot of
     * every page.
     *
     * autotable repeats a foot on each page by default, which on a six-page
     * report prints the same grand total six times — each one looking like
     * that page's subtotal, and none of them being one.
     */
    showFoot: 'lastPage',
    styles: bodyStyle,
    headStyles: headStyle,
    footStyles: { ...footStyle, fillColor: PDF.grandTotalTint },
    margin: tableMargin,
    // Scaled to the width actually available rather than left at the declared
    // widths, which added up to 9mm less than the page and made the table
    // look truncated. The proportions between columns are unchanged.
    columnStyles: Object.fromEntries(
      PDF_COLUMNS.map((c, i) => [i, { cellWidth: (c.width || 0) * widthScale }]),
    ),
    // A payment-source sub-row gets the same faint tint as its Excel
    // counterpart — never a font change, just enough to read as nested. A
    // sub-row is the one whose Order Reference cell is blank. Plain
    // alternating-row striping would be meaningless here (a "row" is an
    // order or one of its sub-rows depending on how many came before it),
    // so this replaces it rather than layering on top.
    didParseCell: (data) => {
      // `raw` is typed as the union of every row shape autoTable accepts;
      // every row this table builds is the plain array below, so narrowing
      // to that is safe and keeps the index lookup honest.
      const raw = data.row.raw
      const isSubRow =
        data.section === 'body' && Array.isArray(raw) && raw[refColumnIndex] === ''
      if (isSubRow) {
        // An internal transfer identifies itself by the reference cell the
        // shared row builder stamps, so the two documents cannot disagree
        // about which payments are internal.
        // Both forms of internal money identify themselves in the reference
        // cell the shared row builder stamps — "INTERNAL TRANSFER" for a
        // recorded wallet movement, "OFF {ref}" for a remainder carried off
        // another order's credit. Reading it here keeps the PDF's colouring
        // tied to the same fact the workbook and the screen use.
        const refCell = Array.isArray(raw) ? String(raw[depositRefIndex] ?? '').toUpperCase() : ''
        const internal = refCell === 'INTERNAL TRANSFER' || refCell.startsWith('OFF ')
        data.cell.styles.fillColor = internal ? PDF.internalTint : PDF.subRowTint
        if (internal) data.cell.styles.textColor = PDF.internal
        return
      }
      if (data.section === 'body' && data.column.index === refColumnIndex) {
        data.cell.styles.fontStyle = 'bold'
      }
      // Two blank lines, so the row is tall enough for the two real ones
      // didDrawCell paints over them. Emptying the cell instead would collapse
      // the row and the second line would land in the row beneath.
      if (data.section === 'body' && STACKED.has(PDF_COLUMNS[data.column.index]?.key)) {
        data.cell.text = ['', '']
      }
      /**
       * Signed money reads green or red in the body and in the totals bar
       * alike — the one place in these documents where colour means anything.
       *
       * Positive is order value MINUS money received, so it is a shortfall and
       * reads red; negative means more arrived than was billed and reads
       * green. Transfers take neither: money moving between two orders is not
       * a gain or a loss to anybody. See paintOwed.
       */
      const signed =
        data.section === 'foot'
          ? ({
              [diffCol]: summary.totalDifferential,
              [transfersCol]: summary.totalTransferred,
            } as Record<number, number>)
          : signedAt[data.row.index]
      const value = signed?.[data.column.index]
      if (typeof value === 'number' && Math.abs(value) >= 0.005) {
        data.cell.styles.textColor =
          data.column.index === transfersCol ? PDF.internal : value > 0 ? PDF.loss : PDF.gain
      }
    },
    /**
     * The two stacked columns, drawn by hand.
     *
     * autotable applies one font weight per cell, and the whole point of these
     * is two: the customer with their company beneath it in bold, the quantity
     * in bold with its product beneath. Their cell text was blanked above, so
     * there is nothing underneath to collide with.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (data: any) => {
      if (data.section !== 'body') return
      const key = PDF_COLUMNS[data.column.index]?.key
      if (!STACKED.has(key)) return

      const pair = stacked[data.row.index]?.[data.column.index]
      if (!pair) return
      const [top, bottom] = pair
      if (!top && !bottom) return

      const face = satoshi ? 'Satoshi' : 'helvetica'
      const x = data.cell.x + data.cell.padding('left')
      const width = data.cell.width - data.cell.padding('horizontal')

      // Truncated rather than wrapped: these cells sit on a fixed-height row,
      // and a third line would be drawn over the row below it.
      const fit = (text: string) => {
        let t = String(text || '')
        while (t && doc.getTextWidth(t) > width) t = t.slice(0, -1)
        return t === text ? t : t.replace(/.$/, '…')
      }

      doc.setTextColor(...PDF.ink)
      doc.setFont(face, 'normal')
      doc.setFontSize(6.6)
      if (top) doc.text(fit(top), x, data.cell.y + 3.1)

      doc.setFont(face, 'bold')
      doc.setFontSize(6.4)
      if (bottom) doc.text(fit(bottom), x, data.cell.y + 6.1)

      doc.setFont(face, 'normal')
      doc.setFontSize(pdfStyles.body.fontSize)
    },
  })

  /**
   * Where the customers above stand overall — its own table under the rows,
   * on a fresh page.
   *
   * Not folded into the preamble the way Stock by PFI is: that block describes
   * the same window as the rows and belongs beside them, this one deliberately
   * describes a different span. Printing an all-time figure inside a summary
   * headed "For 8 Sep 2026" is how a reader ends up believing a customer
   * overpaid ₦135m today.
   *
   * Over and under stay in separate columns and are never netted into each
   * other, for the reason the workbook gives: a customer over on one order and
   * under on another has two problems, and one netted column shows neither.
   */
  if (customerDifferentials.length > 0) {
    doc.addPage()
    const custStartY = drawPdfHeader(doc, 'Customer Differentials — All Time', '')

    const overTotal = customerDifferentials.reduce((sum, c) => sum + c.overpaid, 0)
    const underTotal = customerDifferentials.reduce((sum, c) => sum + c.underpaid, 0)
    const netTotal = underTotal - overTotal

    /**
     * The signed figure behind each printed cell, so colour can be read off
     * the number rather than a sign that is no longer in the string. Overpaid
     * is handed in negative — money held FOR the customer — which is what
     * makes it green under the same rule the Differential column uses.
     */
    const custSigned: Array<Record<number, number>> = []
    const custBody = customerDifferentials.map((c) => {
      custSigned.push({ 4: -c.overpaid, 5: c.underpaid, 6: c.net })
      return [
        up(c.customerName || '—'),
        up(c.customerCompanyName || '—'),
        c.orderCount.toLocaleString(),
        c.openOrderCount.toLocaleString(),
        c.overpaid < 0.005 ? '—' : plain(c.overpaid),
        c.underpaid < 0.005 ? '—' : plain(c.underpaid),
        Math.abs(c.net) < 0.005
          ? 'Square'
          // The direction spelled out: "held" is the customer's money sitting
          // with us, "owed" is ours sitting with them, and a reader should not
          // have to recover that from the sign of a number.
          : `${plain(c.net)} ${c.net > 0 ? 'owed' : 'held'}`,
      ]
    })

    autoTable(doc, {
      startY: custStartY,
      margin: tableMargin,
      head: [['Customer', 'Company', 'Orders', 'Out of Balance', 'Overpaid', 'Underpaid', 'Net']],
      body: custBody,
      foot: [[
        `Total (${customerDifferentials.length} customer${customerDifferentials.length === 1 ? '' : 's'})`,
        '', '', '',
        plain(overTotal),
        plain(underTotal),
        Math.abs(netTotal) < 0.005 ? '—' : `${plain(netTotal)} ${netTotal > 0 ? 'owed' : 'held'}`,
      ]],
      styles: { ...bodyStyle, fontSize: 7.5, cellPadding: 1.6 },
      headStyles: { ...headStyle, fontSize: 7.5 },
      footStyles: { ...footStyle, fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 16, halign: 'right' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 34, halign: 'right' },
        5: { cellWidth: 34, halign: 'right' },
        6: { cellWidth: 42, halign: 'right' },
      },
      didParseCell: (data) => {
        if (data.section === 'foot') {
          if (data.column.index === 4) data.cell.styles.textColor = PDF.gain
          if (data.column.index === 5) data.cell.styles.textColor = PDF.loss
          if (data.column.index === 6 && Math.abs(netTotal) >= 0.005) {
            data.cell.styles.textColor = netTotal > 0 ? PDF.loss : PDF.gain
          }
          return
        }
        if (data.section !== 'body') return
        const value = custSigned[data.row.index]?.[data.column.index]
        if (value == null || Math.abs(value) < 0.005) return
        data.cell.styles.textColor = value > 0 ? PDF.loss : PDF.gain
      },
    })
  }

  drawPdfFooters(doc, `Soroman Finance Report · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
