import { format } from 'date-fns'

import { isPaid, isVoidOrder, toNumber } from './-orders-utils'
import {
  XL, PDF, NGN, QTY, COUNT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUMMARY_FILL, TOTAL_FILL, GRAND_TOTAL_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

/**
 * The orders register, as Excel and as PDF.
 *
 * Both take the filtered set sorted oldest-first, so the file matches what is
 * on screen rather than the raw table.
 *
 * This used to be a bold header row and nothing else — no borders, no totals,
 * no number formats, so a column of amounts arrived as text and could not be
 * summed, and the reader had no figure for what they were looking at without
 * adding it up themselves. The point of downloading a register is to see what
 * is happening, which means the summaries come first.
 *
 * The spec's Truck No. / Trucks Loaded / Vol. Loaded columns are absent: the
 * Node backend's order model has no truck-ticket relation to source them from.
 */

export interface OrderExportFilters {
  pfi?: string
  location?: string
}

type Col = {
  header: string
  width: number
  align?: 'left' | 'right'
  fmt?: string
  wrap?: boolean
  get: (o: any, i: number) => string | number | Date | null
}

const COLUMNS: Col[] = [
  { header: 'S/N', width: 6, align: 'right', fmt: COUNT, get: (_o, i) => i + 1 },
  { header: 'Reference', width: 18, get: (o) => o.orderNumber ?? '' },
  { header: 'Date', width: 13, fmt: DATE_FMT, get: (o) => (o.createdAt ? new Date(o.createdAt) : null) },
  { header: 'Customer', width: 26, get: (o) => (o.customerName ?? '').toUpperCase() },
  { header: 'Company', width: 26, get: (o) => (o.customerCompanyName ?? '').toUpperCase() },
  { header: 'Contact', width: 16, get: (o) => o.customerPhone ?? '' },
  { header: 'Location', width: 20, get: (o) => o.depotName ?? o.state ?? '' },
  { header: 'PFI', width: 24, wrap: true, get: (o) => o.pfiNumber ?? '' },
  { header: 'Product', width: 20, get: (o) => o.productName ?? '' },
  { header: 'Quantity', width: 14, align: 'right', fmt: QTY, get: (o) => toNumber(o.quantity) },
  { header: 'Unit price', width: 15, align: 'right', fmt: NGN, get: (o) => toNumber(o.price) },
  { header: 'Amount', width: 18, align: 'right', fmt: NGN, get: (o) => toNumber(o.totalAmount) },
  { header: 'Payment', width: 12, get: (o) => (isPaid(o) ? 'Paid' : 'Unpaid') },
  { header: 'Status', width: 14, get: (o) => o.status ?? '' },
]

const SUMMED = new Set(['Quantity', 'Amount'])

const oldestFirst = (rows: any[]) =>
  [...rows].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  )

/** Filenames pick up whichever PFI and location filters are active. */
export function buildFilename(prefix: string, filters: OrderExportFilters) {
  const parts = [prefix]
  if (filters.location && filters.location !== 'all') parts.push(filters.location.replace(/\s+/g, '-'))
  if (filters.pfi && filters.pfi !== 'all') parts.push(filters.pfi.replace(/\s+/g, '-'))
  parts.push(format(new Date(), 'yyyy-MM-dd'))
  return parts.join('_')
}

const scopeLine = (filters: OrderExportFilters) => {
  const parts: string[] = []
  if (filters.location && filters.location !== 'all') parts.push(filters.location)
  if (filters.pfi && filters.pfi !== 'all') parts.push(filters.pfi)
  return parts.length ? `Filtered: ${parts.join(' · ')}` : 'All orders'
}

/**
 * What the register adds up to.
 *
 * Cancelled and expired orders are counted but their litres and value are
 * held apart from the live totals — they are orders nobody will ever load,
 * and folding them in overstates both the book and the volume committed.
 * This is the same rule the orders page itself applies; see isVoidOrder.
 */
