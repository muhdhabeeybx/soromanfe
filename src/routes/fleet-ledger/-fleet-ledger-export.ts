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
 * The entries sheet is not a flat date list. Each vehicle gets its own block,
 * read top to bottom in the order it is used: a band naming the truck and its
 * driver, a totals line stating what it came to, then the entries behind that,
 * oldest first and carrying a running balance. The question this ledger is
 * opened with is "what is this truck costing me", and that cannot be read off
 * a list where one truck's entries sit scattered between everyone else's — nor
 * off a block whose total is only reachable by scrolling past forty rows.
 *
 * Blocks run in plate order, so a printed copy can be looked things up in. The
 * grouping and the arithmetic come from -fleet-ledger-data.ts, the same module
 * the screen reads, so the sheet can never arrange or total differently from
 * the page it was run from.
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
 * Shading marks rank, never decoration: a soft-navy band names a truck, a
 * tint states its totals, the faintest tint stripes the entries below them.
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

/**
 * No truck or driver column.
 *
 * Every row in a block belongs to the truck the block is named after, so a
 * plate repeated down forty rows is forty restatements of the heading two
 * inches above it — width spent saying nothing, taken from the description,
 * which is the column that actually needs it.
 *
 * The cost of that is real and worth stating: a reader who sorts or filters
 * this sheet in Excel detaches rows from the band identifying them. That is
 * why the autofilter is gone (see below) and why the By Truck sheet, where one
 * row IS one truck, keeps both columns.
 */
const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Date', key: 'date', width: 13, fmt: DATE_FMT },
  { header: 'Category', key: 'category', width: 24 },
  { header: 'Description', key: 'description', width: 52 },
  { header: 'Debit', key: 'debit', width: 16, fmt: NGN },
  { header: 'Credit', key: 'credit', width: 16, fmt: NGN },
  { header: 'Balance', key: 'balance', width: 17, fmt: NGN_SIGNED },
  { header: 'Entered By', key: 'enteredBy', width: 22 },
]

/** Where the money columns start — the band and totals rows merge everything
 * to the left of it and write figures from here on. */
const MONEY_FROM = COLUMNS.findIndex((c) => c.key === 'debit') + 1
/** The one column allowed a colour, in both writers. */
const BALANCE_INDEX = COLUMNS.findIndex((c) => c.key === 'balance')
const DESCRIPTION_INDEX = COLUMNS.findIndex((c) => c.key === 'description')

const up = (v: string | null | undefined) => (v || '').toUpperCase()
/** "1 entry", "2 entries" — a report that says "1 entries" reads as generated
 * rather than written, which is not what you want on a document going out. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function rowValues(entry: LedgerRow, index: number) {
  const amount = amountOf(entry)
  return {
    sn: index + 1,
    date: safeDate(entry.entry_date),
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
  parts.push(`${plural(totals.entries, 'entry', 'entries')} · ${plural(totals.trucks, 'truck')}`)
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

  // Per truck, then per date. Each block reads top to bottom as: who this is,
  // what it came to, then the entries behind that — so a reader who only wants
  // "what did this truck cost" gets it from two rows and never scrolls.
  const groups = groupByTruck(entries)

  for (const group of groups) {
    cursor = writeTruckBand(ws, cursor, group, totals)
    cursor = writeTruckTotals(ws, cursor, group)

    // S/N restarts at 1 for every truck: it numbers this vehicle's entries,
    // which is the only sequence a reader inside a block can use. A running
    // fleet-wide count would say "entry 147 of the sheet", which answers a
    // question nobody standing in front of one truck is asking.
    group.rows.forEach((entry, i) => {
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
      row.getCell('description').alignment = { wrapText: true, vertical: 'top' }
      paintSigned(row.getCell('balance'), entry.runningBalance)
      cursor++
    })

    // A blank line between blocks. Grouping is only legible if the groups are
    // visibly apart, and a border alone does not carry that at a glance.
    cursor++
  }

  // Frozen below the header row, so the column names stay put through a
  // fleet's worth of blocks.
  //
  // No autofilter. It would be actively misleading here: filtering or sorting
  // a grouped sheet detaches rows from the band that names their truck, and
  // since the rows no longer carry a plate of their own there would be nothing
  // left to say which vehicle a surviving row belonged to. The By Truck sheet
  // is the one to slice; this one is to read.
  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]

  // Led from column 1 and merged across the descriptive columns, the same
  // shape as each block's own totals line — the label used to sit in whatever
  // column happened to be third, which read as a stray value once the truck
  // and driver columns were taken out.
  const totalRow = ws.getRow(cursor)
  totalRow.getCell(1).value =
    `FLEET TOTAL — ${plural(totals.entries, 'entry', 'entries')}, ${plural(totals.trucks, 'truck')}`
  ws.mergeCells(cursor, 1, cursor, MONEY_FROM - 1)
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

/** The truck's identity, spelled out once, in words rather than in a column
 * repeated down every row of the block. */
