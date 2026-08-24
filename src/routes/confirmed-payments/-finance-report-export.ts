import { format } from 'date-fns'
import {
  fundingRecorder, fundingDepositor, fundingPaidAt, fundingReference, fundingAmount,
  orderPaidInto, orderCompany, orderSalesValue, orderDifferential,
  walletStatementRows,
  type FinanceReportOrder, type OrderFunding, type StatementRow,
} from '#/lib/hooks/useFinanceReport'
import {
  XL, PDF, NGN, NGN_SIGNED, QTY, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, SUMMARY_FILL,
  TOTAL_FILL, GRAND_TOTAL_FILL, HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading, paintSigned,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

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
  totalAmountPaid: number
  /** Sum of the per-order differentials — see orderDifferential for the basis. */
  totalDifferential: number
  /** Only meaningful — and only shown — when a single PFI is selected. */
  initialStock: number | null
  tankBalanceAfter: number | null
}

/** One row of the PFI Stock Summary block — every active PFI, stock and revenue side by side with the period's own sales. */
export interface PfiStockRow {
  pfiNumber: string
  locationName: string
  productName: string
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
  { header: 'Bank Reference', key: 'depositRef', width: 20, scope: 'funding' },
  { header: 'Amount Paid', key: 'amount', width: 16, fmt: NGN, scope: 'funding' },
  { header: 'Differential', key: 'differential', width: 16, fmt: NGN_SIGNED, scope: 'order', signed: true },
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
  }
}

/**
 * Oldest payment first — the order an exported ledger is read in, and the
 * opposite of the on-screen table, which leads with the most recent because
 * that is what someone scanning the page is looking for. So the sort lives
 * here rather than in the query: the two views want genuinely different
 * orders, and S/N then numbers 1..n down the page in payment sequence.
 *
 * COALESCE'd to the order date the same way the server's sort is, so an
 * unpaid order (no confirmation date, present when the filter is Unpaid/All)
 * still lands in a sensible place instead of at one end.
 */
function chronological(rows: FinanceReportOrder[]): FinanceReportOrder[] {
  const at = (o: FinanceReportOrder) =>
    new Date(o.paymentConfirmedAt || o.createdAt || 0).getTime()
  return [...rows].sort((a, b) => at(a) - at(b) || a.id - b.id)
}

/**
 * A statement credit behind a wallet-funded order, as the bank carries it.
 *
 * Fills the same columns a funding sub-row would, because it answers the same
 * question — who paid, when, how much, under what reference. The wallet hop
 * between the order and this credit is not printed: it is not what anybody
 * reconciling against a statement is looking for.
 */
function statementRowValues(r: StatementRow) {
  return {
    amount: r.amount,
    depositor: up(r.depositor || '—'),
    depositRef: up(r.reference || '—'),
    depositDate: r.txnDate ? new Date(r.txnDate) : null,
    // The staff member who keyed the credit in, matching what the funding
    // sub-row puts here. This used to carry the full bank narration so the
    // sheet could be matched against the statement by eye, but the column is
    // headed Recorded By and a narration names the payer, not the recorder.
    recordedBy: up(r.recordedBy || '—'),
  }
}

/** A funding sub-row — no order details repeated, just where that money came from. */
function fundingRowValues(f: OrderFunding) {
  return {
    // The payment as it actually arrived, not the slice attributed to this
    // order — see fundingAmount.
    amount: fundingAmount(f),
    depositor: up(fundingDepositor(f) || '—'),
    depositRef: up(fundingReference(f) || '—'),
    // When the money landed per the bank statement, not when the deposit row
    // happened to be keyed in — those differ by days on a back-dated match.
    depositDate: fundingPaidAt(f) ? new Date(String(fundingPaidAt(f))) : null,
    recordedBy: up(fundingRecorder(f) || '—'),
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
    { header: 'Total Differential', value: summary.totalDifferential, fmt: NGN_SIGNED, signed: true },
  ]
  if (summary.initialStock != null) cols.push({ header: 'Initial Stock (PFI)', value: summary.initialStock, fmt: QTY })
  if (summary.tankBalanceAfter != null) cols.push({ header: 'Tank Balance After (PFI)', value: summary.tankBalanceAfter, fmt: QTY })
  return cols
}

