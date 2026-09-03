import { format } from 'date-fns'
import {
  paymentRecorder, paymentPayer, paymentDate, transferOrigin,
  visiblePayments, legacyAmount, isTransferLeg,
  orderPaidInto, orderCompany, orderSalesValue, orderDifferential,
  type FinanceReportOrder, type OrderPayment,
} from '#/lib/hooks/useFinanceReport'
import {
  XL, PDF, NGN, QTY, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, SUMMARY_FILL,
  TOTAL_FILL, GRAND_TOTAL_FILL, HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
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
  /** The tank quantity, printed under that name. See PfiStockSummary above. */
  initialStock: number
  /** Litres sold within the report's current filters — not all-time. */
  volumeSoldPeriod: number
  volumeSoldAllTime: number
  volumeRemaining: number
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
  { header: 'Transferred', key: 'transfers', width: 18, fmt: NGN_PLAIN, scope: 'funding', signed: true },
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
    { header: 'Of Which Transferred', value: summary.totalTransferred, fmt: NGN_PLAIN, signed: true },
    { header: 'Total Differential', value: summary.totalDifferential, fmt: NGN_PLAIN, signed: true },
  ]
  if (summary.initialStock != null) cols.push({ header: 'Tank Quantity (PFI)', value: summary.initialStock, fmt: QTY })
  if (summary.tankBalanceAfter != null) cols.push({ header: 'Tank Balance After (PFI)', value: summary.tankBalanceAfter, fmt: QTY })
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
        if (c.key === 'transfers') cell.numFmt = NGN_PLAIN
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

    const stockHeaders = ['PFI', 'Location', 'Product', 'Tank Quantity', 'Volume Sold (Period)', 'Total Volume Sold', 'Volume Remaining', 'Revenue']
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

    let periodTotal = 0
    for (const p of pfiStock) {
      const row = ws.getRow(cursor)
      row.values = [
        up(p.pfiNumber), up(p.locationName), up(p.productName),
        p.initialStock, p.volumeSoldPeriod, p.volumeSoldAllTime, p.volumeRemaining, p.revenue,
      ]
      periodTotal += p.volumeSoldPeriod
      for (let i = 1; i <= 8; i++) {
        const cell = row.getCell(i)
        cell.border = ALL_BORDERS
        if (i >= 4 && i <= 7) cell.numFmt = QTY
        if (i === 8) cell.numFmt = NGN
        // Negative remaining stock is a real deficit — the batch was
        // charged for more than the tank actually received.
        if (i === 7 && p.volumeRemaining < 0) cell.font = { color: { argb: XL.loss } }
      }
      cursor++
    }

    // Only the period-sold column is totalled — initial stock and remaining
    // are per-PFI positions in mixed batches, and summing them across PFIs
    // would not mean anything.
    const stockTotalRow = ws.getRow(cursor)
    stockTotalRow.getCell(1).value = stockTotalLabel(pfiStock.length)
    stockTotalRow.getCell(5).value = periodTotal
    stockTotalRow.getCell(5).numFmt = QTY
    stockTotalRow.height = ROW_HEIGHT.total
    for (let i = 1; i <= 8; i++) {
      const cell = stockTotalRow.getCell(i)
      cell.border = TOTAL_BORDERS
      cell.fill = TOTAL_FILL
      cell.font = TOTAL_FONT
    }
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
) {
  const rows = chronological(unsortedRows)
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
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

  const naira = pdfNaira
  /**
   * Signed money without the brackets — colour carries the sign, matching the
   * screen and the workbook. Every other money column here is positive by
   * construction, so they stay on pdfNaira.
   */
  const plain = (n: number) => pdfNaira(Math.abs(n))
  const summaryCols = summaryColumns(summary, filters)
  const displayValue = (c: { value: string | number; fmt?: string }) => {
    if (typeof c.value !== 'number') return c.value
    if (c.fmt === NGN) return naira(c.value)
    if (c.fmt === NGN_PLAIN) return plain(c.value)
    if (c.fmt === QTY) return `${c.value.toLocaleString()} L`
    return c.value.toLocaleString()
  }

  const signedSummaryIndexes = summaryCols
    .map((c, i) => (c.signed ? i : -1))
    .filter((i) => i >= 0)
  // Transferred is signed but is not a gain or a loss — see paintOwed.
  const transferSummaryIndexes = summaryCols
    .map((c, i) => (/Transferred/i.test(c.header) ? i : -1))
    .filter((i) => i >= 0)

  autoTable(doc, {
    startY,
    head: [summaryCols.map((c) => c.header)],
    body: [summaryCols.map((c) => displayValue(c))],
    styles: { ...pdfStyles.body, fontSize: 7.5 },
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen, fontSize: 7.5 },
    bodyStyles: pdfStyles.summaryBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (!signedSummaryIndexes.includes(data.column.index)) return
      // Off the value, never the printed text. These cells used to be tested
      // for a leading bracket, which `toLocaleString` never wrote — so the
      // test never matched and every figure took one colour regardless.
      const value = summaryCols[data.column.index]?.value
      if (typeof value !== 'number' || Math.abs(value) < 0.005) return
      if (transferSummaryIndexes.includes(data.column.index)) {
        data.cell.styles.textColor = PDF.internal
        return
      }
      data.cell.styles.textColor = value > 0 ? PDF.loss : PDF.gain
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursorY = (doc as any).lastAutoTable.finalY + 6
  const note = extraFilterNote(filters)
  if (note) {
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(note, 14, cursorY)
    doc.setTextColor(0)
    cursorY += 5
  }

  // Each row is laid out by walking COLUMNS and asking each one whether this
  // row kind fills it — so a column can be added, moved, or switched between
  // order and funding scope without any index arithmetic here needing to
  // follow it.
  const cellsFor = (scope: ColumnScope, values: Record<string, string | number>) =>
    COLUMNS.map((c) => (c.scope === scope ? (values[c.key] ?? '') : ''))

  const body: (string | number)[][] = []
  /**
   * The signed value behind a printed cell, keyed by body row then column.
   *
   * With the brackets gone there is no sign left in the string to read, so
   * colour comes off the number itself. Written in lockstep with `body`, so a
   * row's figures are found by that row's own index.
   */
  const signedAt: Array<Record<number, number>> = []
  const indexOfCol = (key: string) => COLUMNS.findIndex((c) => c.key === key)
  const diffCol = indexOfCol('differential')
  const transfersCol = indexOfCol('transfers')

  rows.forEach((o, i) => {
    const v = rowValues(o, i)
    const orderRow = cellsFor('order', {
      sn: v.sn,
      date: v.date ? format(v.date, DATE_PATTERN) : '—',
      ref: v.ref,
      pfi: v.pfi,
      customer: v.customer,
      company: v.company,
      qty: v.qty.toLocaleString(),
      product: v.product,
      rate: naira(v.rate),
      salesValue: naira(v.salesValue),
      differential: Math.abs(v.differential) < 0.005 ? '—' : plain(v.differential),
      paidInto: v.paidInto,
    })
    // cellsFor() only fills the columns of the scope it was asked for, so the
    // legacy amount — which lives in two funding-scope columns but belongs on
    // the ORDER line — is written in by hand. Without it the Amount Paid
    // column in the PDF would not sum to the total printed above it, while
    // the workbook's would: the two documents disagreeing on the same figure.
    const legacy = legacyAmount(o)
    if (legacy > 0) {
      const at = (key: string) => COLUMNS.findIndex((c) => c.key === key)
      if (at('amount') >= 0) orderRow[at('amount')] = naira(legacy)
      if (at('depositRef') >= 0) orderRow[at('depositRef')] = 'NO BANK RECORD'
    }
    body.push(orderRow)
    signedAt[body.length - 1] = { [diffCol]: v.differential }

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
          transfers: pv.transfers == null ? '' : plain(pv.transfers),
          recordedBy: pv.recordedBy,
        }),
      )
      if (pv.transfers != null) signedAt[body.length - 1] = { [transfersCol]: pv.transfers }
    }
  })

  // Indexed by key, not position, so this can't silently point at the wrong
  // cell if a column is ever inserted before one of these.
  const footRow = new Array(COLUMNS.length).fill('')
  const footAt = (key: string, value: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === key)
    if (idx >= 0) footRow[idx] = value
  }
  footAt('ref', `Total (${rows.length})`)
  footAt('qty', summary.totalQuantity.toLocaleString())
  footAt('salesValue', naira(summary.totalSalesValue))
  footAt('amount', naira(summary.totalBankPaid))
  footAt('differential', plain(summary.totalDifferential))
  footAt('transfers', plain(summary.totalTransferred))

  const refColumnIndex = COLUMNS.findIndex((c) => c.key === 'ref')
  const depositRefIndex = COLUMNS.findIndex((c) => c.key === 'depositRef')

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body,
    foot: [footRow],
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
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
  })

  if (pfiStock.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stockY = (doc as any).lastAutoTable.finalY + 8
    doc.setFontSize(12)
    doc.setTextColor(0, 122, 85)
    doc.text('PFI STOCK SUMMARY', 14, stockY)
    doc.setTextColor(0)
    stockY += 4

    const periodTotal = pfiStock.reduce((s, p) => s + p.volumeSoldPeriod, 0)
    autoTable(doc, {
      startY: stockY,
      head: [['PFI', 'Location', 'Product', 'Tank Quantity', 'Volume Sold (Period)', 'Total Volume Sold', 'Volume Remaining', 'Revenue']],
      body: pfiStock.map((p) => [
        up(p.pfiNumber), up(p.locationName), up(p.productName),
        p.initialStock.toLocaleString(), p.volumeSoldPeriod.toLocaleString(),
        p.volumeSoldAllTime.toLocaleString(), p.volumeRemaining.toLocaleString(), naira(p.revenue),
      ]),
      // Only the period-sold column is totalled — initial stock and
      // remaining are per-PFI positions in mixed batches, summing them
      // across PFIs would not mean anything.
      foot: [['', '', stockTotalLabel(pfiStock.length), '', periodTotal.toLocaleString(), '', '', '']],
      styles: { ...pdfStyles.body, fontSize: 7 },
      headStyles: pdfStyles.head,
      footStyles: pdfStyles.foot,
      // A batch charged for more BL than the tank received shows a negative
      // remaining — a real deficit, worth the same red flag it gets on screen.
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6 && String(data.cell.raw).trim().startsWith('-')) {
          data.cell.styles.textColor = PDF.loss
        }
      },
    })
  }

  drawPdfFooters(doc, `Soroman Finance Report · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