function orderTotals(rows: any[]) {
  let quantity = 0
  let value = 0
  let paidValue = 0
  let paidCount = 0
  let voidCount = 0
  let voidValue = 0
  const byStatus = new Map<string, { count: number; value: number }>()
  const byProduct = new Map<string, { count: number; quantity: number; value: number }>()
  const byLocation = new Map<string, { count: number; value: number }>()

  for (const o of rows) {
    const qty = toNumber(o.quantity)
    const amount = toNumber(o.totalAmount)
    const status = o.status || 'Unknown'

    const s = byStatus.get(status) ?? { count: 0, value: 0 }
    s.count++; s.value += amount
    byStatus.set(status, s)

    if (isVoidOrder(o)) {
      voidCount++
      voidValue += amount
      continue
    }

    quantity += qty
    value += amount
    if (isPaid(o)) { paidCount++; paidValue += amount }

    const product = o.productName || 'Unspecified'
    const p = byProduct.get(product) ?? { count: 0, quantity: 0, value: 0 }
    p.count++; p.quantity += qty; p.value += amount
    byProduct.set(product, p)

    const location = o.depotName || o.state || 'Unspecified'
    const l = byLocation.get(location) ?? { count: 0, value: 0 }
    l.count++; l.value += amount
    byLocation.set(location, l)
  }

  return {
    count: rows.length,
    liveCount: rows.length - voidCount,
    quantity,
    value,
    paidCount,
    paidValue,
    unpaidValue: value - paidValue,
    voidCount,
    voidValue,
    byStatus: [...byStatus.entries()].map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.value - a.value),
    byProduct: [...byProduct.entries()].map(([product, v]) => ({ product, ...v }))
      .sort((a, b) => b.value - a.value),
    byLocation: [...byLocation.entries()].map(([location, v]) => ({ location, ...v }))
      .sort((a, b) => b.value - a.value),
  }
}

/** Paid green, unpaid amber — the one column read down rather than across. */
const paymentXl = (paid: boolean) =>
  paid
    ? { fill: 'FFDDF0E5', ink: XL.gain }
    : { fill: 'FFFFF4E0', ink: XL.warn }

const paymentPdf = (paid: boolean): { fill: [number, number, number]; ink: [number, number, number] } =>
  paid
    ? { fill: [221, 240, 229], ink: PDF.gain }
    : { fill: [255, 244, 224], ink: [154, 103, 0] }

// ── Excel ─────────────────────────────────────────────────────────────────

