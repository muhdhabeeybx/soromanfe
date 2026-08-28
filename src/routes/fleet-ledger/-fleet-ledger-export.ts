import { format } from 'date-fns'
import type { LedgerEntry } from '#/lib/hooks/useFleet'
import {
  XL, PDF, NGN, NGN_SIGNED, COUNT, PCT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, HEADER_FILL_SOFT, BAND_FILL,
  GRAND_TOTAL_FILL, SUMMARY_FILL, SUBROW_FILL, TOTAL_FILL, fill,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading, paintSigned,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'
import {
  amountOf, computeTotals, groupByTruck, isExpense, safeDate, summariseByCategory,
  type LedgerRow, type LedgerTotals, type TruckGroup,
} from './-fleet-ledger-data'

/**
 * The truck ledger, exported.
 *
 * ── Arranged per truck, then per date ─────────────────────────────────────
 *
 * The entries sheet is not a flat date list. Each vehicle gets its own banded
 * block — plate and driver in the band, its entries oldest-first beneath it
 * carrying a running balance, and a subtotal closing it — because the question
 * this ledger is opened with is "what is this truck costing me", and that
 * cannot be read off a list where one truck's entries sit scattered between
 * everyone else's. Blocks run in plate order, so a printed copy can be looked
 * things up in. The grouping and the arithmetic come from
 * -fleet-ledger-data.ts, the same module the screen reads, so the sheet can
 * never arrange or total differently from the page it was run from.
 *
 * Three sheets: the arranged ledger, the per-vehicle summary that gets read
 * outside transport, and where the money actually went by category.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * Follows the house rule exactly (see lib/report-theme.ts): navy is structure,
 * green is the brand, and red-and-green together are reserved for money whose
 * SIGN carries meaning — here the balance column and nothing else. Debit and
 * credit stay black even though the screen tints them, because on a printed
 * sheet a red debit column competes with the one figure that has to shout.
 * Shading marks rank, never decoration: a soft-navy band opens a truck, a
 * tint closes it, the faintest tint stripes the rows between.
 */

export interface FleetLedgerFilters {
  periodLabel: string
  truck: string
  type: string
  category: string
  search: string
}

export type FleetLedgerTotals = LedgerTotals
export { computeTotals }

const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Date', key: 'date', width: 13, fmt: DATE_FMT },
  { header: 'Truck No.', key: 'truck', width: 15 },
  { header: 'Driver', key: 'driver', width: 24 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Debit', key: 'debit', width: 16, fmt: NGN },
  { header: 'Credit', key: 'credit', width: 16, fmt: NGN },
  { header: 'Balance', key: 'balance', width: 17, fmt: NGN_SIGNED },
  { header: 'Entered By', key: 'enteredBy', width: 20 },
]

/** Where the money columns start — the band and subtotal rows merge
 * everything to the left of it and write figures from here on. */
const MONEY_FROM = COLUMNS.findIndex((c) => c.key === 'debit') + 1

const up = (v: string | null | undefined) => (v || '').toUpperCase()

function rowValues(entry: LedgerRow, index: number) {
  const amount = amountOf(entry)
  return {
    sn: index + 1,
    date: safeDate(entry.entry_date),
    truck: up(entry.truck_plate) || '—',
    driver: up(entry.truck_driver) || '—',
    category: up(entry.category) || '—',
    // Not upper-cased: a description is a sentence somebody wrote, and
    // shouting it back makes the sheet harder to read, not more uniform.
    description: entry.description || '—',
    // Only one of the two is ever written, which is the whole point of
    // splitting a single typed amount into two columns.
    debit: isExpense(entry) ? amount : null,
    credit: isExpense(entry) ? null : amount,
    balance: entry.runningBalance,
    enteredBy: up(entry.entered_by) || '—',
  }
}

export function buildFilename(filters: FleetLedgerFilters): string {
  const scope = filters.truck && filters.truck !== 'All trucks' ? filters.truck : 'ALL TRUCKS'
  return `SOROMAN TRUCK LEDGER ${scope} ${format(new Date(), 'dd-MM-yy')}`
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

/** Every filter in force, so a forwarded copy can still be checked. */
function subtitleOf(filters: FleetLedgerFilters, totals: FleetLedgerTotals): string {
  const parts = [
    `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    `Period: ${filters.periodLabel}`,
  ]
  if (filters.truck && filters.truck !== 'All trucks') parts.push(`Truck: ${filters.truck}`)
  if (filters.type && filters.type !== 'all') parts.push(`Type: ${filters.type}`)
  if (filters.category && filters.category !== 'all') parts.push(`Category: ${filters.category}`)
  if (filters.search) parts.push(`Search: "${filters.search}"`)
  parts.push(`${totals.entries} entries · ${totals.trucks} trucks`)
  return parts.join('   ·   ')
}

// ══════════════════════════════════════════════════════════════════════════
// Excel
// ══════════════════════════════════════════════════════════════════════════

export async function exportFleetLedgerExcel(
  entries: LedgerEntry[],
  filters: FleetLedgerFilters,
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const totals = computeTotals(entries)

  // ── Sheet 1: the entries ────────────────────────────────────────────
  const ws = wb.addWorksheet('Entries', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — TRUCK LEDGER',
    subtitle: subtitleOf(filters, totals),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  const summaryCols: Array<{ header: string; value: number; fmt: string; signed?: boolean }> = [
    { header: 'Entries', value: totals.entries, fmt: COUNT },
    { header: 'Trucks', value: totals.trucks, fmt: COUNT },
    { header: 'Total Debits', value: totals.debits, fmt: NGN },
    { header: 'Total Credits', value: totals.credits, fmt: NGN },
    { header: 'Balance', value: totals.balance, fmt: NGN_SIGNED, signed: true },
  ]
  summaryCols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width || 10, c.header.length + 4)
  })

  const sumHead = ws.getRow(cursor)
  sumHead.values = summaryCols.map((c) => c.header)
  sumHead.height = ROW_HEIGHT.header
  summaryCols.forEach((_, i) => {
    const cell = sumHead.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  cursor++

  const sumBody = ws.getRow(cursor)
  sumBody.values = summaryCols.map((c) => c.value)
  sumBody.height = ROW_HEIGHT.total
  summaryCols.forEach((c, i) => {
    const cell = sumBody.getCell(i + 1)
    cell.numFmt = c.fmt
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
    cell.font = TOTAL_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    if (c.signed) paintSigned(cell, c.value)
  })
  cursor += 3

  const headerRow = ws.getRow(cursor)
  headerRow.values = COLUMNS.map((c) => c.header)
  headerRow.height = ROW_HEIGHT.header
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  cursor++
  const tableStart = cursor

  // Per truck, then per date. Each block opens with a band naming the vehicle
  // and stating its totals up front, so a reader who only wants "what did this
  // truck cost" never has to add a column up themselves.
  const groups = groupByTruck(entries)
  let serial = 0

  for (const group of groups) {
    cursor = writeTruckBand(ws, cursor, group)

    group.rows.forEach((entry, i) => {
      const values = rowValues(entry, serial++)
      const row = ws.getRow(cursor)
      row.values = values as never
      row.height = ROW_HEIGHT.body
      for (const c of COLUMNS) {
        const cell = row.getCell(c.key)
        cell.border = ALL_BORDERS
        if (i % 2 === 1) cell.fill = BAND_FILL
        if (c.fmt) cell.numFmt = c.fmt
      }
      row.getCell('truck').font = { bold: true }
      row.getCell('description').alignment = { wrapText: true, vertical: 'top' }
      paintSigned(row.getCell('balance'), entry.runningBalance)
      cursor++
    })

    cursor = writeTruckSubtotal(ws, cursor, group)
    // A blank line between blocks. Grouping is only legible if the groups are
    // visibly apart, and a border alone does not carry that at a glance.
    cursor++
  }

  // Frozen below the header row, so the column names stay put through a
  // fleet's worth of blocks.
  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: COLUMNS.length },
  }

  const totalRow = ws.getRow(cursor)
  totalRow.getCell('category').value = `FLEET TOTAL — ${totals.entries} entries, ${totals.trucks} trucks`
  totalRow.getCell('debit').value = totals.debits
  totalRow.getCell('credit').value = totals.credits
  totalRow.getCell('balance').value = totals.balance
  totalRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  totalRow.getCell('debit').numFmt = NGN
  totalRow.getCell('credit').numFmt = NGN
  totalRow.getCell('balance').numFmt = NGN_SIGNED
  paintSigned(totalRow.getCell('balance'), totals.balance)

  // ── Sheets 2 and 3 ──────────────────────────────────────────────────
  writeTruckSheet(wb, entries, filters, totals)
  writeCategorySheet(wb, entries, filters, totals)

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${buildFilename(filters)}.xlsx`,
  )
}

/**
 * The band that opens a truck's block.
 *
 * Soft navy rather than the header's full navy: it is a second-level heading,
 * and the palette already carries that distinction. The plate, the driver and
 * the span the entries cover are merged across the descriptive columns; the
 * three money columns state the block's totals before a single row of it has
 * been read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeTruckBand(ws: any, row: number, group: TruckGroup): number {
  const band = ws.getRow(row)
  band.height = ROW_HEIGHT.header

  const period = group.firstDate && group.lastDate
    ? `${format(group.firstDate, DATE_PATTERN)} – ${format(group.lastDate, DATE_PATTERN)}`
    : '—'
  band.getCell(1).value =
    `${up(group.plate)}   ·   ${up(group.driver) || '—'}   ·   ${group.entries} ENTRIES   ·   ${period}`
  ws.mergeCells(row, 1, row, MONEY_FROM - 1)

  band.getCell('debit').value = group.debits
  band.getCell('credit').value = group.credits
  band.getCell('balance').value = group.balance

  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = band.getCell(i)
    cell.fill = HEADER_FILL_SOFT
    cell.border = ALL_BORDERS
    cell.font = { bold: true, size: 10, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle' }
  }
  band.getCell('debit').numFmt = NGN
  band.getCell('credit').numFmt = NGN
  band.getCell('balance').numFmt = NGN_SIGNED
  // The band is white-on-navy, so the signed colours would be unreadable
  // against it. The subtotal below carries the colour instead.
  return row + 1
}

/** Closes a truck's block. Tinted, ruled off, and the one place in the block
 * where the balance is allowed its colour. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeTruckSubtotal(ws: any, row: number, group: TruckGroup): number {
  const sub = ws.getRow(row)
  sub.height = ROW_HEIGHT.total
  sub.getCell(1).value = `SUBTOTAL — ${up(group.plate)}`
  ws.mergeCells(row, 1, row, MONEY_FROM - 1)
  sub.getCell('debit').value = group.debits
  sub.getCell('credit').value = group.credits
  sub.getCell('balance').value = group.balance

  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = sub.getCell(i)
    cell.fill = TOTAL_FILL
    cell.border = TOTAL_BORDERS
    cell.font = TOTAL_FONT
    cell.alignment = { vertical: 'middle' }
  }
  sub.getCell('debit').numFmt = NGN
  sub.getCell('credit').numFmt = NGN
  sub.getCell('balance').numFmt = NGN_SIGNED
  paintSigned(sub.getCell('balance'), group.balance)
  return row + 1
}

/** Which truck cost what — the sheet that gets read outside transport. */
function writeTruckSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  entries: LedgerEntry[],
  filters: FleetLedgerFilters,
  totals: FleetLedgerTotals,
) {
  const TRUCK_COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
    { header: 'Truck No.', key: 'plate', width: 16 },
    { header: 'Driver', key: 'driver', width: 26 },
    { header: 'Entries', key: 'entries', width: 10, fmt: COUNT },
    { header: 'First Entry', key: 'first', width: 13, fmt: DATE_FMT },
    { header: 'Last Entry', key: 'last', width: 13, fmt: DATE_FMT },
    { header: 'Debits', key: 'debits', width: 18, fmt: NGN },
    { header: 'Credits', key: 'credits', width: 18, fmt: NGN },
    { header: 'Balance', key: 'balance', width: 18, fmt: NGN_SIGNED },
    // What one entry on this truck costs on average — the figure that tells
    // two trucks with the same total apart when one got there in three visits
    // and the other in thirty.
    { header: 'Avg / Entry', key: 'average', width: 16, fmt: NGN },
    { header: 'Share of Spend', key: 'share', width: 15, fmt: PCT },
  ]

  const ws = wb.addWorksheet('By Truck', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = TRUCK_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — TRUCK LEDGER BY VEHICLE',
    subtitle: subtitleOf(filters, totals),
    columnSpan: TRUCK_COLUMNS.length,
  })
  cursor = writeSectionHeading(ws, cursor + 1, 'COST AND EARNINGS PER TRUCK — IN PLATE ORDER')

  const header = ws.getRow(cursor)
  header.values = TRUCK_COLUMNS.map((c) => c.header)
  header.height = ROW_HEIGHT.header
  TRUCK_COLUMNS.forEach((_, i) => {
    const cell = header.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  cursor++

  groupByTruck(entries).forEach((group, i) => {
    const row = ws.getRow(cursor)
    row.values = {
      plate: up(group.plate),
      driver: up(group.driver) || '—',
      entries: group.entries,
      first: group.firstDate,
      last: group.lastDate,
      debits: group.debits,
      credits: group.credits,
      balance: group.balance,
      average: group.entries ? group.debits / group.entries : 0,
      share: totals.debits ? group.debits / totals.debits : 0,
    } as never
    row.height = ROW_HEIGHT.body
    for (const c of TRUCK_COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (i % 2 === 1) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
    }
    row.getCell('plate').font = { bold: true }
    paintSigned(row.getCell('balance'), group.balance)
    cursor++
  })

  const totalRow = ws.getRow(cursor)
  totalRow.values = {
    plate: 'TOTAL',
    driver: `${totals.trucks} trucks`,
    entries: totals.entries,
    debits: totals.debits,
    credits: totals.credits,
    balance: totals.balance,
    average: totals.entries ? totals.debits / totals.entries : 0,
    share: totals.debits ? 1 : 0,
  } as never
  totalRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= TRUCK_COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const c of TRUCK_COLUMNS) {
    if (c.fmt) totalRow.getCell(c.key).numFmt = c.fmt
  }
  paintSigned(totalRow.getCell('balance'), totals.balance)
}

