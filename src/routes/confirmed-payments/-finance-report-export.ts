import { format } from 'date-fns'
import {
  fundingRecorder, fundingDepositor, fundingPaidAt, fundingReference, fundingAmount, orderPaidInto, orderCompany,
  type FinanceReportOrder, type OrderFunding,
} from '#/lib/hooks/useFinanceReport'

/**
 * Amounts and quantities are written as real numbers with a cell format,
 * never as pre-formatted strings — a column that looks like money or litres
 * but is text cannot be summed, and summing a column is the first thing
 * anyone does with one of these sheets. Figures are always written out in
 * full — no "1.2bn" abbreviations — since a finance report is exactly the
 * place a rounded figure would be read as the real one.
 */
const NGN = '₦#,##0.00;[Red]-₦#,##0.00'
const QTY = '#,##0 "L"'

const BRAND_GREEN = 'FF007A55'
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F3864' } }
const SUMMARY_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8EEF7' } }
// A payment-source sub-row gets the same font as an order row — only a faint
// tint marks it as nested, never italics or grey text.
const SUBROW_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF7F9FB' } }
const TOTAL_FILL = SUMMARY_FILL
const THIN = { style: 'thin' as const, color: { argb: 'FFB7C0CC' } }
const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN }

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
 * Value alongside as what was owed — the differential between the two being
 * the thing this report exists to show.
 */
type ColumnScope = 'order' | 'funding'
const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string; scope: ColumnScope }> = [
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
  { header: 'Depositor / Payer', key: 'depositor', width: 22, scope: 'funding' },
  { header: 'Deposit Reference', key: 'depositRef', width: 20, scope: 'funding' },
  { header: 'Amount Paid', key: 'amount', width: 16, fmt: NGN, scope: 'funding' },
  { header: 'Paid Into', key: 'paidInto', width: 38, scope: 'order' },
  { header: 'Recorded By', key: 'recordedBy', width: 18, scope: 'funding' },
]

/** The columns, in order, with whether each is filled on an order row or a funding sub-row. */
export const REPORT_COLUMNS = COLUMNS.map((c) => ({ header: c.header, key: c.key, scope: c.scope }))
export const TOTAL_COLUMN_COUNT = COLUMNS.length