export async function exportOrdersExcel(rows: any[], filters: OrderExportFilters) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman'
  wb.created = new Date()

  const ws = wb.addWorksheet('Orders', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const sorted = oldestFirst(rows)
  const t = orderTotals(sorted)

  ws.columns = COLUMNS.map((c) => ({ width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'Soroman — Orders',
    subtitle: `${scopeLine(filters)} · ${t.count} order${t.count === 1 ? '' : 's'} · generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    columnSpan: COLUMNS.length,
  })
  cursor++

  // ── Headline figures ────────────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'SUMMARY')
  const headline: Array<[string, number, string]> = [
    ['Orders', t.count, COUNT],
    ['Live orders', t.liveCount, COUNT],
    ['Volume ordered', t.quantity, QTY],
    ['Order value', t.value, NGN],
    ['Paid', t.paidValue, NGN],
    ['Outstanding', t.unpaidValue, NGN],
    ['Cancelled / expired', t.voidCount, COUNT],
    ['Value cancelled / expired', t.voidValue, NGN],
  ]
  for (const [label, value, fmt] of headline) {
    const r = ws.getRow(cursor)
    r.height = ROW_HEIGHT.body
    r.getCell(1).value = label
    r.getCell(1).font = { bold: true, size: 10 }
    r.getCell(2).value = value
    r.getCell(2).numFmt = fmt
    if (label === 'Paid') r.getCell(2).font = { bold: true, color: { argb: XL.gain } }
    if (label === 'Outstanding') r.getCell(2).font = { bold: true, color: { argb: XL.warn } }
    for (const c of [1, 2]) {
      r.getCell(c).fill = SUMMARY_FILL
      r.getCell(c).border = ALL_BORDERS
    }
    cursor++
  }
  cursor++

  // Volume and value are excluded from the cancelled rows above, so the note
  // saying so travels with the sheet rather than living only in this file.
  ws.getCell(cursor, 1).value =
    'Volume ordered and order value exclude cancelled and expired orders — they are shown separately above.'
  ws.getCell(cursor, 1).font = { italic: true, size: 9, color: { argb: XL.inkSoft } }
  cursor += 2

  cursor = writeSectionHeading(ws, cursor, 'BY STATUS')
  cursor = miniTable(ws, cursor, ['Status', 'Orders', 'Value'],
    t.byStatus.map((s) => [s.status, s.count, s.value] as [string, number, number]))
  cursor++

  cursor = writeSectionHeading(ws, cursor, 'BY PRODUCT')
  cursor = miniTable(ws, cursor, ['Product', 'Orders', 'Value'],
    t.byProduct.map((p) => [p.product, p.count, p.value] as [string, number, number]))
  cursor++

  cursor = writeSectionHeading(ws, cursor, 'BY LOCATION')
  cursor = miniTable(ws, cursor, ['Location', 'Orders', 'Value'],
    t.byLocation.map((l) => [l.location, l.count, l.value] as [string, number, number]))
  cursor += 2

  // ── Detail ──────────────────────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'DETAIL')

  const headerAt = cursor
  const headerRow = ws.getRow(cursor)
  headerRow.height = ROW_HEIGHT.header
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left', wrapText: true }
  })
  cursor++

  const firstBody = cursor
  sorted.forEach((o, i) => {
    const r = ws.getRow(cursor)
    r.height = ROW_HEIGHT.body
    const dead = isVoidOrder(o)
    COLUMNS.forEach((c, ci) => {
      const cell = r.getCell(ci + 1)
      cell.value = c.get(o, i) as never
      if (c.fmt) cell.numFmt = c.fmt
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'top', horizontal: c.align ?? 'left', wrapText: !!c.wrap }
      // A cancelled order is struck through rather than dropped: it belongs
      // in the register, but nothing about it should read as a live figure.
      if (dead) cell.font = { strike: true, color: { argb: XL.inkSoft } }
    })
    if (!dead) {
      const tone = paymentXl(isPaid(o))
      const payCell = r.getCell(COLUMNS.findIndex((c) => c.header === 'Payment') + 1)
      payCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
      payCell.font = { bold: true, color: { argb: tone.ink } }
    }
    cursor++
  })

  const totalRow = ws.getRow(cursor)
  totalRow.height = ROW_HEIGHT.total
  COLUMNS.forEach((c, i) => {
    const cell = totalRow.getCell(i + 1)
    if (i === 0) cell.value = 'TOTAL'
    else if (SUMMED.has(c.header) && sorted.length > 0) {
      const letter = ws.getColumn(i + 1).letter
      cell.value = { formula: `SUM(${letter}${firstBody}:${letter}${cursor - 1})` } as never
      if (c.fmt) cell.numFmt = c.fmt
    }
    cell.font = TOTAL_FONT
    cell.fill = i === 0 ? GRAND_TOTAL_FILL : TOTAL_FILL
    cell.border = TOTAL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left' }
  })

  // The footer sums every row including cancelled ones, which is what a
  // column total means; the headline figures above are the ones that exclude
  // them, and the note says so.
  ws.views = [{ state: 'frozen', ySplit: headerAt }]
  if (sorted.length > 0) {
    ws.autoFilter = {
      from: { row: headerAt, column: 1 },
      to: { row: cursor - 1, column: COLUMNS.length },
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${buildFilename('orders', filters)}.xlsx`,
  )
}

function miniTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  startRow: number,
  headers: string[],
  body: Array<[string, number, number]>,
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

  for (const [label, count, value] of body) {
    const r = ws.getRow(row)
    r.height = ROW_HEIGHT.body
    r.getCell(1).value = label
    r.getCell(2).value = count
    r.getCell(2).numFmt = COUNT
    r.getCell(3).value = value
    r.getCell(3).numFmt = NGN
    for (const c of [1, 2, 3]) {
      r.getCell(c).border = ALL_BORDERS
      r.getCell(c).alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'right' }
    }
    row++
  }
  return row
}