/** Filters that don't earn their own summary column — noted as a caption instead. */
function extraFilterNote(filters: FinanceReportFilters): string {
  const parts: string[] = []
  if (filters.paymentStatus !== 'Paid') parts.push(`Payment status: ${filters.paymentStatus}`)
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
  summary: Pick<FinanceReportSummary, 'totalQuantity' | 'totalSalesValue' | 'totalAmountPaid' | 'totalDifferential'>,
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
        if (typeof v === 'number') paintSigned(cell, v)
      }
    }
    row.getCell('ref').font = { bold: true }
    if (row.getCell('date').value) row.getCell('date').numFmt = DATE_FMT
    cursor++

    if (o.fundingTracked) {
      for (const f of o.funding) {
        const subRow = ws.getRow(cursor)
        subRow.values = fundingRowValues(f)
        subRow.height = ROW_HEIGHT.body
        for (const c of COLUMNS) {
          const cell = subRow.getCell(c.key)
          cell.border = ALL_BORDERS
          cell.fill = SUBROW_FILL
          if (c.key === 'amount') cell.numFmt = NGN
        }
        if (subRow.getCell('depositDate').value) subRow.getCell('depositDate').numFmt = DATE_FMT
        cursor++
      }
    } else {
      // A wallet-funded order has no allocation to print, and used to leave
      // the depositor and reference columns blank on every row.
      for (const r of walletStatementRows(o)) {
        const subRow = ws.getRow(cursor)
        subRow.values = statementRowValues(r)
        subRow.height = ROW_HEIGHT.body
        for (const c of COLUMNS) {
          const cell = subRow.getCell(c.key)
          cell.border = ALL_BORDERS
          cell.fill = SUBROW_FILL
          if (c.key === 'amount') cell.numFmt = NGN
        }
        if (subRow.getCell('depositDate').value) subRow.getCell('depositDate').numFmt = DATE_FMT
        cursor++
      }
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
    amount: summary.totalAmountPaid,
    differential: summary.totalDifferential,
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
  totalRow.getCell('differential').numFmt = NGN_SIGNED
  paintSigned(totalRow.getCell('differential'), summary.totalDifferential)
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
    if (col.signed && typeof col.value === 'number') paintSigned(cell, col.value)
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

    const stockHeaders = ['PFI', 'Location', 'Product', 'Initial Stock', 'Volume Sold (Period)', 'Total Volume Sold', 'Volume Remaining', 'Revenue']
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
  const summaryCols = summaryColumns(summary, filters)
  const displayValue = (c: { value: string | number; fmt?: string }) => {
    if (typeof c.value !== 'number') return c.value
    if (c.fmt === NGN) return naira(c.value)
    if (c.fmt === QTY) return `${c.value.toLocaleString()} L`
    return c.value.toLocaleString()
  }

  const signedSummaryIndexes = summaryCols
    .map((c, i) => (c.signed ? i : -1))
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
      const text = String(data.cell.raw).trim()
      if (!text) return
      // Parenthesised is negative — pdfNaira writes it that way so the sign
      // survives a monochrome print.
      data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
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
  rows.forEach((o, i) => {
    const v = rowValues(o, i)
    body.push(
      cellsFor('order', {
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
        differential: Math.abs(v.differential) < 0.005 ? '—' : naira(v.differential),
        paidInto: v.paidInto,
      }),
    )

    if (o.fundingTracked) {
      for (const f of o.funding) {
        const fv = fundingRowValues(f)
        body.push(
          cellsFor('funding', {
            depositDate: fv.depositDate ? format(fv.depositDate, DATE_PATTERN) : '—',
            depositor: fv.depositor,
            depositRef: fv.depositRef,
            amount: naira(fv.amount),
            recordedBy: fv.recordedBy,
          }),
        )
      }
    } else {
      // The statement credits behind a wallet-funded order — the same rows as
      // the workbook, so the two documents say the same thing.
      for (const r of walletStatementRows(o)) {
        const sv = statementRowValues(r)
        body.push(
          cellsFor('funding', {
            depositDate: sv.depositDate ? format(sv.depositDate, DATE_PATTERN) : '—',
            depositor: sv.depositor,
            depositRef: sv.depositRef,
            amount: naira(sv.amount),
            recordedBy: sv.recordedBy,
          }),
        )
      }
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
  footAt('amount', naira(summary.totalAmountPaid))
  footAt('differential', naira(summary.totalDifferential))

  const refColumnIndex = COLUMNS.findIndex((c) => c.key === 'ref')
  const differentialIndex = COLUMNS.findIndex((c) => c.key === 'differential')

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
        data.cell.styles.fillColor = PDF.subRowTint
        return
      }
      if (data.section === 'body' && data.column.index === refColumnIndex) {
        data.cell.styles.fontStyle = 'bold'
      }
      // Signed money reads green or red in the body and in the totals bar
      // alike — the one place in these documents where colour means anything.
      if (data.column.index === differentialIndex) {
        const text = String(data.cell.raw).trim()
        if (text && text !== '—') {
          data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
        }
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
      head: [['PFI', 'Location', 'Product', 'Initial Stock', 'Volume Sold (Period)', 'Total Volume Sold', 'Volume Remaining', 'Revenue']],
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
