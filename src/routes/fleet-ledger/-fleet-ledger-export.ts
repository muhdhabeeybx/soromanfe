import { format, parseISO } from 'date-fns'
import type { LedgerEntry } from '#/lib/hooks/useFleet'
import {
  PDF, NGN, NGN_SIGNED, COUNT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, BAND_FILL,
  GRAND_TOTAL_FILL, SUMMARY_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading, paintSigned,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

/**
 * The truck ledger, exported.
 *
 * Two sheets, because the ledger answers two questions and they are not the
 * same one. "Entries" is the running list, in date order, as it is worked.
 * "By Truck" totals it per vehicle — which truck is costing money and which
 * is earning it — and that is the sheet anybody outside transport actually
 * reads.
 *
 * Colour follows the house rule exactly: red and green are reserved for money
 * whose SIGN carries meaning, which here is the balance and nothing else.
 * Debit and credit columns stay black even though the screen tints them,
 * because on a printed sheet a red debit column would compete with the one
 * figure that genuinely needs to shout.
 */

export interface FleetLedgerFilters {
  periodLabel: string
  truck: string
  type: string
  category: string
  search: string
}

const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Date', key: 'date', width: 13, fmt: DATE_FMT },
  { header: 'Truck No.', key: 'truck', width: 15 },
  { header: 'Driver', key: 'driver', width: 24 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Debit', key: 'debit', width: 16, fmt: NGN },
  { header: 'Credit', key: 'credit', width: 16, fmt: NGN },
  { header: 'Entered By', key: 'enteredBy', width: 20 },
]

const up = (v: string | null | undefined) => (v || '').toUpperCase()

function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  try {
    const d = parseISO(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

const isExpense = (e: LedgerEntry) => e.entry_type === 'expense'

function rowValues(entry: LedgerEntry, index: number) {
  const amount = Number(entry.amount || 0)
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
    enteredBy: up(entry.entered_by) || '—',
  }
}

export interface FleetLedgerTotals {
  entries: number
  trucks: number
  debits: number
  credits: number
  /** Credits − debits: positive means the truck earned more than it cost. */
  balance: number
}

export function computeTotals(entries: LedgerEntry[]): FleetLedgerTotals {
  const trucks = new Set<number>()
  let debits = 0
  let credits = 0
  for (const e of entries) {
    trucks.add(e.truck_id)
    const amount = Number(e.amount || 0)
    if (isExpense(e)) debits += amount
    else credits += amount
  }
  return { entries: entries.length, trucks: trucks.size, debits, credits, balance: credits - debits }
}

interface TruckSummary {
  plate: string
  driver: string
  entries: number
  debits: number
  credits: number
  balance: number
}

function summariseByTruck(entries: LedgerEntry[]): TruckSummary[] {
  const map = new Map<number, TruckSummary>()
  for (const e of entries) {
    const row = map.get(e.truck_id) ?? {
      plate: up(e.truck_plate) || '—',
      driver: up(e.truck_driver) || '—',
      entries: 0, debits: 0, credits: 0, balance: 0,
    }
    row.entries += 1
    const amount = Number(e.amount || 0)
    if (isExpense(e)) row.debits += amount
    else row.credits += amount
    row.balance = row.credits - row.debits
    map.set(e.truck_id, row)
  }
  // Worst first: the truck bleeding the most money is the reason this sheet
  // gets opened.
  return [...map.values()].sort((a, b) => a.balance - b.balance)
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

  // Oldest first — the order a ledger is read in, and the opposite of the
  // screen, which leads with the newest because that is what you just typed.
  const ordered = [...entries].sort((a, b) => {
    const ad = safeDate(a.entry_date)?.getTime() ?? 0
    const bd = safeDate(b.entry_date)?.getTime() ?? 0
    return ad - bd || a.id - b.id
  })

  ordered.forEach((entry, i) => {
    const values = rowValues(entry, i)
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
    cursor++
  })

  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: COLUMNS.length },
  }

  const totalRow = ws.getRow(cursor)
  totalRow.getCell('category').value = `TOTAL — ${totals.entries} entries`
  totalRow.getCell('debit').value = totals.debits
  totalRow.getCell('credit').value = totals.credits
  totalRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  totalRow.getCell('debit').numFmt = NGN
  totalRow.getCell('credit').numFmt = NGN

  // ── Sheet 2: per truck ──────────────────────────────────────────────
  writeTruckSheet(wb, entries, filters, totals)

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${buildFilename(filters)}.xlsx`,
  )
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
    { header: 'Debits', key: 'debits', width: 18, fmt: NGN },
    { header: 'Credits', key: 'credits', width: 18, fmt: NGN },
    { header: 'Balance', key: 'balance', width: 18, fmt: NGN_SIGNED },
  ]

  const ws = wb.addWorksheet('By Truck', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = TRUCK_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — TRUCK LEDGER BY VEHICLE',
    subtitle: subtitleOf(filters, totals),
    columnSpan: TRUCK_COLUMNS.length,
  })
  cursor = writeSectionHeading(ws, cursor + 1, 'COST AND EARNINGS PER TRUCK — WORST BALANCE FIRST')

  const header = ws.getRow(cursor)
  header.values = TRUCK_COLUMNS.map((c) => c.header)
  header.height = ROW_HEIGHT.header
  TRUCK_COLUMNS.forEach((_, i) => {
    const cell = header.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  cursor++

  summariseByTruck(entries).forEach((summary, i) => {
    const row = ws.getRow(cursor)
    row.values = summary as never
    row.height = ROW_HEIGHT.body
    for (const c of TRUCK_COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (i % 2 === 1) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
    }
    row.getCell('plate').font = { bold: true }
    paintSigned(row.getCell('balance'), summary.balance)
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

  // ── Per truck, first: it is the summary, and it belongs above the detail ──
  const truckRows = summariseByTruck(entries)
  autoTable(doc, {
    startY: cursorY,
    head: [['Truck No.', 'Driver', 'Entries', 'Debits', 'Credits', 'Balance']],
    body: truckRows.map((t) => [
      t.plate, t.driver, String(t.entries),
      pdfNaira(t.debits), pdfNaira(t.credits), pdfNaira(t.balance),
    ]),
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (data.column.index === 0) data.cell.styles.fontStyle = 'bold'
      if (data.column.index === 5) {
        const text = String(data.cell.raw).trim()
        data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
      }
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = (doc as any).lastAutoTable.finalY + 6

  const ordered = [...entries].sort((a, b) => {
    const ad = safeDate(a.entry_date)?.getTime() ?? 0
    const bd = safeDate(b.entry_date)?.getTime() ?? 0
    return ad - bd || a.id - b.id
  })

  const foot = ['', '', '', '', `TOTAL (${totals.entries})`, '', pdfNaira(totals.debits), pdfNaira(totals.credits), '']

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body: ordered.map((entry, i) => {
      const v = rowValues(entry, i)
      return [
        v.sn,
        v.date ? format(v.date, DATE_PATTERN) : '—',
        v.truck, v.driver, v.category, v.description,
        v.debit == null ? '' : pdfNaira(v.debit),
        v.credit == null ? '' : pdfNaira(v.credit),
        v.enteredBy,
      ]
    }),
    foot: [foot],
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
    columnStyles: { 5: { cellWidth: 60 } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.bandTint
        if (data.column.index === 2) data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  drawPdfFooters(doc, `Soroman Truck Ledger · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
