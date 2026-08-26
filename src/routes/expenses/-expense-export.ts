import { format } from 'date-fns'

import {
  XL, PDF, NGN, NGN_SIGNED, COUNT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUMMARY_FILL, TOTAL_FILL, GRAND_TOTAL_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading, paintSigned,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'
import {
  expenseTotals, categoryGrouping, statusXl, statusPdf, categoryXl, categoryPdf,
} from '#/lib/expense-presentation'
import type { PfiExpense } from '#/lib/hooks/usePfis'

/**
 * The expenses register, as Excel and as PDF.
 *
 * Replaces a CSV. A CSV cannot carry a total, a colour or a column width, so
 * every one of these files was being re-formatted by hand before it could be
 * shown to anyone — and a status column that is only a word is no faster to
 * read on paper than the screen it came from.
 *
 * Money and dates are written as real numbers and real dates with a cell
 * format, never as pre-formatted strings: a column that looks like money but
 * is text cannot be summed, and summing a column is the first thing anyone
 * does with one of these.
 *
 * Both files carry the same three summaries before the detail — the totals,
 * then where the money sits in the approval chain, then what kind of cost it
 * is. Those are the questions a register gets asked; answering them at the
 * top means the reader does not have to build a pivot table to start.
 */

export interface ExpenseExportMeta {
  /** "Expenses" or "My Requests" — this file serves both pages. */
  title: string
  /** Human description of the filters in force, shown under the title. */
  scope: string
  /** Filename stem, e.g. "expenses" or "my-expense-requests". */
  slug: string
  /** The VAT rate in force, for the column heading. */
  vatRate: number
}

type Col = {
  header: string
  width: number
  align?: 'left' | 'right' | 'center'
  /** Excel number format, when the value is written as a number. */
  fmt?: string
  get: (e: PfiExpense, i: number) => string | number | Date | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Blank until settled — a request awaiting payment has not paid ₦0. */
const paidFigure = (e: PfiExpense): number | null => {
  if (e.amount_paid != null) return num(e.amount_paid)
  return e.status === 'paid' ? num(e.amount) : null
}

const columns = (vatRate: number): Col[] => [
  { header: 'S/N', width: 6, align: 'right', fmt: COUNT, get: (_e, i) => i + 1 },
  { header: 'Reference', width: 18, get: (e) => e.reference_number || '' },
  { header: 'Date', width: 13, fmt: DATE_FMT, get: (e) => (e.expense_date ? new Date(e.expense_date) : null) },
  { header: 'Type', width: 12, get: (e) => (e.pfi_id ? 'PFI Attached' : 'General') },
  { header: 'Cost group', width: 24, get: (e) => categoryGrouping(e) },
  { header: 'Category', width: 30, get: (e) => e.category_name || '' },
  { header: 'PFI', width: 26, get: (e) => e.pfi_number || '' },
  // Upper-cased to match the register on screen. The ledger already writes
  // these in a mix of cases — "Vessel hire MT Princesses Oge" beside "MT ZONDA
  // VESEL HIRE" — and one case makes a column of them scannable.
  { header: 'Vendor', width: 26, get: (e) => (e.vendor || '').toUpperCase() },
  { header: 'Purpose', width: 46, get: (e) => (e.description || '').toUpperCase() },
  { header: 'Amount ex VAT', width: 16, align: 'right', fmt: NGN, get: (e) => num(e.amount_ex_vat) },
  { header: `VAT ${(vatRate * 100).toFixed(1)}%`, width: 14, align: 'right', fmt: NGN, get: (e) => num(e.vat_amount) },
  { header: 'Invoice amount', width: 16, align: 'right', fmt: NGN, get: (e) => num(e.invoice_amount) },
  { header: 'WHT %', width: 9, align: 'right', get: (e) => (e.wht_rate ? `${Number(e.wht_rate)}%` : '') },
  { header: 'WHT deducted', width: 15, align: 'right', fmt: NGN, get: (e) => num(e.wht_deduction) },
  { header: 'Amount requested', width: 18, align: 'right', fmt: NGN, get: (e) => num(e.amount) },
  { header: 'Amount paid', width: 16, align: 'right', fmt: NGN, get: (e) => paidFigure(e) },
  { header: 'Payee bank', width: 22, get: (e) => e.payee_bank_name || '' },
  { header: 'Paid from', width: 24, get: (e) => e.bank_paid_from || '' },
  { header: 'Raised by', width: 22, get: (e) => e.submitted_by_name || '' },
  { header: 'Status', width: 20, get: (e) => e.status_label || e.status },
]

/** Columns whose totals belong on the footer row, by header. */
const SUMMED = new Set([
  'Amount ex VAT', 'Invoice amount', 'WHT deducted', 'Amount requested', 'Amount paid',
])

const filename = (slug: string, ext: string) =>
  `${slug}_${format(new Date(), 'yyyy-MM-dd')}.${ext}`

// ── Excel ─────────────────────────────────────────────────────────────────

export async function exportExpensesExcel(rows: PfiExpense[], meta: ExpenseExportMeta) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman'
  wb.created = new Date()

  const ws = wb.addWorksheet('Expenses', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const cols = columns(meta.vatRate)
  const t = expenseTotals(rows)
  const vatPct = (meta.vatRate * 100).toFixed(1)

  ws.columns = cols.map((c) => ({ width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: `Soroman — ${meta.title}`,
    subtitle: `${meta.scope} · ${t.count} request${t.count === 1 ? '' : 's'} · generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    columnSpan: cols.length,
  })
  cursor++

  // ── Totals ──────────────────────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'SUMMARY')
  const totalPairs: Array<[string, number, string]> = [
    ['Requests', t.count, COUNT],
    ['Total requested', t.requested, NGN],
    ['Total paid', t.paid, NGN],
    ['Outstanding', t.outstanding, NGN_SIGNED],
    [`VAT (${vatPct}%)`, t.vat, NGN],
    ['WHT deducted', t.wht, NGN],
  ]
  for (const [label, value, fmt] of totalPairs) {
    const r = ws.getRow(cursor)
    r.height = ROW_HEIGHT.body
    r.getCell(1).value = label
    r.getCell(1).font = { bold: true, size: 10 }
    r.getCell(2).value = value
    r.getCell(2).numFmt = fmt
    // Outstanding is the one figure here whose sign means something: money
    // still owed versus money overpaid.
    if (label === 'Outstanding') paintSigned(r.getCell(2), value)
    for (const col of [1, 2]) {
      r.getCell(col).fill = SUMMARY_FILL
      r.getCell(col).border = ALL_BORDERS
    }
    cursor++
  }
  cursor++

  // ── Where it sits in the chain ──────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'BY STATUS')
  cursor = writeMiniTable(
    ws, cursor,
    ['Status', 'Requests', 'Amount'],
    t.byStatus.map((s) => [s.label, s.count, s.amount] as [string, number, number]),
    (row, i) => {
      const tone = statusXl(t.byStatus[i].status)
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
      row.getCell(1).font = { bold: true, size: 10, color: { argb: tone.ink } }
    },
  )
  cursor++

  // ── What kind of cost ───────────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'BY COST GROUP')
  cursor = writeMiniTable(
    ws, cursor,
    ['Cost group', 'Requests', 'Amount'],
    t.byKind.map((k) => [k.label, k.count, k.amount] as [string, number, number]),
  )
  cursor += 2

  // ── The detail ──────────────────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'DETAIL')

  const headerRow = ws.getRow(cursor)
  headerRow.height = ROW_HEIGHT.header
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left', wrapText: true }
  })
  const headerAt = cursor
  cursor++

  const firstBody = cursor
  rows.forEach((e, i) => {
    const r = ws.getRow(cursor)
    r.height = ROW_HEIGHT.body
    cols.forEach((c, ci) => {
      const cell = r.getCell(ci + 1)
      const v = c.get(e, i)
      cell.value = v as never
      if (c.fmt) cell.numFmt = c.fmt
      cell.border = ALL_BORDERS
      // Purpose is the column that runs long; letting it wrap is what stops
      // the sheet hiding half a description behind the next column.
      cell.alignment = {
        vertical: 'top',
        horizontal: c.align ?? 'left',
        wrapText: c.header === 'Purpose' || c.header === 'Category' || c.header === 'PFI',
      }
    })
    // The status and category cells carry their own colour, so a printed
    // sheet sorts by eye the way the screen does.
    const tone = statusXl(e.status)
    const statusCell = r.getCell(cols.findIndex((c) => c.header === 'Status') + 1)
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
    statusCell.font = { bold: true, color: { argb: tone.ink } }

    const groupCell = r.getCell(cols.findIndex((c) => c.header === 'Cost group') + 1)
    groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: categoryXl(e) } }

    // The two figures anyone compares: what was asked for, and what actually
    // moved. Same blue and green as the table.
    const askedCell = r.getCell(cols.findIndex((c) => c.header === 'Amount requested') + 1)
    askedCell.font = { bold: true, color: { argb: XL.internal } }
    const paidCell = r.getCell(cols.findIndex((c) => c.header === 'Amount paid') + 1)
    paidCell.font = { bold: true, color: { argb: XL.gain } }
    cursor++
  })

  // ── Footer totals ───────────────────────────────────────────────────
  const totalRow = ws.getRow(cursor)
  totalRow.height = ROW_HEIGHT.total
  cols.forEach((c, i) => {
    const cell = totalRow.getCell(i + 1)
    if (i === 0) cell.value = 'TOTAL'
    else if (SUMMED.has(c.header) && rows.length > 0) {
      const letter = ws.getColumn(i + 1).letter
      cell.value = { formula: `SUM(${letter}${firstBody}:${letter}${cursor - 1})` } as never
      cell.numFmt = NGN
    }
    cell.font = TOTAL_FONT
    cell.fill = i === 0 ? GRAND_TOTAL_FILL : TOTAL_FILL
    cell.border = TOTAL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left' }
  })

  // Freeze under the detail header and turn on filters, so a long register
  // stays navigable — the header is the one row a reader keeps needing.
  ws.views = [{ state: 'frozen', ySplit: headerAt }]
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerAt, column: 1 },
      to: { row: cursor - 1, column: cols.length },
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename(meta.slug, 'xlsx'),
  )
}

/** A small labelled block — heading row, body rows, no totals. */
function writeMiniTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  startRow: number,
  headers: string[],
  body: Array<[string, number, number]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decorate?: (row: any, index: number) => void,
): number {
  let row = startRow
  const head = ws.getRow(row)
  head.height = ROW_HEIGHT.header
  headers.forEach((h, i) => {
    const cell = head.getCell(i + 1)
    cell.value = h
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
  })
  row++

  for (const [i, [label, count, amount]] of body.entries()) {
    const r = ws.getRow(row)
    r.height = ROW_HEIGHT.body
    r.getCell(1).value = label
    r.getCell(2).value = count
    r.getCell(2).numFmt = COUNT
    r.getCell(3).value = amount
    r.getCell(3).numFmt = NGN
    for (const c of [1, 2, 3]) {
      r.getCell(c).border = ALL_BORDERS
      r.getCell(c).alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' }
    }
    decorate?.(r, i)
    row++
  }
  return row
}

// ── PDF ───────────────────────────────────────────────────────────────────

export async function exportExpensesPdf(rows: PfiExpense[], meta: ExpenseExportMeta) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const t = expenseTotals(rows)
  const vatPct = (meta.vatRate * 100).toFixed(1)

  let y = drawPdfHeader(
    doc,
    `Soroman — ${meta.title}`,
    `${meta.scope} · ${t.count} request${t.count === 1 ? '' : 's'} · generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
  )

  // ── Summary, laid out as two blocks side by side ─────────────────────
  autoTable(doc, {
    startY: y,
    head: [['Summary', 'Value']],
    body: [
      ['Requests', String(t.count)],
      ['Total requested', pdfNaira(t.requested)],
      ['Total paid', pdfNaira(t.paid)],
      ['Outstanding', pdfNaira(t.outstanding)],
      [`VAT (${vatPct}%)`, pdfNaira(t.vat)],
      ['WHT deducted', pdfNaira(t.wht)],
    ],
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 14 },
  })

  autoTable(doc, {
    startY: y,
    head: [['By status', 'No.', 'Amount']],
    body: t.byStatus.map((s) => [s.label, String(s.count), pdfNaira(s.amount)]),
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right', cellWidth: 12 }, 2: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 108 },
    // Each status keeps its colour here too, so the two summaries and the
    // detail table below all say "paid" in the same green.
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 0) return
      const tone = statusPdf(t.byStatus[data.row.index].status)
      data.cell.styles.fillColor = tone.fill
      data.cell.styles.textColor = tone.ink
      data.cell.styles.fontStyle = 'bold'
    },
  })

  autoTable(doc, {
    startY: y,
    head: [['By cost group', 'No.', 'Amount']],
    body: t.byKind.map((k) => [k.label, String(k.count), pdfNaira(k.amount)]),
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right', cellWidth: 12 }, 2: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 202 },
  })

  y = (doc as any).lastAutoTable.finalY + 8

  // ── Detail ───────────────────────────────────────────────────────────
  // A narrower column set than the sheet: a landscape A4 that tries to carry
  // all twenty columns gives each of them about 12mm, and nothing is
  // readable. The full set is in the Excel file, which is the one people
  // work in; this is the one they hand across a desk.
  const head = [
    'S/N', 'Reference', 'Date', 'Cost group', 'Category', 'PFI', 'Vendor', 'Purpose',
    'Invoice', 'WHT', 'Requested', 'Paid', 'Paid from', 'Raised by', 'Status',
  ]

  autoTable(doc, {
    startY: y,
    head: [head],
    body: rows.map((e, i) => [
      String(i + 1),
      e.reference_number || '—',
      e.expense_date ? format(new Date(e.expense_date), DATE_PATTERN) : '—',
      categoryGrouping(e),
      e.category_name || '—',
      e.pfi_number || '—',
      (e.vendor || '—').toUpperCase(),
      (e.description || '—').toUpperCase(),
      num(e.invoice_amount) != null ? pdfNaira(num(e.invoice_amount)!) : '—',
      num(e.wht_deduction) ? pdfNaira(num(e.wht_deduction)!) : '—',
      pdfNaira(Number(e.amount) || 0),
      paidFigure(e) != null ? pdfNaira(paidFigure(e)!) : '—',
      e.bank_paid_from || '—',
      e.submitted_by_name || '—',
      e.status_label || e.status,
    ]),
    foot: rows.length
      ? [[
          'TOTAL', '', '', '', '', '', '', '',
          '', pdfNaira(t.wht), pdfNaira(t.requested), pdfNaira(t.paid), '', '', '',
        ]]
      : undefined,
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: pdfStyles.foot,
    // Zebra striping on a long register, so the eye tracks across a wide row
    // without losing its line.
    alternateRowStyles: { fillColor: PDF.bandTint },
    columnStyles: {
      0: { halign: 'right', cellWidth: 8 },
      1: { cellWidth: 20 },
      2: { cellWidth: 16 },
      3: { cellWidth: 22 },
      5: { cellWidth: 24 },
      8: { halign: 'right', cellWidth: 20 },
      9: { halign: 'right', cellWidth: 17 },
      10: { halign: 'right', cellWidth: 22 },
      11: { halign: 'right', cellWidth: 21 },
      14: { cellWidth: 24 },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const e = rows[data.row.index]
      if (!e) return
      if (data.column.index === 14) {
        const tone = statusPdf(e.status)
        data.cell.styles.fillColor = tone.fill
        data.cell.styles.textColor = tone.ink
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 3) data.cell.styles.fillColor = categoryPdf(e)
      // Requested in blue, paid in green — the same pairing as the table.
      if (data.column.index === 10) {
        data.cell.styles.textColor = PDF.internal
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.column.index === 11 && paidFigure(e) != null) {
        data.cell.styles.textColor = PDF.gain
        data.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: 8, right: 8 },
  })

  drawPdfFooters(doc, `Soroman — ${meta.title} · ${meta.scope}`)
  doc.save(filename(meta.slug, 'pdf'))
}
