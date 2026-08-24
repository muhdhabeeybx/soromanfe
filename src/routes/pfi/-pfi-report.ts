import { format } from 'date-fns'
import api from '#/lib/api/http'
import type { PfiWithFinancials, PfiExpense } from '#/lib/hooks/usePfis'
import {
  orderCompany, orderPaidInto, orderSalesValue, orderDifferential, fundingAmount,
  fundingDepositor, fundingPaidAt, fundingReference, fundingRecorder,
  type FinanceReportOrder,
} from '#/lib/hooks/useFinanceReport'
import {
  REPORT_COLUMNS, FINANCE_TABLE_COLUMNS, writeFinanceTable,
} from '#/routes/confirmed-payments/-finance-report-export'
import {
  XL, PDF, NGN, NGN_SIGNED, QTY, PCT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUMMARY_FILL, BAND_FILL,
  GRAND_TOTAL_FILL, HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  paintSigned, pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

/**
 * The PFI report.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *
 * The Summary sheet is a six-column grid of label/value pairs grouped under
 * navy section bars — PFI DETAILS, BL FIGURES, TANK FIGURES, STOCK MOVEMENT,
 * FINANCIAL SUMMARY, PEOPLE. It reads as a document rather than a dump,
 * which matters because this is the sheet that gets printed and circulated.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * Money that can go either way is coloured by its sign and nothing else is:
 * revenue and profit green, a loss red, a credit green (it reduces what the
 * batch cost), a discharge deficit red. Everything else stays black, so a
 * coloured figure always means the same thing.
 *
 * ── The three sheets ──────────────────────────────────────────────────────
 *
 * Summary, Confirmed Orders and Expenses. "Confirmed Orders" replaces the old
 * "Movements" sheet, which listed stock-ledger actions nobody reconciles
 * against; it is now the finance report's own table, filtered to this batch
 * and written by the finance module itself, so the two can never drift.
 */

const SECTION_SPAN = 6

/** A label/value pair; `tone` colours the value by what it means. */
type Pair = {
  label: string
  value: string | number | Date | null
  fmt?: string
  tone?: 'plain' | 'signed' | 'good' | 'bad'
  bold?: boolean
}

const up = (v: string) => (v || '').toUpperCase()
const dash = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : '—')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSectionBar(ws: any, row: number, title: string): number {
  const r = ws.getRow(row)
  r.height = ROW_HEIGHT.header
  r.getCell(1).value = title
  ws.mergeCells(row, 1, row, SECTION_SPAN)
  for (let i = 1; i <= SECTION_SPAN; i++) {
    const cell = r.getCell(i)
    cell.fill = HEADER_FILL
    cell.font = { ...HEADER_FONT, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border = ALL_BORDERS
  }
  return row + 1
}

/**
 * Three label/value pairs to a row across the six columns. Labels carry the
 * tint and the weight; values are plain, so the eye reads down the figures
 * rather than being pulled about by alternating emphasis.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writePairs(ws: any, startRow: number, pairs: Pair[]): number {
  let row = startRow
  for (let i = 0; i < pairs.length; i += 3) {
    const r = ws.getRow(row)
    r.height = ROW_HEIGHT.body
    for (let slot = 0; slot < 3; slot++) {
      const labelCol = slot * 2 + 1
      const valueCol = labelCol + 1
      const pair = pairs[i + slot]

      const labelCell = r.getCell(labelCol)
      const valueCell = r.getCell(valueCol)
      labelCell.border = ALL_BORDERS
      valueCell.border = ALL_BORDERS

      if (!pair) continue

      labelCell.value = up(pair.label)
      labelCell.fill = SUMMARY_FILL
      labelCell.font = { bold: true, size: 10, color: { argb: XL.headerNavy } }
      labelCell.alignment = { vertical: 'middle', indent: 1 }

      valueCell.value = pair.value as never
      if (pair.fmt) valueCell.numFmt = pair.fmt
      valueCell.alignment = { vertical: 'middle', indent: 1 }
      valueCell.font = { size: 10, bold: pair.bold ?? false }

      if (pair.tone === 'signed' && typeof pair.value === 'number') {
        paintSigned(valueCell, pair.value)
        valueCell.font = { ...valueCell.font, bold: true }
      } else if (pair.tone === 'good') {
        valueCell.font = { ...valueCell.font, bold: true, color: { argb: XL.gain } }
      } else if (pair.tone === 'bad') {
        valueCell.font = { ...valueCell.font, bold: true, color: { argb: XL.loss } }
      }
    }
    row++
  }
  return row
}

interface PfiReportData {
  pfi: PfiWithFinancials
  expenses: PfiExpense[]
  orders: FinanceReportOrder[]
}

/**
 * Everything the report needs, in two calls.
 *
 * The orders come from the finance-report endpoint rather than the PFI's own
 * movement ledger so the Confirmed Orders sheet is the finance report,
 * narrowed — same rows, same funding sub-rows, same figures.
 */
async function fetchReportData(pfiId: number): Promise<PfiReportData> {
  const [pfiRes, ordersRes] = await Promise.all([
    api.get(`/pfis/${pfiId}`),
    api.get('/finance-report', { params: { pfiId, paymentStatus: 'Paid' } }),
  ])
  const { pfi, expenses } = pfiRes.data.data as { pfi: PfiWithFinancials; expenses: PfiExpense[] }
  const orders = (ordersRes.data?.data?.orders || []) as FinanceReportOrder[]
  return { pfi, expenses, orders }
}

/** The finance-report totals, computed over just this batch's orders. */
function financeTotals(orders: FinanceReportOrder[]) {
  const seen = new Set<number>()
  let totalAmountPaid = 0
  for (const o of orders) {
    for (const f of o.funding) {
      // One deposit can fund several orders and is shown in full under each,
      // so it is counted once — the same rule the finance report itself uses.
      if (seen.has(f.depositId)) continue
      seen.add(f.depositId)
      totalAmountPaid += fundingAmount(f)
    }
  }
  return {
    totalQuantity: orders.reduce((s, o) => s + Number(o.quantity || 0), 0),
    totalSalesValue: orders.reduce((s, o) => s + orderSalesValue(o), 0),
    totalAmountPaid,
    totalDifferential: orders.reduce((s, o) => s + orderDifferential(o), 0),
  }
}

function summaryPairs(pfi: PfiWithFinancials): Array<{ title: string; pairs: Pair[] }> {
  const f = pfi.financials
  const deficit = f.surplusDeficitLitres
  const expensesApproved = f.totalExpenses
  const awaiting = (f as { pendingExpenses?: number }).pendingExpenses ?? 0

  return [
    {
      title: 'PFI DETAILS',
      pairs: [
        { label: 'PFI Number', value: pfi.pfiNumber, bold: true },
        { label: 'Status', value: pfi.status === 'active' ? 'ACTIVE' : 'FINISHED', bold: true },
        { label: 'Location', value: dash(pfi.locationName) },
        { label: 'Product', value: dash(pfi.productName) },
        { label: 'PFI Date', value: pfi.pfiDate ? new Date(pfi.pfiDate) : '—', fmt: pfi.pfiDate ? DATE_FMT : undefined },
        { label: 'Created', value: pfi.createdAt ? new Date(pfi.createdAt) : '—', fmt: pfi.createdAt ? DATE_FMT : undefined },
        { label: 'Date Completed', value: pfi.closureDate ? new Date(pfi.closureDate) : '—', fmt: pfi.closureDate ? DATE_FMT : undefined },
        { label: 'Quantity (MT)', value: Number(pfi.qtyVolumeMt) || f.blQtyMt || 0, fmt: '#,##0.000' },
        { label: 'Vessel Name', value: dash(pfi.vesselName) },
        { label: 'Vessel Broker', value: dash(pfi.vesselBroker) },
        { label: 'Surveyor', value: dash(pfi.surveyorName) },
        { label: 'Surveyor Phone', value: dash(pfi.surveyorPhone) },
      ],
    },
    {
      title: 'BL FIGURES',
      pairs: [
        { label: 'BL Quantity (Litres)', value: f.blQtyLitres ?? '—', fmt: f.blQtyLitres != null ? QTY : undefined },
        { label: 'BL Quantity (MT)', value: f.blQtyMt ?? '—', fmt: f.blQtyMt != null ? '#,##0.000' : undefined },
        { label: 'Price Per Litre', value: f.pricePerLitre ?? '—', fmt: f.pricePerLitre != null ? NGN : undefined },
        { label: 'PFI Value', value: f.pfiValue ?? '—', fmt: f.pfiValue != null ? NGN : undefined, bold: true },
      ],
    },
    {
      title: 'TANK FIGURES',
      pairs: [
        { label: 'Tank Quantity (Litres)', value: f.tankQtyLitres, fmt: QTY },
        // Signed on purpose: a shortage is red, an over-discharge green, and
        // the reading beside it says which in words for a monochrome print.
        { label: 'Surplus/Deficit (Litres)', value: deficit ?? '—', fmt: deficit != null ? '#,##0 "L";[Red](#,##0 "L")' : undefined, tone: deficit != null ? 'signed' : 'plain' },
        {
          label: 'Reading',
          value: deficit == null ? '—' : deficit < 0 ? 'DEFICIT' : deficit > 0 ? 'SURPLUS' : 'EXACT',
          tone: deficit == null ? 'plain' : deficit < 0 ? 'bad' : deficit > 0 ? 'good' : 'plain',
        },
      ],
    },
    {
      // Sold means payment confirmed, not loaded out — the same rule the
      // finance report uses, so Total Sold here and the Confirmed Orders
      // sheet's Total Quantity are the same number by construction.
      // "Still to load" names the gap where the trucks are behind the money.
      title: 'STOCK MOVEMENT',
      pairs: [
        { label: 'Initial Stock (Litres)', value: f.tankQtyLitres, fmt: QTY },
        { label: 'Total Sold (Litres)', value: f.sold, fmt: QTY, bold: true },
        { label: 'Remaining (Litres)', value: f.remaining, fmt: QTY, bold: true },
        { label: 'Percentage Sold', value: f.sellThrough ?? '—', fmt: f.sellThrough != null ? PCT : undefined },
        { label: 'Orders (Paid)', value: pfi.orderCount ?? 0, fmt: '#,##0' },
        { label: 'Ticketed Out (Litres)', value: f.movementQty, fmt: QTY },
        { label: 'Still To Load (Litres)', value: Math.max(0, f.sold - f.movementQty), fmt: QTY, tone: f.sold - f.movementQty > 0 ? 'bad' : 'plain' },
        { label: 'Delivery Allocated (Litres)', value: f.allocationQty, fmt: QTY },
      ],
    },
    {
      title: 'FINANCIAL SUMMARY',
      pairs: [
        { label: 'PFI (Cargo) Value', value: f.pfiValue ?? '—', fmt: f.pfiValue != null ? NGN : undefined },
        { label: 'Total Expenses (Approved)', value: expensesApproved, fmt: NGN },
        { label: 'Awaiting Approval', value: awaiting, fmt: NGN, tone: awaiting > 0 ? 'bad' : 'plain' },
        { label: 'Total Cost', value: f.totalCost ?? '—', fmt: f.totalCost != null ? NGN : undefined },
        // Grand total cost ÷ BL litres — what the batch cost per litre the
        // papers say was bought.
        { label: 'Landing Cost / Litre', value: f.landingCostPerLitre ?? '—', fmt: f.landingCostPerLitre != null ? NGN : undefined, bold: true },
        { label: 'Revenue', value: f.revenue, fmt: NGN, tone: 'good' },
        // A credit reduces what the batch cost, so it reads as a gain.
        { label: 'Credit', value: f.creditBalance || 0, fmt: NGN, tone: f.creditBalance > 0 ? 'good' : 'plain' },
        { label: 'Profit', value: f.profitLoss ?? '—', fmt: f.profitLoss != null ? NGN_SIGNED : undefined, tone: f.profitLoss != null ? 'signed' : 'plain' },
        { label: 'Margin', value: f.margin != null ? f.margin / 100 : '—', fmt: f.margin != null ? PCT : undefined, tone: f.margin != null && f.margin < 0 ? 'bad' : 'plain' },
      ],
    },
    {
      title: 'PEOPLE',
      pairs: [
        { label: 'Marketing', value: dash(pfi.salesManagerName) },
        { label: 'Finance', value: dash(pfi.commissionOfficerName) },
        { label: 'Sales Manager', value: dash(pfi.salesManagerName) },
        { label: 'Audit Officer', value: dash(pfi.auditOfficerName) },
        { label: 'Product Officer', value: dash(pfi.productOfficerName) },
        { label: 'IT Compliance', value: dash(pfi.itComplianceOfficerName) },
        { label: 'Security Exit', value: dash(pfi.securityExitOfficerName) },
        { label: 'Commission Officer', value: dash(pfi.commissionOfficerName) },
      ],
    },
  ]
}

/** The name of whoever entered an expense — never the staff id. */
function expenseEnteredBy(x: PfiExpense): string {
  const resolved = (x as { entered_by_name?: string | null }).entered_by_name
  if (resolved && resolved.trim()) return resolved
  const submitted = x.submitted_by_name
  if (submitted && submitted.trim()) return submitted
  // A bare number here is a staff id from an older write path and is worse
  // than nothing — it reads as data when it identifies no one.
  const raw = (x.entered_by || '').trim()
  return raw && !/^\d+$/.test(raw) ? raw : '—'
}

const EXPENSE_COLUMNS = [
  { header: 'Date', key: 'date', width: 13, fmt: DATE_FMT },
  { header: 'Reference', key: 'ref', width: 16 },
  { header: 'Category', key: 'cat', width: 26 },
  { header: 'Vendor', key: 'vendor', width: 24 },
  { header: 'Description', key: 'desc', width: 38 },
  { header: 'Bank Paid From', key: 'bank', width: 20 },
  { header: 'Added By', key: 'by', width: 22 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Amount', key: 'amount', width: 18, fmt: NGN },
]

function buildFilename(pfi: PfiWithFinancials): string {
  return `PFI Report - ${pfi.pfiNumber.replace(/[^\w-]+/g, '-')} - ${format(new Date(), 'dd-MM-yy')}`
}

// ══════════════════════════════════════════════════════════════════════════
// Excel
// ══════════════════════════════════════════════════════════════════════════

export async function downloadPfiReport(pfiId: number) {
  const { pfi, expenses, orders } = await fetchReportData(pfiId)
  const f = pfi.financials

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  // ── Summary ─────────────────────────────────────────────────────────
  const s = wb.addWorksheet('Summary', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  s.columns = [
    { width: 26 }, { width: 30 }, { width: 26 }, { width: 26 }, { width: 24 }, { width: 30 },
  ]

  const title = s.getRow(1)
  title.height = 34
  title.getCell(1).value = `PFI REPORT — ${up(pfi.pfiNumber)}`
  s.mergeCells(1, 1, 1, SECTION_SPAN)
  for (let i = 1; i <= SECTION_SPAN; i++) {
    const cell = title.getCell(i)
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 16, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  let cursor = 3
  for (const section of summaryPairs(pfi)) {
    cursor = writeSectionBar(s, cursor, section.title)
    cursor = writePairs(s, cursor, section.pairs)
    cursor += 1
  }

  // The caveats travel with the file. A figure read out of a spreadsheet
  // three weeks later has no page around it to explain itself.
  if (!f.profitIsMeaningful && f.sellThrough != null) {
    const warn = s.getRow(cursor)
    warn.getCell(1).value = 'NOTE'
    warn.getCell(2).value = `Only ${Math.round(f.sellThrough * 100)}% of this batch has been sold. The full cargo cost is charged against partial revenue, so the profit figure above is not yet economically real.`
    warn.getCell(1).font = { bold: true, color: { argb: XL.warn } }
    warn.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    s.mergeCells(cursor, 2, cursor, SECTION_SPAN)
    warn.height = 30
    cursor += 1
  }
  if (f.deficitCost != null) {
    const warn = s.getRow(cursor)
    warn.getCell(1).value = 'DEFICIT'
    warn.getCell(2).value = `${Math.abs(f.surplusDeficitLitres ?? 0).toLocaleString()} L was paid for but never landed, worth ${f.deficitCost.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })}. Landing cost against the tank quantity is ${(f as { landingCostPerLitreTank?: number | null }).landingCostPerLitreTank?.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' }) ?? '—'} per litre.`
    warn.getCell(1).font = { bold: true, color: { argb: XL.loss } }
    warn.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    s.mergeCells(cursor, 2, cursor, SECTION_SPAN)
    warn.height = 30
  }

  // ── Confirmed Orders — the finance report, narrowed to this batch ────
  const o = wb.addWorksheet('Confirmed Orders', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  o.columns = FINANCE_TABLE_COLUMNS
  const oTitle = o.getRow(1)
  oTitle.height = 26
  oTitle.getCell(1).value = `CONFIRMED ORDERS — ${up(pfi.pfiNumber)}`
  o.mergeCells(1, 1, 1, REPORT_COLUMNS.length)
  for (let i = 1; i <= REPORT_COLUMNS.length; i++) {
    const cell = oTitle.getCell(i)
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 13, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }
  if (orders.length > 0) {
    writeFinanceTable(o, orders, financeTotals(orders), 3)
  } else {
    o.getCell(3, 1).value = 'No confirmed orders on this PFI yet.'
    o.getCell(3, 1).font = { italic: true, color: { argb: XL.inkSoft } }
  }

  // ── Expenses ────────────────────────────────────────────────────────
  const e = wb.addWorksheet('Expenses', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  e.columns = EXPENSE_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const eTitle = e.getRow(1)
  eTitle.height = 26
  eTitle.getCell(1).value = `EXPENSES — ${up(pfi.pfiNumber)}`
  e.mergeCells(1, 1, 1, EXPENSE_COLUMNS.length)
  for (let i = 1; i <= EXPENSE_COLUMNS.length; i++) {
    const cell = eTitle.getCell(i)
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 13, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }

  const eHead = e.getRow(3)
  eHead.values = EXPENSE_COLUMNS.map((c) => c.header)
  eHead.height = ROW_HEIGHT.header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eHead.eachCell((cell: any) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  let eRow = 4
  expenses.forEach((x, i) => {
    const row = e.getRow(eRow)
    row.height = ROW_HEIGHT.body
    row.values = {
      date: x.expense_date ? new Date(x.expense_date) : null,
      ref: x.reference_number || '—',
      cat: x.category_name || '—',
      vendor: x.vendor || '—',
      desc: x.description || '—',
      bank: x.bank_paid_from || '—',
      by: expenseEnteredBy(x),
      status: x.status_label || x.status || '—',
      amount: Number(x.amount) || 0,
    }
    for (const c of EXPENSE_COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (i % 2 === 1) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
    }
    // Anything not yet paid is money still committed rather than spent, and
    // is the one thing on this sheet worth flagging.
    if (x.status !== 'paid') {
      row.getCell('status').font = { bold: true, color: { argb: XL.warn } }
    }
    eRow++
  })

  const eTotal = e.getRow(eRow)
  eTotal.height = ROW_HEIGHT.total
  eTotal.values = { by: `TOTAL (${expenses.length} lines)`, amount: f.totalExpenses }
  for (let i = 1; i <= EXPENSE_COLUMNS.length; i++) {
    const cell = eTotal.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  eTotal.getCell('amount').numFmt = NGN
  e.views = [{ state: 'frozen', ySplit: 3 }]
  e.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: EXPENSE_COLUMNS.length } }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${buildFilename(pfi)}.xlsx`,
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════════════

export async function downloadPfiReportPdf(pfiId: number) {
  const { pfi, expenses, orders } = await fetchReportData(pfiId)
  const f = pfi.financials

  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  let cursorY = drawPdfHeader(
    doc,
    `PFI Report — ${pfi.pfiNumber}`,
    [
      `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
      `Status: ${pfi.status === 'active' ? 'Active' : 'Finished'}`,
      `Location: ${pfi.locationName || '—'}`,
      `Product: ${pfi.productName || '—'}`,
    ].join('   ·   '),
  )

  /** A pair as it prints: the value already formatted for a PDF cell. */
  const renderPair = (p: Pair): string => {
    if (p.value == null) return '—'
    if (p.value instanceof Date) return format(p.value, DATE_PATTERN)
    if (typeof p.value === 'number') {
      if (p.fmt === PCT) return `${(p.value * 100).toFixed(1)}%`
      if (p.fmt === QTY) return `${p.value.toLocaleString()} L`
      if (p.fmt && p.fmt.includes('L')) return `${p.value.toLocaleString()} L`
      if (p.fmt === NGN || p.fmt === NGN_SIGNED) return pdfNaira(p.value)
      if (p.fmt === '#,##0.000') return p.value.toLocaleString(undefined, { maximumFractionDigits: 3 })
      return p.value.toLocaleString()
    }
    return String(p.value)
  }

  for (const section of summaryPairs(pfi)) {
    const body: string[][] = []
    const tones: Array<Array<Pair['tone']>> = []
    for (let i = 0; i < section.pairs.length; i += 3) {
      const cells: string[] = []
      const rowTones: Array<Pair['tone']> = []
      for (let slot = 0; slot < 3; slot++) {
        const p = section.pairs[i + slot]
        cells.push(p ? up(p.label) : '', p ? renderPair(p) : '')
        rowTones.push(undefined, p?.tone)
      }
      body.push(cells)
      tones.push(rowTones)
    }

    autoTable(doc, {
      startY: cursorY,
      head: [[{ content: section.title, colSpan: SECTION_SPAN }]],
      body,
      styles: { ...pdfStyles.body, fontSize: 8, cellPadding: 2.5 },
      headStyles: { ...pdfStyles.head, fontSize: 9, halign: 'left' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== 'body') return
        const isLabel = data.column.index % 2 === 0
        if (isLabel) {
          data.cell.styles.fillColor = PDF.summaryTint
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = PDF.headerNavy
          return
        }
        const tone = tones[data.row.index]?.[data.column.index]
        const text = String(data.cell.raw ?? '').trim()
        if (tone === 'good') {
          data.cell.styles.textColor = PDF.gain
          data.cell.styles.fontStyle = 'bold'
        } else if (tone === 'bad') {
          data.cell.styles.textColor = PDF.loss
          data.cell.styles.fontStyle = 'bold'
        } else if (tone === 'signed' && text && text !== '—') {
          data.cell.styles.textColor = text.startsWith('(') || text.startsWith('-') ? PDF.loss : PDF.gain
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 4
  }

  // ── Confirmed Orders ────────────────────────────────────────────────
  doc.addPage('a4', 'landscape')
  cursorY = drawPdfHeader(
    doc,
    `Confirmed Orders — ${pfi.pfiNumber}`,
    `${orders.length} order${orders.length === 1 ? '' : 's'} · the finance report, narrowed to this batch`,
  )

  if (orders.length > 0) {
    const totals = financeTotals(orders)
    const cellsFor = (scope: 'order' | 'funding', values: Record<string, string | number>) =>
      REPORT_COLUMNS.map((c) => (c.scope === scope ? (values[c.key] ?? '') : ''))

    const body: (string | number)[][] = []
    orders.forEach((ord, i) => {
      const d = orderDifferential(ord)
      body.push(
        cellsFor('order', {
          sn: i + 1,
          date: ord.createdAt ? format(new Date(ord.createdAt), DATE_PATTERN) : '—',
          ref: up(ord.reference),
          pfi: up(ord.pfiNumber || '—'),
          customer: up(ord.customerName || 'Unknown'),
          company: up(orderCompany(ord) || ''),
          qty: Number(ord.quantity || 0).toLocaleString(),
          product: up(ord.productName || '—'),
          rate: pdfNaira(Number(ord.price || 0)),
          salesValue: pdfNaira(orderSalesValue(ord)),
          differential: Math.abs(d) < 0.005 ? '—' : pdfNaira(d),
          paidInto: up(orderPaidInto(ord) || '—'),
        }),
      )
      if (ord.fundingTracked) {
        for (const fund of ord.funding) {
          const paidAt = fundingPaidAt(fund)
          body.push(
            cellsFor('funding', {
              depositDate: paidAt ? format(new Date(String(paidAt)), DATE_PATTERN) : '—',
              depositor: up(fundingDepositor(fund) || '—'),
              depositRef: up(fundingReference(fund) || '—'),
              amount: pdfNaira(fundingAmount(fund)),
              recordedBy: up(fundingRecorder(fund) || '—'),
            }),
          )
        }
      }
    })

    const footRow = new Array(REPORT_COLUMNS.length).fill('')
    const footAt = (key: string, value: string) => {
      const idx = REPORT_COLUMNS.findIndex((c) => c.key === key)
      if (idx >= 0) footRow[idx] = value
    }
    footAt('ref', `Total (${orders.length} orders)`)
    footAt('qty', totals.totalQuantity.toLocaleString())
    footAt('salesValue', pdfNaira(totals.totalSalesValue))
    footAt('amount', pdfNaira(totals.totalAmountPaid))
    footAt('differential', pdfNaira(totals.totalDifferential))

    const refIdx = REPORT_COLUMNS.findIndex((c) => c.key === 'ref')
    const diffIdx = REPORT_COLUMNS.findIndex((c) => c.key === 'differential')

    autoTable(doc, {
      startY: cursorY,
      head: [REPORT_COLUMNS.map((c) => c.header)],
      body,
      foot: [footRow],
      styles: pdfStyles.body,
      headStyles: pdfStyles.head,
      footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        const raw = data.row.raw
        if (!Array.isArray(raw)) return
        if (data.section === 'body' && raw[refIdx] === '') {
          data.cell.styles.fillColor = PDF.subRowTint
          return
        }
        if (data.section === 'body' && data.column.index === refIdx) {
          data.cell.styles.fontStyle = 'bold'
        }
        if (data.column.index === diffIdx) {
          const text = String(data.cell.raw).trim()
          if (text && text !== '—') {
            data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
          }
        }
      },
    })
  } else {
    doc.setFontSize(9)
    doc.setTextColor(...PDF.inkSoft)
    doc.text('No confirmed orders on this PFI yet.', 14, cursorY)
    doc.setTextColor(...PDF.ink)
  }

  // ── Expenses ────────────────────────────────────────────────────────
  doc.addPage('a4', 'landscape')
  cursorY = drawPdfHeader(
    doc,
    `Expenses — ${pfi.pfiNumber}`,
    `${expenses.length} line${expenses.length === 1 ? '' : 's'} · ${pdfNaira(f.totalExpenses)} approved`,
  )

  autoTable(doc, {
    startY: cursorY,
    head: [EXPENSE_COLUMNS.map((c) => c.header)],
    body: expenses.map((x) => [
      x.expense_date ? format(new Date(x.expense_date), DATE_PATTERN) : '—',
      x.reference_number || '—',
      x.category_name || '—',
      x.vendor || '—',
      x.description || '—',
      x.bank_paid_from || '—',
      expenseEnteredBy(x),
      x.status_label || x.status || '—',
      pdfNaira(Number(x.amount) || 0),
    ]),
    foot: [['', '', '', '', '', '', `TOTAL (${expenses.length} lines)`, '', pdfNaira(f.totalExpenses)]],
    styles: { ...pdfStyles.body, fontSize: 7 },
    headStyles: pdfStyles.head,
    footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 7) {
        if (String(data.cell.raw).toLowerCase() !== 'paid') {
          data.cell.styles.textColor = [154, 103, 0]
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  drawPdfFooters(doc, `Soroman PFI Report · ${pfi.pfiNumber}`)
  doc.save(`${buildFilename(pfi)}.pdf`)
}

// ══════════════════════════════════════════════════════════════════════════
// Portfolio
// ══════════════════════════════════════════════════════════════════════════

/** Portfolio view: every PFI on one sheet, with totals that actually sum. */
export async function downloadMasterReport(pfis: PfiWithFinancials[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  const ws = wb.addWorksheet('All PFIs', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const COLUMNS = [
    { header: 'PFI', key: 'pfi', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Location', key: 'loc', width: 18 },
    { header: 'Product', key: 'product', width: 22 },
    { header: 'BL Qty', key: 'bl', width: 16, fmt: QTY },
    { header: 'Tank Qty', key: 'tank', width: 16, fmt: QTY },
    { header: 'Surplus/Deficit', key: 'gap', width: 16, fmt: '#,##0 "L";[Red](#,##0 "L")', signed: true },
    { header: 'Sold', key: 'sold', width: 16, fmt: QTY },
    { header: 'Remaining', key: 'rem', width: 16, fmt: QTY },
    { header: 'Sell-through', key: 'through', width: 14, fmt: PCT },
    { header: 'Cargo Value', key: 'cargo', width: 18, fmt: NGN },
    { header: 'Expenses', key: 'exp', width: 18, fmt: NGN },
    { header: 'Total Cost', key: 'cost', width: 18, fmt: NGN },
    { header: 'Landing Cost / L', key: 'landing', width: 16, fmt: NGN },
    { header: 'Revenue', key: 'rev', width: 18, fmt: NGN },
    { header: 'Profit / Loss', key: 'profit', width: 18, fmt: NGN_SIGNED, signed: true },
    { header: 'Profit Meaningful?', key: 'meaningful', width: 20 },
  ]
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const title = ws.getRow(1)
  title.height = 30
  title.getCell(1).value = 'SOROMAN — PFI PORTFOLIO'
  ws.mergeCells(1, 1, 1, COLUMNS.length)
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = title.getCell(i)
    cell.fill = HEADER_FILL
    cell.font = { bold: true, size: 14, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }
  ws.getRow(2).getCell(1).value = `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')} · ${pfis.length} batches`
  ws.getRow(2).getCell(1).font = { size: 9, color: { argb: XL.inkSoft } }

  const head = ws.getRow(4)
  head.values = COLUMNS.map((c) => c.header)
  head.height = ROW_HEIGHT.header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  head.eachCell((cell: any) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  let cursor = 5
  let cost = 0, revenue = 0, expenses = 0, costed = 0
  pfis.forEach((p, i) => {
    const f = p.financials
    expenses += f.totalExpenses
    revenue += f.revenue
    if (f.totalCost != null) { cost += f.totalCost; costed++ }

    const row = ws.getRow(cursor)
    row.height = ROW_HEIGHT.body
    row.values = {
      pfi: p.pfiNumber,
      status: p.status === 'active' ? 'Active' : 'Finished',
      loc: p.locationName || '',
      product: p.productName || '',
      bl: f.blQtyLitres ?? '',
      tank: f.tankQtyLitres,
      gap: f.surplusDeficitLitres ?? '',
      sold: f.sold,
      rem: f.remaining,
      through: f.sellThrough ?? '',
      cargo: f.pfiValue ?? '',
      exp: f.totalExpenses,
      cost: f.totalCost ?? '',
      landing: f.landingCostPerLitre ?? '',
      rev: f.revenue,
      profit: f.profitLoss ?? '',
      // Spelled out rather than left to a reader's judgement.
      meaningful: f.profitIsMeaningful ? 'Yes' : `No — ${Math.round((f.sellThrough ?? 0) * 100)}% sold`,
    }
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (i % 2 === 1) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
      if (c.signed) {
        const v = (row.getCell(c.key).value ?? null) as number | null
        if (typeof v === 'number') paintSigned(cell, v)
      }
    }
    row.getCell('pfi').font = { bold: true }
    cursor++
  })

  const total = ws.getRow(cursor)
  total.height = ROW_HEIGHT.total
  total.values = {
    pfi: `PORTFOLIO (${pfis.length} batches)`,
    exp: expenses,
    cost,
    rev: revenue,
    profit: costed > 0 ? revenue - cost : '',
  }
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = total.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const k of ['exp', 'cost', 'rev']) total.getCell(k).numFmt = NGN
  total.getCell('profit').numFmt = NGN_SIGNED
  if (costed > 0) paintSigned(total.getCell('profit'), revenue - cost)
  cursor++

  // Unpriced batches are excluded from the cost total; say so in the file
  // rather than letting the column quietly understate.
  if (costed < pfis.length) {
    const note = ws.getRow(cursor)
    note.getCell(1).value = `Note: ${pfis.length - costed} batch(es) have no BL quantity or price and are excluded from the cost and profit totals.`
    note.getCell(1).font = { color: { argb: XL.warn } }
    ws.mergeCells(cursor, 1, cursor, COLUMNS.length)
  }

  ws.views = [{ state: 'frozen', ySplit: 4 }]
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLUMNS.length } }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `PFI Portfolio ${format(new Date(), 'dd-MM-yy')}.xlsx`,
  )
}