/** Exported text reads upper-cased throughout — the on-screen table doesn't. */
const up = (v: string) => v.toUpperCase()

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
    salesValue: rate * qty,
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

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
): Array<{ header: string; value: string | number; fmt?: string }> {
  const cols: Array<{ header: string; value: string | number; fmt?: string }> = [
    { header: 'Generated At', value: up(format(new Date(), 'd MMM yyyy, HH:mm')) },
    { header: 'Period', value: up(filters.periodLabel) },
    { header: 'Location', value: up(filters.locationName) },
    { header: 'PFI', value: up(filters.pfiNumber) },
    { header: 'Product', value: up(filters.product) },
    { header: 'Number of Orders', value: summary.count },
    { header: 'Total Quantity', value: summary.totalQuantity, fmt: QTY },
    { header: 'Total Sales Value', value: summary.totalSalesValue, fmt: NGN },
    { header: 'Total Amount Paid', value: summary.totalAmountPaid, fmt: NGN },
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

  const ws = wb.addWorksheet('Finance Report')
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

  ws.getCell('A1').value = 'Soroman — Finance Report'
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: BRAND_GREEN } }
  ws.getCell('A2').value = `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`
  ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF666666' } }

  let cursor = 4
  const summaryHeaderRow = ws.getRow(cursor)
  summaryHeaderRow.values = summaryCols.map((c) => c.header)
  for (let i = 1; i <= summaryCols.length; i++) {
    const cell = summaryHeaderRow.getCell(i)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle' }
  }
  cursor++

  const summaryValueRow = ws.getRow(cursor)
  summaryValueRow.values = summaryCols.map((c) => c.value)
  for (let i = 1; i <= summaryCols.length; i++) {
    const cell = summaryValueRow.getCell(i)
    cell.border = ALL_BORDERS
    cell.fill = SUMMARY_FILL
    cell.font = { bold: true }
    if (summaryCols[i - 1].fmt) cell.numFmt = summaryCols[i - 1].fmt as string
  }
  cursor++

  const note = extraFilterNote(filters)
  if (note) {
    ws.getCell(cursor, 1).value = note
    ws.getCell(cursor, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } }
    cursor++
  }
  cursor += 1

  const headerRow = ws.getRow(cursor)
  headerRow.values = COLUMNS.map((c) => c.header)
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle' }
  })
  cursor++

  const tableStartRow = cursor
  rows.forEach((o, i) => {
    const row = ws.getRow(cursor)
    row.values = rowValues(o, i)
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (c.fmt) cell.numFmt = c.fmt
    }
    if (row.getCell('date').value) row.getCell('date').numFmt = 'dd/mm/yyyy'
    cursor++

    if (o.fundingTracked) {
      for (const f of o.funding) {
        const subRow = ws.getRow(cursor)
        subRow.values = fundingRowValues(f)
        for (const c of COLUMNS) {
          const cell = subRow.getCell(c.key)
          cell.border = ALL_BORDERS
          cell.fill = SUBROW_FILL
          if (c.key === 'amount') cell.numFmt = NGN
        }
        if (subRow.getCell('depositDate').value) subRow.getCell('depositDate').numFmt = 'dd/mm/yyyy'
        cursor++
      }
    }
  })
  ws.views = [{ state: 'frozen', ySplit: tableStartRow - 1 }]

  const totalRow = ws.getRow(cursor)
  totalRow.values = {
    ref: `Total (${rows.length} orders)`,
    qty: summary.totalQuantity,
    salesValue: summary.totalSalesValue,
    amount: summary.totalAmountPaid,
  }
  // eachCell() alone would skip the columns this row never set a value for,
  // leaving the shading/border look like it stops partway across — walk
  // every column position instead so the totals row reads as one solid bar.
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = ALL_BORDERS
    cell.fill = TOTAL_FILL
    cell.font = { bold: true }
  }
  totalRow.getCell('qty').numFmt = QTY
  totalRow.getCell('salesValue').numFmt = NGN
  totalRow.getCell('amount').numFmt = NGN
  cursor += 3

  if (pfiStock.length > 0) {
    ws.getCell(cursor, 1).value = 'PFI STOCK SUMMARY'
    ws.getCell(cursor, 1).font = { bold: true, size: 12, color: { argb: BRAND_GREEN } }
    cursor += 2

    const stockHeaders = ['PFI', 'Location', 'Product', 'Initial Stock', 'Volume Sold (Period)', 'Total Volume Sold', 'Volume Remaining', 'Revenue']
    const stockHeaderRow = ws.getRow(cursor)
    stockHeaderRow.values = stockHeaders
    stockHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = HEADER_FILL
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'middle' }
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
        if (i === 7 && p.volumeRemaining < 0) cell.font = { color: { argb: 'FFCC0000' } }
      }
      cursor++
    }

    // Only the period-sold column is totalled — initial stock and remaining
    // are per-PFI positions in mixed batches, and summing them across PFIs
    // would not mean anything.
    const stockTotalRow = ws.getRow(cursor)
    stockTotalRow.getCell(1).value = `Total (${pfiStock.length} PFIs)`
    stockTotalRow.getCell(5).value = periodTotal
    stockTotalRow.getCell(5).numFmt = QTY
    for (let i = 1; i <= 8; i++) {
      const cell = stockTotalRow.getCell(i)
      cell.border = ALL_BORDERS
      cell.fill = TOTAL_FILL
      cell.font = { bold: true }
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
  doc.setFontSize(14)
  doc.text('Soroman — Finance Report', 14, 15)
  doc.setFontSize(9)
  doc.text(`Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`, 14, 21)

  const naira = (n: number) => `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const summaryCols = summaryColumns(summary, filters)
  const displayValue = (c: { value: string | number; fmt?: string }) => {
    if (typeof c.value !== 'number') return c.value
    if (c.fmt === NGN) return naira(c.value)
    if (c.fmt === QTY) return `${c.value.toLocaleString()} L`
    return c.value.toLocaleString()
  }

  autoTable(doc, {
    startY: 25,
    head: [summaryCols.map((c) => c.header)],
    body: [summaryCols.map((c) => displayValue(c))],
    styles: { fontSize: 7.5, cellPadding: 2, lineColor: [183, 192, 204], lineWidth: 0.1 },
    headStyles: { fillColor: [0, 122, 85], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { fillColor: [232, 238, 247], fontStyle: 'bold', textColor: [20, 20, 20] },
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
        date: v.date ? format(v.date, 'dd/MM/yyyy') : '—',
        ref: v.ref,
        pfi: v.pfi,
        customer: v.customer,
        company: v.company,
        qty: v.qty.toLocaleString(),
        product: v.product,
        rate: naira(v.rate),
        salesValue: naira(v.salesValue),
        paidInto: v.paidInto,
      }),
    )

    if (o.fundingTracked) {
      for (const f of o.funding) {
        const fv = fundingRowValues(f)
        body.push(
          cellsFor('funding', {
            depositDate: fv.depositDate ? format(fv.depositDate, 'dd/MM/yyyy') : '—',
            depositor: fv.depositor,
            depositRef: fv.depositRef,
            amount: naira(fv.amount),
            recordedBy: fv.recordedBy,
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

  const refColumnIndex = COLUMNS.findIndex((c) => c.key === 'ref')

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body,
    foot: [footRow],
    styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [183, 192, 204], lineWidth: 0.1 },
    headStyles: { fillColor: [31, 56, 100], textColor: 255, lineWidth: 0.1 },
    footStyles: { fillColor: [232, 238, 247], textColor: [20, 20, 20], fontStyle: 'bold', lineWidth: 0.1 },
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
      if (data.section === 'body' && Array.isArray(raw) && raw[refColumnIndex] === '') {
        data.cell.styles.fillColor = [247, 249, 251]
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
      foot: [['', '', `Total (${pfiStock.length} PFIs)`, '', periodTotal.toLocaleString(), '', '', '']],
      styles: { fontSize: 7, cellPadding: 1.5, lineColor: [183, 192, 204], lineWidth: 0.1 },
      headStyles: { fillColor: [31, 56, 100], textColor: 255, lineWidth: 0.1 },
      footStyles: { fillColor: [232, 238, 247], textColor: [20, 20, 20], fontStyle: 'bold', lineWidth: 0.1 },
      // A batch charged for more BL than the tank received shows a negative
      // remaining — a real deficit, worth the same red flag it gets on screen.
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6 && String(data.cell.raw).trim().startsWith('-')) {
          data.cell.styles.textColor = [204, 0, 0]
        }
      },
    })
  }

  doc.save(`${buildFilename(filters)}.pdf`)
}