const bandCaption = (group: TruckGroup, totals: FleetLedgerTotals) => {
  const period = group.firstDate && group.lastDate
    ? `${format(group.firstDate, DATE_PATTERN)} – ${format(group.lastDate, DATE_PATTERN)}`
    : '—'
  const share = totals.debits ? Math.round((group.debits / totals.debits) * 100) : 0
  return {
    heading: `${up(group.plate)}   ·   DRIVER: ${up(group.driver) || '—'}`,
    detail:
      `${group.entries} ENTR${group.entries === 1 ? 'Y' : 'IES'}   ·   ${period}`
      + `   ·   ${share}% OF FLEET SPEND`,
  }
}

/**
 * The band that opens a truck's block: who this is, and nothing else.
 *
 * Soft navy rather than the header's full navy — it is a second-level heading
 * and the palette already carries that distinction. The totals used to sit in
 * this row too; they have their own row below it now, because a heading that
 * is also a figures row is neither.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeTruckBand(ws: any, row: number, group: TruckGroup, totals: FleetLedgerTotals): number {
  const { heading, detail } = bandCaption(group, totals)
  const band = ws.getRow(row)
  band.height = ROW_HEIGHT.header
  band.getCell(1).value = heading
  band.getCell(MONEY_FROM).value = detail
  ws.mergeCells(row, 1, row, MONEY_FROM - 1)
  ws.mergeCells(row, MONEY_FROM, row, COLUMNS.length)

  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = band.getCell(i)
    cell.fill = HEADER_FILL_SOFT
    cell.border = ALL_BORDERS
    cell.font = { bold: true, size: 11, color: { argb: XL.white } }
    cell.alignment = { vertical: 'middle' }
  }
  // The detail half is the quieter of the two, so it sits right and lighter.
  band.getCell(MONEY_FROM).font = { size: 9, color: { argb: XL.white } }
  band.getCell(MONEY_FROM).alignment = { vertical: 'middle', horizontal: 'right' }
  return row + 1
}

/**
 * What the block comes to, stated before it is read.
 *
 * Above the entries rather than below them: a reader who only wants "what did
 * this truck cost" gets it from the two rows at the top of the block and never
 * scrolls the detail at all. That is also why there is no closing subtotal any
 * more — it would state these same three figures a second time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeTruckTotals(ws: any, row: number, group: TruckGroup): number {
  const line = ws.getRow(row)
  line.height = ROW_HEIGHT.total
  const average = group.entries ? group.debits / group.entries : 0
  line.getCell(1).value =
    `TOTALS — ${up(group.plate)}   ·   AVERAGE SPEND ₦${average.toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })} PER ENTRY`
  ws.mergeCells(row, 1, row, MONEY_FROM - 1)
  line.getCell('debit').value = group.debits
  line.getCell('credit').value = group.credits
  line.getCell('balance').value = group.balance

  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = line.getCell(i)
    cell.fill = TOTAL_FILL
    cell.border = TOTAL_BORDERS
    cell.font = TOTAL_FONT
    cell.alignment = { vertical: 'middle' }
  }
  line.getCell('debit').numFmt = NGN
  line.getCell('credit').numFmt = NGN
  line.getCell('balance').numFmt = NGN_SIGNED
  paintSigned(line.getCell('balance'), group.balance)
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

/**
 * Roughly what a block needs before it is worth starting one, in mm: its three
 * head rows and a first entry under them.
 *
 * Deliberately approximate — it only decides where a page break falls, never
 * what the sheet says. Erring high costs a little white space at the foot of a
 * page; erring low brings back the bug it exists for.
 */
const BLOCK_OPENING_MM = 34
/** Clear of the footer line drawPdfFooters writes. */
const BOTTOM_MARGIN_MM = 18
const PAGE_TOP_MM = 20