// ── PDF ───────────────────────────────────────────────────────────────────

export async function exportOrdersPdf(rows: any[], filters: OrderExportFilters) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const sorted = oldestFirst(rows)
  const t = orderTotals(sorted)

  const y = drawPdfHeader(
    doc,
    'Soroman — Orders',
    `${scopeLine(filters)} · ${t.count} order${t.count === 1 ? '' : 's'} · generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
  )

  autoTable(doc, {
    startY: y,
    head: [['Summary', 'Value']],
    body: [
      ['Orders', String(t.count)],
      ['Live orders', String(t.liveCount)],
      ['Volume ordered', `${t.quantity.toLocaleString('en-NG')} L`],
      ['Order value', pdfNaira(t.value)],
      ['Paid', pdfNaira(t.paidValue)],
      ['Outstanding', pdfNaira(t.unpaidValue)],
      ['Cancelled / expired', `${t.voidCount} · ${pdfNaira(t.voidValue)}`],
    ],
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 14 },
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      if (data.row.index === 4) data.cell.styles.textColor = PDF.gain
      if (data.row.index === 5) data.cell.styles.textColor = [154, 103, 0]
    },
  })

  autoTable(doc, {
    startY: y,
    head: [['By product', 'Orders', 'Value']],
    body: t.byProduct.map((p) => [p.product, String(p.count), pdfNaira(p.value)]),
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 108 },
  })

  autoTable(doc, {
    startY: y,
    head: [['By location', 'Orders', 'Value']],
    body: t.byLocation.map((l) => [l.location, String(l.count), pdfNaira(l.value)]),
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 202 },
  })

  let cursorY = (doc as any).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: cursorY,
    head: [['By status', 'Orders', 'Value']],
    body: t.byStatus.map((s) => [s.status, String(s.count), pdfNaira(s.value)]),
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: { 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' } },
    tableWidth: 88,
    margin: { left: 14 },
  })

  cursorY = (doc as any).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body: sorted.map((o, i) =>
      COLUMNS.map((c) => {
        const v = c.get(o, i)
        if (v instanceof Date) return format(v, DATE_PATTERN)
        if (typeof v === 'number') {
          if (c.header === 'S/N') return String(v)
          if (c.header === 'Quantity') return `${v.toLocaleString('en-NG')} L`
          return pdfNaira(v)
        }
        return String(v ?? '')
      }),
    ),
    foot: sorted.length
      ? [[
          'TOTAL', '', '', '', '', '', '', '', '',
          `${t.quantity.toLocaleString('en-NG')} L`, '', pdfNaira(t.value), '', '',
        ]]
      : undefined,
    theme: 'grid',
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: pdfStyles.foot,
    alternateRowStyles: { fillColor: PDF.bandTint },
    columnStyles: {
      0: { halign: 'right', cellWidth: 8 },
      2: { cellWidth: 17 },
      5: { cellWidth: 20 },
      9: { halign: 'right', cellWidth: 21 },
      10: { halign: 'right', cellWidth: 21 },
      11: { halign: 'right', cellWidth: 24 },
      12: { cellWidth: 15 },
      13: { cellWidth: 18 },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const o = sorted[data.row.index]
      if (!o) return
      if (isVoidOrder(o)) {
        data.cell.styles.textColor = PDF.inkSoft
        return
      }
      if (data.column.index === 12) {
        const tone = paymentPdf(isPaid(o))
        data.cell.styles.fillColor = tone.fill
        data.cell.styles.textColor = tone.ink
        data.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: 8, right: 8 },
  })

  drawPdfFooters(
    doc,
    'Soroman — Orders · volume and value in the summary exclude cancelled and expired orders',
  )
  doc.save(`${buildFilename('orders', filters)}.pdf`)
}