/**
 * Where the money actually went.
 *
 * The per-truck sheet says which vehicle; this says what on. Two blocks,
 * spend and earnings, because netting "Tyres" against "Delivery" would state
 * a number that describes nothing.
 */
function writeCategorySheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  entries: LedgerEntry[],
  filters: FleetLedgerFilters,
  totals: FleetLedgerTotals,
) {
  const CAT_COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Entries', key: 'entries', width: 10, fmt: COUNT },
    { header: 'Amount', key: 'amount', width: 20, fmt: NGN },
    { header: 'Share', key: 'share', width: 12, fmt: PCT },
    { header: 'Avg / Entry', key: 'average', width: 18, fmt: NGN },
  ]

  const ws = wb.addWorksheet('By Category', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = CAT_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — TRUCK LEDGER BY CATEGORY',
    subtitle: subtitleOf(filters, totals),
    columnSpan: CAT_COLUMNS.length,
  })

  const lines = summariseByCategory(entries)

  const writeBlock = (
    heading: string, type: 'expense' | 'income', total: number, headingFill: string,
  ) => {
    const rows = lines.filter((l) => l.type === type)
    if (rows.length === 0) return

    cursor = writeSectionHeading(ws, cursor + 1, heading)

    const header = ws.getRow(cursor)
    header.values = CAT_COLUMNS.map((c) => c.header)
    header.height = ROW_HEIGHT.header
    CAT_COLUMNS.forEach((_, i) => {
      const cell = header.getCell(i + 1)
      cell.font = HEADER_FONT
      cell.fill = fill(headingFill)
      cell.border = ALL_BORDERS
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    cursor++

    rows.forEach((line, i) => {
      const row = ws.getRow(cursor)
      row.values = {
        category: up(line.category),
        entries: line.entries,
        amount: line.amount,
        share: line.share,
        average: line.entries ? line.amount / line.entries : 0,
      } as never
      row.height = ROW_HEIGHT.body
      for (const c of CAT_COLUMNS) {
        const cell = row.getCell(c.key)
        cell.border = ALL_BORDERS
        if (i % 2 === 1) cell.fill = SUBROW_FILL
        if (c.fmt) cell.numFmt = c.fmt
      }
      // The biggest line is the point of the block, so it is the one that
      // reads as bold rather than every plate on the sheet doing so.
      if (i === 0) row.getCell('category').font = { bold: true }
      cursor++
    })

    const sub = ws.getRow(cursor)
    sub.values = {
      category: 'TOTAL',
      entries: rows.reduce((s, l) => s + l.entries, 0),
      amount: total,
      share: total ? 1 : 0,
    } as never
    sub.height = ROW_HEIGHT.total
    for (let i = 1; i <= CAT_COLUMNS.length; i++) {
      const cell = sub.getCell(i)
      cell.border = TOTAL_BORDERS
      cell.fill = TOTAL_FILL
      cell.font = TOTAL_FONT
    }
    for (const c of CAT_COLUMNS) {
      if (c.fmt) sub.getCell(c.key).numFmt = c.fmt
    }
    cursor += 2
  }

  writeBlock('WHERE THE MONEY WENT — SPEND BY CATEGORY', 'expense', totals.debits, XL.headerNavy)
  writeBlock('WHERE IT CAME FROM — INCOME BY CATEGORY', 'income', totals.credits, XL.headerNavySoft)

  const net = ws.getRow(cursor)
  net.getCell('category').value = 'NET POSITION'
  net.getCell('amount').value = totals.balance
  net.getCell('amount').numFmt = NGN_SIGNED
  net.height = ROW_HEIGHT.total
  for (let i = 1; i <= CAT_COLUMNS.length; i++) {
    const cell = net.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  paintSigned(net.getCell('amount'), totals.balance)
}

// ══════════════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════════════

export async function exportFleetLedgerPdf(
  entries: LedgerEntry[],
  filters: FleetLedgerFilters,
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  const totals = computeTotals(entries)
  const startY = drawPdfHeader(doc, 'Soroman — Truck Ledger', subtitleOf(filters, totals))

  autoTable(doc, {
    startY,
    head: [['Entries', 'Trucks', 'Total Debits', 'Total Credits', 'Balance']],
    body: [[
      String(totals.entries), String(totals.trucks),
      pdfNaira(totals.debits), pdfNaira(totals.credits), pdfNaira(totals.balance),
    ]],
    styles: pdfStyles.body,
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen },
    bodyStyles: pdfStyles.summaryBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 4) return
      data.cell.styles.textColor = totals.balance < 0 ? PDF.loss : PDF.gain
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursorY = (doc as any).lastAutoTable.finalY + 6

  const groups = groupByTruck(entries)

  // ── Per truck, first: it is the summary, and it belongs above the detail ──
  autoTable(doc, {
    startY: cursorY,
    head: [['Truck No.', 'Driver', 'Entries', 'Debits', 'Credits', 'Balance', 'Share of Spend']],
    body: groups.map((t) => [
      up(t.plate), up(t.driver) || '—', String(t.entries),
      pdfNaira(t.debits), pdfNaira(t.credits), pdfNaira(t.balance),
      totals.debits ? `${Math.round((t.debits / totals.debits) * 100)}%` : '—',
    ]),
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.bandTint
      if (data.column.index === 0) data.cell.styles.fontStyle = 'bold'
      if (data.column.index === 5) {
        const text = String(data.cell.raw).trim()
        data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = (doc as any).lastAutoTable.finalY + 5

  // ── Where the money went ────────────────────────────────────────────
  const expenseLines = summariseByCategory(entries).filter((l) => l.type === 'expense').slice(0, 8)
  if (expenseLines.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Top Expense Categories', 'Entries', 'Amount', 'Share', 'Avg / Entry']],
      body: expenseLines.map((l) => [
        up(l.category), String(l.entries), pdfNaira(l.amount),
        `${Math.round(l.share * 100)}%`,
        pdfNaira(l.entries ? l.amount / l.entries : 0),
      ]),
      styles: pdfStyles.body,
      headStyles: { ...pdfStyles.head, fillColor: PDF.headerNavySoft },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== 'body') return
        if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.subRowTint
        // Only the heaviest line is bold — bolding all of them says nothing.
        if (data.row.index === 0) data.cell.styles.fontStyle = 'bold'
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 5
  }

  // ── The ledger itself, per truck then per date ──────────────────────
  // One table per vehicle rather than one long table with separator rows:
  // autotable repeats the column header on every page break, so each block
  // keeps its own headings when it spills, and a truck can never end up
  // reading under the previous truck's band.
  let serial = 0
  for (const group of groups) {
    autoTable(doc, {
      startY: cursorY,
      head: [
        // A band naming the vehicle, spanning the sheet, above the columns.
        [{
          content:
            `${up(group.plate)}  ·  ${up(group.driver) || '—'}  ·  ${group.entries} entries  ·  `
            + `Debits ${pdfNaira(group.debits)}  ·  Credits ${pdfNaira(group.credits)}  ·  Balance ${pdfNaira(group.balance)}`,
          colSpan: COLUMNS.length,
          styles: { fillColor: PDF.headerNavySoft, textColor: PDF.white, halign: 'left' as const },
        }],
        COLUMNS.map((c) => c.header),
      ],
      body: group.rows.map((entry) => {
        const v = rowValues(entry, serial++)
        return [
          v.sn,
          v.date ? format(v.date, DATE_PATTERN) : '—',
          v.truck, v.driver, v.category, v.description,
          v.debit == null ? '' : pdfNaira(v.debit),
          v.credit == null ? '' : pdfNaira(v.credit),
          pdfNaira(v.balance),
          v.enteredBy,
        ]
      }),
      foot: [[
        { content: `SUBTOTAL — ${up(group.plate)}`, colSpan: MONEY_FROM - 1 },
        pdfNaira(group.debits), pdfNaira(group.credits), pdfNaira(group.balance), '',
      ]],
      styles: pdfStyles.body,
      headStyles: pdfStyles.head,
      footStyles: pdfStyles.foot,
      columnStyles: { 5: { cellWidth: 52 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        // Balance is the only column allowed its colour — see the header note.
        const balanceCol = COLUMNS.length - 2
        if (data.section === 'foot' && data.column.index === balanceCol) {
          data.cell.styles.textColor = group.balance < 0 ? PDF.loss : PDF.gain
        }
        if (data.section !== 'body') return
        if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.bandTint
        if (data.column.index === 2) data.cell.styles.fontStyle = 'bold'
        if (data.column.index === balanceCol) {
          const text = String(data.cell.raw).trim()
          data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
        }
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 4
  }

  // The fleet's own bottom line, closing the document.
  autoTable(doc, {
    startY: cursorY,
    body: [[
      {
        content: `FLEET TOTAL — ${totals.entries} entries across ${totals.trucks} trucks`,
        colSpan: MONEY_FROM - 1,
      },
      pdfNaira(totals.debits), pdfNaira(totals.credits), pdfNaira(totals.balance), '',
    ]],
    styles: { ...pdfStyles.body, fontStyle: 'bold' as const },
    bodyStyles: { fillColor: PDF.grandTotalTint },
    columnStyles: { 5: { cellWidth: 52 } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.column.index === COLUMNS.length - 2) {
        data.cell.styles.textColor = totals.balance < 0 ? PDF.loss : PDF.gain
      }
    },
  })

  drawPdfFooters(doc, `Soroman Truck Ledger · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