/**
 * Starts a truck's block on a page with room to actually begin it.
 *
 * Without this a block opening near the foot of a page lays down its band, its
 * totals and its column headers with nothing beneath them, and autotable then
 * repeats that whole head on the next page — so the truck is named twice and
 * the previous page ends on a heading for rows that are not there. It reads as
 * two trucks with the same plate, one of them empty.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openBlock(doc: any, y: number): number {
  const usable = doc.internal.pageSize.getHeight() - BOTTOM_MARGIN_MM
  if (y + BLOCK_OPENING_MM <= usable) return y
  doc.addPage()
  return PAGE_TOP_MM
}

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
  for (const group of groups) {
    const { heading, detail } = bandCaption(group, totals)
    const average = group.entries ? group.debits / group.entries : 0

    cursorY = openBlock(doc, cursorY)
    autoTable(doc, {
      startY: cursorY,
      // Three header rows, in the order the block is meant to be read: who
      // this truck is, what it came to, then the columns behind it. Being in
      // the head is what makes autotable repeat them when a long block breaks
      // across a page, so a continuation can never read as an unnamed truck.
      head: [
        [
          {
            content: heading, colSpan: MONEY_FROM - 1,
            styles: { fillColor: PDF.headerNavySoft, textColor: PDF.white, halign: 'left' as const, fontSize: 8.5 },
          },
          {
            content: detail, colSpan: COLUMNS.length - MONEY_FROM + 1,
            styles: { fillColor: PDF.headerNavySoft, textColor: PDF.white, halign: 'right' as const, fontStyle: 'normal' as const, fontSize: 6.5 },
          },
        ],
        [
          {
            content: `TOTALS — ${up(group.plate)}  ·  average spend ${pdfNaira(average)} per entry`,
            colSpan: MONEY_FROM - 1,
            styles: { fillColor: PDF.totalTint, textColor: PDF.ink, halign: 'left' as const },
          },
          { content: pdfNaira(group.debits), styles: { fillColor: PDF.totalTint, textColor: PDF.ink } },
          { content: pdfNaira(group.credits), styles: { fillColor: PDF.totalTint, textColor: PDF.ink } },
          {
            content: pdfNaira(group.balance),
            styles: {
              fillColor: PDF.totalTint,
              textColor: group.balance < 0 ? PDF.loss : PDF.gain,
            },
          },
          { content: '', styles: { fillColor: PDF.totalTint } },
        ],
        COLUMNS.map((c) => c.header),
      ],
      // S/N restarts at 1 per truck — it numbers this vehicle's entries, the
      // only sequence that means anything to a reader inside one block.
      body: group.rows.map((entry, i) => {
        const v = rowValues(entry, i)
        return [
          v.sn,
          v.date ? format(v.date, DATE_PATTERN) : '—',
          v.category, v.description,
          v.debit == null ? '' : pdfNaira(v.debit),
          v.credit == null ? '' : pdfNaira(v.credit),
          pdfNaira(v.balance),
          v.enteredBy,
        ]
      }),
      styles: pdfStyles.body,
      headStyles: pdfStyles.head,
      columnStyles: { [DESCRIPTION_INDEX]: { cellWidth: 70 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== 'body') return
        if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.bandTint
        // Balance is the only column allowed its colour — see the header note.
        if (data.column.index === BALANCE_INDEX) {
          const text = String(data.cell.raw).trim()
          data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
        }
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 5
  }

  // The fleet's own bottom line, closing the document. Given the same room
  // check — a total stranded alone at the top of a page is no better than a
  // heading stranded at the foot of one.
  autoTable(doc, {
    startY: openBlock(doc, cursorY),
    body: [[
      {
        content:
          `FLEET TOTAL — ${plural(totals.entries, 'entry', 'entries')} across ${plural(totals.trucks, 'truck')}`,
        colSpan: MONEY_FROM - 1,
      },
      pdfNaira(totals.debits), pdfNaira(totals.credits), pdfNaira(totals.balance), '',
    ]],
    styles: { ...pdfStyles.body, fontStyle: 'bold' as const },
    bodyStyles: { fillColor: PDF.grandTotalTint },
    columnStyles: { [DESCRIPTION_INDEX]: { cellWidth: 70 } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.column.index === BALANCE_INDEX) {
        data.cell.styles.textColor = totals.balance < 0 ? PDF.loss : PDF.gain
      }
    },
  })

  drawPdfFooters(doc, `Soroman Truck Ledger · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
