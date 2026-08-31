import { format, parseISO } from 'date-fns'
import type { BankAccount, DeliverySale } from '#/lib/types'
import type { LedgerGroup } from '#/components/sales-ledger/SalesLedgerDialogs'
import { toNum } from '#/lib/sales-ledger-utils'
import { formatBankLabel } from '#/lib/bank-accounts'
import {
  XL, PDF, NGN, QTY, COUNT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, BAND_FILL,
  GRAND_TOTAL_FILL, SUMMARY_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

/**
 * The delivery sales ledger, exported.
 *
 * ── What was wrong with the old file ──────────────────────────────────────
 *
 * It was a CSV named `exportExcel`. Every figure went out as a bare number
 * with no thousands separator and no currency, dates were text, and nothing
 * carried weight, rule or colour — so a reader had to reconstruct which
 * number was money, which was litres and which rows belonged together.
 *
 * ── What it is now ────────────────────────────────────────────────────────
 *
 * A workbook in the house style. Each truck cycle is a row and every payment
 * against it is an indented row underneath carrying its own date, payer,
 * bank account and the balance it left behind, so a part-paid cycle can be
 * read down rather than reconstructed. A second sheet totals the same data by
 * PFI code, matching the summary table on screen.
 *
 * ── The one colour rule ───────────────────────────────────────────────────
 *
 * Red means money still owed; green means the cycle is settled or overpaid.
 * That is the reverse of the shared `paintSigned`, which colours by sign and
 * would paint an outstanding balance green because it is positive — see
 * `paintBalance`. Nothing else in the sheet is red or green.
 */

export interface SalesLedgerFilters {
  periodLabel: string
  search: string
  truck: string
  customer: string
  code: string
}

/** Cycle rows carry the truck's facts; payment rows carry one entry each. */
type RowScope = 'cycle' | 'payment'

/**
 * Balance, plain. NGN's own format turns negatives red, which here would
 * mean "overpaid" reads as an alarm; the colour is applied per cell instead.
 */
const BALANCE_FMT = '₦#,##0.00;(₦#,##0.00)'

const COLUMNS: Array<{
  header: string
  key: string
  width: number
  fmt?: string
  scope: RowScope
}> = [
  { header: 'S/N', key: 'sn', width: 6, scope: 'cycle' },
  { header: 'PFI Code', key: 'code', width: 15, scope: 'cycle' },
  { header: 'Truck No.', key: 'truck', width: 14, scope: 'cycle' },
  { header: 'Date Loaded', key: 'dateLoaded', width: 13, scope: 'cycle' },
  { header: 'Customer', key: 'customer', width: 26, scope: 'cycle' },
  { header: 'Destination', key: 'destination', width: 20, scope: 'cycle' },
  { header: 'Quantity', key: 'quantity', width: 14, fmt: QTY, scope: 'cycle' },
  // What the truck carried, beside what this row's customer took off it. On a
  // split load the two differ, and a Quantity column alone cannot say so — a
  // reader adding up a batch has no way to tell a 30,000 L share from a
  // 30,000 L truck.
  { header: 'Truck Load', key: 'loadQuantity', width: 13, fmt: QTY, scope: 'cycle' },
  { header: 'Split', key: 'split', width: 11, scope: 'cycle' },
  { header: 'Rate', key: 'rate', width: 12, fmt: NGN, scope: 'cycle' },
  { header: 'Expected', key: 'expected', width: 17, fmt: NGN, scope: 'cycle' },
  // ── the payment side ──
  { header: 'Date Paid', key: 'datePaid', width: 13, scope: 'payment' },
  { header: 'Payer', key: 'payer', width: 22, scope: 'payment' },
  { header: 'Bank Account', key: 'bank', width: 34, scope: 'payment' },
  { header: 'Entered By', key: 'enteredBy', width: 16, scope: 'payment' },
  { header: 'Amount Paid', key: 'amount', width: 17, fmt: NGN, scope: 'payment' },
  { header: 'Balance After', key: 'balanceAfter', width: 17, fmt: BALANCE_FMT, scope: 'payment' },
  // ── back to cycle totals ──
  { header: 'Total Paid', key: 'totalPaid', width: 17, fmt: NGN, scope: 'cycle' },
  { header: 'Balance', key: 'balance', width: 17, fmt: BALANCE_FMT, scope: 'cycle' },
  { header: 'Status', key: 'status', width: 13, scope: 'cycle' },
]

const up = (v: string | null | undefined) => (v || '').toUpperCase()
const dash = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : '—')

function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  try {
    const d = parseISO(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/**
 * Outstanding red, settled or overpaid green.
 *
 * Deliberately not `paintSigned` from the theme: balance here is
 * expected − paid, so a POSITIVE number is money the customer still owes and
 * must read as the warning. Sign alone would say the opposite.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paintBalance(cell: any, value: number, expected: number) {
  if (expected <= 0) return
  const colour = value > 0 ? XL.loss : XL.gain
  cell.font = { ...(cell.font || {}), color: { argb: colour } }
}

type CycleStatus = 'FULLY PAID' | 'PART PAID' | 'NO PAYMENT'

function statusOf(group: LedgerGroup): CycleStatus {
  if (group.payments.length === 0 || toNum(group.totalPaid) <= 0) return 'NO PAYMENT'
  if (group.expected > 0 && group.balance <= 0) return 'FULLY PAID'
  return 'PART PAID'
}

const STATUS_COLOUR: Record<CycleStatus, string> = {
  'FULLY PAID': XL.gain,
  'PART PAID': XL.warn,
  'NO PAYMENT': XL.inkSoft,
}

const STATUS_PDF_COLOUR: Record<CycleStatus, [number, number, number]> = {
  'FULLY PAID': PDF.gain,
  'PART PAID': [154, 103, 0],
  'NO PAYMENT': PDF.inkSoft,
}

function cycleValues(group: LedgerGroup, index: number) {
  return {
    sn: index + 1,
    code: up(group.code) || '—',
    truck: up(group.truckNumber) || '—',
    dateLoaded: safeDate(group.dateLoaded),
    customer: up(group.customerName) || '—',
    destination: up(group.location) || '—',
    quantity: group.quantity,
    loadQuantity: group.loadQuantity,
    split: group.isSplitLoad ? `1 of ${group.shareCount}` : 'Whole load',
    rate: group.rate,
    expected: group.expected,
    totalPaid: toNum(group.totalPaid),
    balance: group.balance,
    status: statusOf(group),
  }
}

function paymentValues(entry: DeliverySale, accounts: BankAccount[], balanceAfter: number) {
  return {
    datePaid: safeDate(entry.dateOfPayment || entry.dateLoaded),
    payer: up(entry.payerName) || '—',
    bank: up(formatBankLabel(accounts, entry.bank)) || '—',
    enteredBy: up(entry.enteredBy) || '—',
    amount: toNum(entry.paymentAmount),
    balanceAfter,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Totals
// ══════════════════════════════════════════════════════════════════════════

export interface SalesLedgerTotals {
  cycles: number
  payments: number
  trucks: number
  quantity: number
  expected: number
  totalPaid: number
  outstanding: number
  overpaid: number
  fullyPaid: number
  partPaid: number
  noPayment: number
}

/**
 * Outstanding and overpaid are kept apart rather than netted.
 *
 * A report whose one Balance figure is the sum of both says "₦0 outstanding"
 * for a book where half the customers are owing and the other half have
 * overpaid — which is the opposite of the truth on both sides.
 */
export function computeTotals(groups: LedgerGroup[]): SalesLedgerTotals {
  const trucks = new Set<string>()
  const t: SalesLedgerTotals = {
    cycles: groups.length, payments: 0, trucks: 0, quantity: 0, expected: 0,
    totalPaid: 0, outstanding: 0, overpaid: 0, fullyPaid: 0, partPaid: 0, noPayment: 0,
  }
  for (const g of groups) {
    if (g.truckNumber) trucks.add(g.truckNumber.trim().toUpperCase())
    t.payments += g.payments.length
    t.quantity += Math.max(0, g.quantity)
    t.expected += Math.max(0, g.expected)
    t.totalPaid += toNum(g.totalPaid)
    if (g.balance > 0) t.outstanding += g.balance
    else if (g.balance < 0) t.overpaid += Math.abs(g.balance)
    const status = statusOf(g)
    if (status === 'FULLY PAID') t.fullyPaid += 1
    else if (status === 'PART PAID') t.partPaid += 1
    else t.noPayment += 1
  }
  t.trucks = trucks.size
  return t
}

interface CodeSummary {
  code: string
  trucks: number
  quantity: number
  expected: number
  paid: number
  balance: number
  fullyPaid: number
  partPaid: number
  noPayment: number
}

function summariseByCode(groups: LedgerGroup[]): CodeSummary[] {
  const map = new Map<string, CodeSummary & { truckSet: Set<string> }>()
  for (const g of groups) {
    const code = up(g.code) || 'UNASSIGNED'
    const row = map.get(code) ?? {
      code, trucks: 0, quantity: 0, expected: 0, paid: 0, balance: 0,
      fullyPaid: 0, partPaid: 0, noPayment: 0, truckSet: new Set<string>(),
    }
    if (g.truckNumber) row.truckSet.add(g.truckNumber.trim().toUpperCase())
    row.quantity += Math.max(0, g.quantity)
    row.expected += Math.max(0, g.expected)
    row.paid += toNum(g.totalPaid)
    row.balance += g.balance
    const status = statusOf(g)
    if (status === 'FULLY PAID') row.fullyPaid += 1
    else if (status === 'PART PAID') row.partPaid += 1
    else row.noPayment += 1
    map.set(code, row)
  }
  return [...map.values()]
    .map(({ truckSet, ...rest }) => ({ ...rest, trucks: truckSet.size }))
    .sort((a, b) => b.expected - a.expected || a.code.localeCompare(b.code))
}

// ══════════════════════════════════════════════════════════════════════════
// Naming and provenance
// ══════════════════════════════════════════════════════════════════════════

export function buildFilename(filters: SalesLedgerFilters, kind: 'LEDGER' | 'PAYMENTS'): string {
  const scope = filters.code && filters.code !== 'all' ? filters.code : 'ALL CODES'
  return `SOROMAN DELIVERY SALES ${kind} ${scope} ${format(new Date(), 'dd-MM-yy')}`
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

/**
 * Every filter in force, written into the sheet.
 *
 * A filtered export that does not say what it was filtered by is a report
 * nobody can check, and these get forwarded well past the person who ran them.
 */
function subtitleOf(filters: SalesLedgerFilters, tail: string): string {
  const parts = [
    `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    `Period: ${filters.periodLabel}`,
  ]
  if (filters.code && filters.code !== 'all') parts.push(`PFI code: ${filters.code}`)
  if (filters.truck && filters.truck !== 'all') parts.push(`Truck: ${filters.truck}`)
  if (filters.customer && filters.customer !== 'all') parts.push(`Customer: ${filters.customer}`)
  if (filters.search) parts.push(`Search: "${filters.search}"`)
  parts.push(tail)
  return parts.join('   ·   ')
}

// ══════════════════════════════════════════════════════════════════════════
// Excel — shared pieces
// ══════════════════════════════════════════════════════════════════════════

interface SummaryCell {
  header: string
  value: number
  fmt: string
  /** Painted red when non-zero — an outstanding figure, not a neutral one. */
  alarm?: boolean
  good?: boolean
}

/**
 * The band of headline figures under the title: a header strip and one row of
 * values, each column widened to fit its own label.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSummaryBand(ws: any, startRow: number, cells: SummaryCell[]): number {
  cells.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width || 10, c.header.length + 4)
  })

  const head = ws.getRow(startRow)
  head.values = cells.map((c) => c.header)
  head.height = ROW_HEIGHT.header
  cells.forEach((_, i) => {
    const cell = head.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  const body = ws.getRow(startRow + 1)
  body.values = cells.map((c) => c.value)
  body.height = ROW_HEIGHT.total
  cells.forEach((c, i) => {
    const cell = body.getCell(i + 1)
    cell.numFmt = c.fmt
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
    cell.font = TOTAL_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    if (c.alarm && c.value > 0) cell.font = { ...TOTAL_FONT, color: { argb: XL.loss } }
    if (c.good && c.value > 0) cell.font = { ...TOTAL_FONT, color: { argb: XL.gain } }
  })

  return startRow + 2
}

/** The colour key, so a reader never has to guess what red means. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeLegend(ws: any, row: number): number {
  const items: Array<[string, string]> = [
    ['FULLY PAID', XL.gain],
    ['PART PAID', XL.warn],
    ['NO PAYMENT', XL.inkSoft],
    ['RED FIGURE = STILL OWING', XL.loss],
  ]
  const r = ws.getRow(row)
  r.height = ROW_HEIGHT.body
  r.getCell(1).value = 'KEY'
  r.getCell(1).font = { bold: true, size: 9, color: { argb: XL.inkSoft } }
  items.forEach(([label, colour], i) => {
    const cell = r.getCell(i + 2)
    cell.value = label
    cell.font = { bold: true, size: 9, color: { argb: colour } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
  return row + 1
}

// ══════════════════════════════════════════════════════════════════════════
// Excel — the ledger
// ══════════════════════════════════════════════════════════════════════════

export async function exportSalesLedgerExcel(
  groups: LedgerGroup[],
  filters: SalesLedgerFilters,
  accounts: BankAccount[],
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const totals = computeTotals(groups)

  // ── Sheet 1: the ledger ─────────────────────────────────────────────
  const ws = wb.addWorksheet('Sales Ledger', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — DELIVERY SALES LEDGER',
    subtitle: subtitleOf(filters, `${totals.cycles} cycles · ${totals.payments} payments`),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  cursor = writeSummaryBand(ws, cursor, [
    { header: 'Cycles', value: totals.cycles, fmt: COUNT },
    { header: 'Trucks', value: totals.trucks, fmt: COUNT },
    { header: 'Payments', value: totals.payments, fmt: COUNT },
    { header: 'Quantity', value: totals.quantity, fmt: QTY },
    { header: 'Expected', value: totals.expected, fmt: NGN },
    { header: 'Total Paid', value: totals.totalPaid, fmt: NGN, good: true },
    { header: 'Outstanding', value: totals.outstanding, fmt: NGN, alarm: true },
    { header: 'Overpaid', value: totals.overpaid, fmt: NGN },
    { header: 'Fully Paid', value: totals.fullyPaid, fmt: COUNT },
  ])
  cursor = writeLegend(ws, cursor + 1)
  cursor += 2

  // ── The table ───────────────────────────────────────────────────────
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

  groups.forEach((group, i) => {
    const values = cycleValues(group, i)
    const row = ws.getRow(cursor)
    // Cell by cell rather than row.values: the cycle columns are not
    // contiguous — the payment block sits between Expected and Total Paid.
    for (const c of COLUMNS) {
      if (c.scope !== 'cycle') continue
      const v = (values as Record<string, unknown>)[c.key]
      if (v != null && v !== '' && v !== 0) row.getCell(c.key).value = v as never
    }
    row.height = ROW_HEIGHT.body

    // Banding on cycle rows only — payment rows carry their own tint, and
    // striping both would break the grouping the eye relies on.
    const band = i % 2 === 1
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (band) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
    }
    row.getCell('truck').font = { bold: true }
    row.getCell('code').font = { bold: true }
    if (row.getCell('dateLoaded').value) row.getCell('dateLoaded').numFmt = DATE_FMT
    if (group.expected > 0) row.getCell('balance').value = group.balance
    paintBalance(row.getCell('balance'), group.balance, group.expected)
    row.getCell('status').font = { bold: true, size: 9, color: { argb: STATUS_COLOUR[values.status] } }
    row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' }
    cursor++

    let running = 0
    for (const entry of group.payments) {
      running += toNum(entry.paymentAmount)
      const pv = paymentValues(entry, accounts, group.expected - running)
      const sub = ws.getRow(cursor)
      for (const c of COLUMNS) {
        if (c.scope !== 'payment') continue
        const v = (pv as Record<string, unknown>)[c.key]
        if (v != null && v !== '') sub.getCell(c.key).value = v as never
      }
      sub.height = ROW_HEIGHT.body
      for (const c of COLUMNS) {
        const cell = sub.getCell(c.key)
        cell.border = ALL_BORDERS
        cell.fill = SUBROW_FILL
        if (c.scope === 'payment' && c.fmt) cell.numFmt = c.fmt
      }
      if (sub.getCell('datePaid').value) sub.getCell('datePaid').numFmt = DATE_FMT
      if (group.expected <= 0) sub.getCell('balanceAfter').value = null
      else paintBalance(sub.getCell('balanceAfter'), group.expected - running, group.expected)
      cursor++
    }
  })

  // Freeze everything above the table, and let the header filter the body.
  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: COLUMNS.length },
  }

  // ── Grand total ─────────────────────────────────────────────────────
  const totalRow = ws.getRow(cursor)
  totalRow.getCell('truck').value = `TOTAL — ${totals.cycles} cycles`
  totalRow.getCell('quantity').value = totals.quantity
  totalRow.getCell('expected').value = totals.expected
  totalRow.getCell('amount').value = totals.totalPaid
  totalRow.getCell('totalPaid').value = totals.totalPaid
  totalRow.getCell('balance').value = totals.outstanding - totals.overpaid
  totalRow.height = ROW_HEIGHT.total
  // Walked by position: eachCell skips columns this row never set, which
  // would leave the shaded bar stopping partway across the sheet.
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const c of COLUMNS) {
    if (c.fmt) totalRow.getCell(c.key).numFmt = c.fmt
  }
  paintBalance(totalRow.getCell('balance'), totals.outstanding - totals.overpaid, totals.expected)

  // ── Sheet 2: by PFI code ────────────────────────────────────────────
  writeCodeSheet(wb, groups, filters, totals)

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${buildFilename(filters, 'LEDGER')}.xlsx`,
  )
}

/** The same money, totalled by PFI code — the summary table on screen. */
function writeCodeSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  groups: LedgerGroup[],
  filters: SalesLedgerFilters,
  totals: SalesLedgerTotals,
) {
  const CODE_COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
    { header: 'PFI Code', key: 'code', width: 18 },
    { header: 'Trucks', key: 'trucks', width: 10, fmt: COUNT },
    { header: 'Quantity', key: 'quantity', width: 15, fmt: QTY },
    { header: 'Expected', key: 'expected', width: 18, fmt: NGN },
    { header: 'Total Paid', key: 'paid', width: 18, fmt: NGN },
    { header: 'Balance', key: 'balance', width: 18, fmt: BALANCE_FMT },
    { header: 'Fully Paid', key: 'fullyPaid', width: 11, fmt: COUNT },
    { header: 'Part Paid', key: 'partPaid', width: 11, fmt: COUNT },
    { header: 'No Payment', key: 'noPayment', width: 12, fmt: COUNT },
  ]

  const ws = wb.addWorksheet('By PFI Code', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = CODE_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — SALES LEDGER BY PFI CODE',
    subtitle: subtitleOf(filters, `${totals.cycles} cycles across ${summariseByCode(groups).length} codes`),
    columnSpan: CODE_COLUMNS.length,
  })
  cursor = writeSectionHeading(ws, cursor + 1, 'PAYMENT STATUS BY ALLOCATION CODE')

  const header = ws.getRow(cursor)
  header.values = CODE_COLUMNS.map((c) => c.header)
  header.height = ROW_HEIGHT.header
  CODE_COLUMNS.forEach((_, i) => {
    const cell = header.getCell(i + 1)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  cursor++

  const rows = summariseByCode(groups)
  rows.forEach((summary, i) => {
    const row = ws.getRow(cursor)
    row.values = summary as never
    row.height = ROW_HEIGHT.body
    for (const c of CODE_COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (i % 2 === 1) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
    }
    row.getCell('code').font = { bold: true }
    paintBalance(row.getCell('balance'), summary.balance, summary.expected)
    cursor++
  })

  const totalRow = ws.getRow(cursor)
  totalRow.values = {
    code: 'TOTAL',
    trucks: totals.trucks,
    quantity: totals.quantity,
    expected: totals.expected,
    paid: totals.totalPaid,
    balance: totals.outstanding - totals.overpaid,
    fullyPaid: totals.fullyPaid,
    partPaid: totals.partPaid,
    noPayment: totals.noPayment,
  } as never
  totalRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= CODE_COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const c of CODE_COLUMNS) {
    if (c.fmt) totalRow.getCell(c.key).numFmt = c.fmt
  }
  paintBalance(totalRow.getCell('balance'), totals.outstanding - totals.overpaid, totals.expected)
}

// ══════════════════════════════════════════════════════════════════════════
// PDF — the ledger
// ══════════════════════════════════════════════════════════════════════════

export async function exportSalesLedgerPdf(
  groups: LedgerGroup[],
  filters: SalesLedgerFilters,
  accounts: BankAccount[],
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  const totals = computeTotals(groups)
  const startY = drawPdfHeader(
    doc,
    'Soroman — Delivery Sales Ledger',
    subtitleOf(filters, `${totals.cycles} cycles · ${totals.payments} payments`),
  )

  autoTable(doc, {
    startY,
    head: [['Cycles', 'Trucks', 'Payments', 'Quantity', 'Expected', 'Total Paid', 'Outstanding', 'Overpaid', 'Fully Paid']],
    body: [[
      String(totals.cycles), String(totals.trucks), String(totals.payments),
      `${totals.quantity.toLocaleString()} L`,
      pdfNaira(totals.expected), pdfNaira(totals.totalPaid),
      pdfNaira(totals.outstanding), pdfNaira(totals.overpaid), String(totals.fullyPaid),
    ]],
    styles: pdfStyles.body,
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen },
    bodyStyles: pdfStyles.summaryBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (data.column.index === 5) data.cell.styles.textColor = PDF.gain
      if (data.column.index === 6 && totals.outstanding > 0) data.cell.styles.textColor = PDF.loss
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cursorY = (doc as any).lastAutoTable.finalY + 6

  const cellsFor = (scope: RowScope, values: Record<string, string | number>) =>
    COLUMNS.map((c) => (c.scope === scope ? (values[c.key] ?? '') : ''))

  const body: (string | number)[][] = []
  groups.forEach((group, i) => {
    const v = cycleValues(group, i)
    body.push(
      cellsFor('cycle', {
        sn: v.sn,
        code: v.code,
        truck: v.truck,
        dateLoaded: v.dateLoaded ? format(v.dateLoaded, DATE_PATTERN) : '—',
        customer: v.customer,
        destination: v.destination,
        quantity: v.quantity > 0 ? `${v.quantity.toLocaleString()} L` : '—',
        loadQuantity: v.loadQuantity > 0 ? `${v.loadQuantity.toLocaleString()} L` : '—',
        split: v.split,
        rate: v.rate > 0 ? pdfNaira(v.rate) : '—',
        expected: v.expected > 0 ? pdfNaira(v.expected) : '—',
        totalPaid: pdfNaira(v.totalPaid),
        balance: v.expected > 0 ? pdfNaira(v.balance) : '—',
        status: v.status,
      }),
    )

    let running = 0
    for (const entry of group.payments) {
      running += toNum(entry.paymentAmount)
      const pv = paymentValues(entry, accounts, group.expected - running)
      body.push(
        cellsFor('payment', {
          datePaid: pv.datePaid ? format(pv.datePaid, DATE_PATTERN) : '—',
          payer: pv.payer,
          bank: pv.bank,
          enteredBy: pv.enteredBy,
          amount: pdfNaira(pv.amount),
          balanceAfter: group.expected > 0 ? pdfNaira(pv.balanceAfter) : '',
        }),
      )
    }
  })

  const footRow = new Array(COLUMNS.length).fill('')
  const at = (key: string, value: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === key)
    if (idx >= 0) footRow[idx] = value
  }
  at('truck', `TOTAL (${totals.cycles})`)
  at('quantity', `${totals.quantity.toLocaleString()} L`)
  at('expected', pdfNaira(totals.expected))
  at('amount', pdfNaira(totals.totalPaid))
  at('totalPaid', pdfNaira(totals.totalPaid))
  at('balance', pdfNaira(totals.outstanding - totals.overpaid))

  const snIndex = COLUMNS.findIndex((c) => c.key === 'sn')
  const statusIndex = COLUMNS.findIndex((c) => c.key === 'status')
  const balanceIndex = COLUMNS.findIndex((c) => c.key === 'balance')
  const balanceAfterIndex = COLUMNS.findIndex((c) => c.key === 'balanceAfter')

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body,
    foot: [footRow],
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      const raw = data.row.raw
      if (!Array.isArray(raw)) return

      // A payment row is the one whose S/N cell is blank — whether a row is a
      // cycle or one of its payments depends on what came before it, so plain
      // alternate striping would say nothing.
      const isPayment = data.section === 'body' && raw[snIndex] === ''
      if (isPayment) {
        data.cell.styles.fillColor = PDF.subRowTint
        if (data.column.index === balanceAfterIndex) {
          const text = String(data.cell.raw).trim()
          if (text && text !== '—') {
            data.cell.styles.textColor = text.startsWith('(') ? PDF.gain : PDF.loss
          }
        }
        return
      }

      if (data.section === 'body' && (data.column.index === 1 || data.column.index === 2)) {
        data.cell.styles.fontStyle = 'bold'
      }

      if (data.column.index === statusIndex && data.section === 'body') {
        const status = String(data.cell.raw) as CycleStatus
        if (STATUS_PDF_COLOUR[status]) {
          data.cell.styles.textColor = STATUS_PDF_COLOUR[status]
          data.cell.styles.fontStyle = 'bold'
        }
        return
      }

      // Outstanding red, settled or overpaid green — pdfNaira parenthesises
      // negatives, so a leading "(" is an overpayment.
      if (data.column.index === balanceIndex) {
        const text = String(data.cell.raw).trim()
        if (text && text !== '—') {
          data.cell.styles.textColor = text.startsWith('(') ? PDF.gain : PDF.loss
        }
      }
    },
  })

  drawPdfFooters(doc, `Soroman Delivery Sales Ledger · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters, 'LEDGER')}.pdf`)
}

// ══════════════════════════════════════════════════════════════════════════
// Daily payments — one row per entry, nothing merged
// ══════════════════════════════════════════════════════════════════════════

const PAYMENT_COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Date Paid', key: 'datePaid', width: 13 },
  { header: 'PFI Code', key: 'code', width: 15 },
  { header: 'Truck No.', key: 'truck', width: 14 },
  { header: 'Customer', key: 'customer', width: 26 },
  { header: 'Destination', key: 'destination', width: 20 },
  { header: 'Volume', key: 'quantity', width: 14, fmt: QTY },
  { header: 'Rate', key: 'rate', width: 12, fmt: NGN },
  { header: 'Expected', key: 'expected', width: 17, fmt: NGN },
  { header: 'Amount Paid', key: 'amount', width: 17, fmt: NGN },
  { header: 'Payer', key: 'payer', width: 22 },
  { header: 'Bank Account', key: 'bank', width: 34 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Entered By', key: 'enteredBy', width: 16 },
]

function paymentRow(sale: DeliverySale, accounts: BankAccount[], index: number) {
  return {
    sn: index + 1,
    datePaid: safeDate(sale.dateOfPayment || sale.dateLoaded),
    code: up(sale.allocationCode) || '—',
    truck: up(sale.truckNumber) || '—',
    customer: up(sale.customerName) || '—',
    destination: up(sale.location) || '—',
    quantity: toNum(sale.quantity),
    rate: toNum(sale.rate),
    expected: toNum(sale.salesValue),
    amount: toNum(sale.paymentAmount),
    payer: up(sale.payerName) || '—',
    bank: up(formatBankLabel(accounts, sale.bank)) || '—',
    phone: dash(sale.phoneNumber),
    enteredBy: up(sale.enteredBy) || '—',
  }
}

/**
 * What a set of payment rows adds up to.
 *
 * Volume and expected are deliberately NOT summed. delivery_sales repeats the
 * load's quantity and sales_value on every payment against it, so a 45,000 L
 * truck settled in four instalments would contribute 180,000 L and four times
 * its invoice — the same multiplication that had the dashboard reporting
 * ₦33bn of outstanding. On a list of payments the only figures that mean
 * anything are how many and how much.
 */
export function paymentTotals(sales: DeliverySale[]) {
  return sales.reduce(
    (acc, s) => {
      const amount = toNum(s.paymentAmount)
      return {
        count: acc.count + 1,
        paid: acc.paid + amount,
        // Transfers between trucks net to nothing across the whole list, so
        // they are counted apart — otherwise a day of heavy reallocation
        // looks like a day of no collections.
        received: acc.received + (s.transferGroupId ? 0 : amount),
        transferred: acc.transferred + (s.transferGroupId ? amount : 0),
      }
    },
    { count: 0, paid: 0, received: 0, transferred: 0 },
  )
}

/** The day a payment belongs to, as yyyy-MM-dd, or '' when nothing is recorded. */
const payDayKey = (s: DeliverySale) =>
  String(s.dateOfPayment || s.dateLoaded || '').slice(0, 10)

/**
 * Payments in day order, newest first, each day carrying its own total.
 *
 * Newest first because this list is read to answer "what came in recently",
 * and a reader should not have to scroll past four months to find today.
 */
export function groupPaymentsByDay(sales: DeliverySale[]) {
  const days = new Map<string, DeliverySale[]>()
  for (const s of sales) {
    const key = payDayKey(s)
    const arr = days.get(key) ?? []
    arr.push(s)
    days.set(key, arr)
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, rows]) => ({ day, rows, totals: paymentTotals(rows) }))
}

export async function exportDailyPaymentsExcel(
  sales: DeliverySale[],
  filters: SalesLedgerFilters,
  accounts: BankAccount[],
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const ws = wb.addWorksheet('Payments', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = PAYMENT_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const t = paymentTotals(sales)
  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — DELIVERY PAYMENTS',
    subtitle: subtitleOf(filters, `${t.count} payment entries`),
    columnSpan: PAYMENT_COLUMNS.length,
  })
  cursor += 1

  const byDay = groupPaymentsByDay(sales)

  cursor = writeSummaryBand(ws, cursor, [
    { header: 'Entries', value: t.count, fmt: COUNT },
    { header: 'Days', value: byDay.length, fmt: COUNT },
    { header: 'Received', value: t.received, fmt: NGN, good: true },
    { header: 'Moved Between Trucks', value: t.transferred, fmt: NGN },
    { header: 'Net Total', value: t.paid, fmt: NGN, good: true },
  ])
  cursor += 2

  // ── Totals per day, before the detail ────────────────────────────────
  // The question this tab exists to answer is "how much came in, and when".
  // Putting the answer at the top means it does not have to be assembled by
  // scrolling several hundred rows.
  cursor = writeSectionHeading(ws, cursor, 'TOTALS BY DAY')
  const dayHead = ws.getRow(cursor)
  dayHead.values = ['Date', 'Entries', 'Received', 'Moved', 'Day Total']
  dayHead.height = ROW_HEIGHT.header
  for (let i = 1; i <= 5; i++) {
    const cell = dayHead.getCell(i)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'right' }
  }
  cursor++

  for (const d of byDay) {
    const row = ws.getRow(cursor)
    row.height = ROW_HEIGHT.body
    row.getCell(1).value = d.day ? safeDate(d.day) : 'No date recorded'
    if (d.day) row.getCell(1).numFmt = DATE_FMT
    row.getCell(2).value = d.totals.count
    row.getCell(2).numFmt = COUNT
    row.getCell(3).value = d.totals.received
    row.getCell(3).numFmt = NGN
    row.getCell(4).value = d.totals.transferred
    row.getCell(4).numFmt = NGN
    row.getCell(5).value = d.totals.paid
    row.getCell(5).numFmt = NGN
    row.getCell(5).font = { bold: true, color: { argb: XL.gain } }
    for (let i = 1; i <= 5; i++) {
      row.getCell(i).border = ALL_BORDERS
      row.getCell(i).alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'right' }
    }
    cursor++
  }
  cursor += 2

  const header = ws.getRow(cursor)
  header.values = PAYMENT_COLUMNS.map((c) => c.header)
  header.height = ROW_HEIGHT.header
  header.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  cursor++
  const tableStart = cursor

  // Detail in day blocks, each closed by its own total. A flat list of six
  // hundred payments cannot be read as days without counting rows.
  let serial = 0
  for (const d of byDay) {
    d.rows.forEach((sale, i) => {
      const values = paymentRow(sale, accounts, serial)
      serial++
      const row = ws.getRow(cursor)
      row.values = values as never
      row.height = ROW_HEIGHT.body
      for (const c of PAYMENT_COLUMNS) {
        const cell = row.getCell(c.key)
        cell.border = ALL_BORDERS
        if (i % 2 === 1) cell.fill = BAND_FILL
        if (c.fmt) cell.numFmt = c.fmt
      }
      if (row.getCell('datePaid').value) row.getCell('datePaid').numFmt = DATE_FMT
      row.getCell('truck').font = { bold: true }
      // A transfer leg is money moving inside the business, not a collection,
      // and carries the blue that means exactly that everywhere else.
      const isTransfer = !!sale.transferGroupId
      row.getCell('amount').font = {
        bold: true,
        color: { argb: isTransfer ? XL.internal : XL.gain },
      }
      cursor++
    })

    const sub = ws.getRow(cursor)
    sub.height = ROW_HEIGHT.total
    sub.getCell('customer').value = d.day
      ? `${format(parseISO(d.day), 'd MMM yyyy')} — ${d.totals.count} ${d.totals.count === 1 ? 'entry' : 'entries'}`
      : `No date recorded — ${d.totals.count} entries`
    sub.getCell('amount').value = d.totals.paid
    sub.getCell('amount').numFmt = NGN
    for (let i = 1; i <= PAYMENT_COLUMNS.length; i++) {
      const cell = sub.getCell(i)
      cell.border = TOTAL_BORDERS
      cell.fill = SUMMARY_FILL
      cell.font = TOTAL_FONT
    }
    cursor++
    cursor++
  }

  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: PAYMENT_COLUMNS.length },
  }

  const totalRow = ws.getRow(cursor)
  totalRow.getCell('customer').value = `TOTAL — ${t.count} entries across ${byDay.length} ${byDay.length === 1 ? 'day' : 'days'}`
  // Volume and expected are not totalled here: they are the load's figures,
  // repeated on each payment, and adding them up says nothing true.
  totalRow.getCell('amount').value = t.paid
  totalRow.height = ROW_HEIGHT.total
  for (let i = 1; i <= PAYMENT_COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const c of PAYMENT_COLUMNS) {
    if (c.fmt) totalRow.getCell(c.key).numFmt = c.fmt
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${buildFilename(filters, 'PAYMENTS')}.xlsx`,
  )
}

export async function exportDailyPaymentsPdf(
  sales: DeliverySale[],
  filters: SalesLedgerFilters,
  accounts: BankAccount[],
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  const t = paymentTotals(sales)
  const startY = drawPdfHeader(
    doc,
    'Soroman — Delivery Payments',
    subtitleOf(filters, `${t.count} payment entries`),
  )

  const byDay = groupPaymentsByDay(sales)

  autoTable(doc, {
    startY,
    // Volume and expected are gone: they are the load's figures repeated on
    // every payment, so totalling them across a payment list says nothing.
    head: [['Entries', 'Days', 'Received', 'Moved Between Trucks', 'Net Total']],
    body: [[
      String(t.count), String(byDay.length),
      pdfNaira(t.received), pdfNaira(t.transferred), pdfNaira(t.paid),
    ]],
    styles: pdfStyles.body,
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen },
    bodyStyles: pdfStyles.summaryBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 2) data.cell.styles.textColor = PDF.gain
      if (data.section === 'body' && data.column.index === 3) data.cell.styles.textColor = PDF.internal
      if (data.section === 'body' && data.column.index === 4) data.cell.styles.textColor = PDF.gain
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursorY = (doc as any).lastAutoTable.finalY + 6

  // ── Totals per day ───────────────────────────────────────────────────
  autoTable(doc, {
    startY: cursorY,
    head: [['Date', 'Entries', 'Received', 'Moved', 'Day Total']],
    body: byDay.map((d) => [
      d.day ? format(parseISO(d.day), DATE_PATTERN) : 'No date recorded',
      String(d.totals.count),
      pdfNaira(d.totals.received),
      d.totals.transferred === 0 ? '—' : pdfNaira(d.totals.transferred),
      pdfNaira(d.totals.paid),
    ]),
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' },
      3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' },
    },
    tableWidth: 140,
    margin: { left: 14 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 4) data.cell.styles.textColor = PDF.gain
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = (doc as any).lastAutoTable.finalY + 6

  // Detail runs in day order, and each day's rows are followed by that day's
  // total so the blocks are readable on paper without adding anything up.
  const body: Array<Array<string | number>> = []
  let serial = 0
  for (const d of byDay) {
    for (const sale of d.rows) {
      const v = paymentRow(sale, accounts, serial)
      serial++
      body.push([
        v.sn,
        v.datePaid ? format(v.datePaid, DATE_PATTERN) : '—',
        v.code, v.truck, v.customer, v.destination,
        v.quantity > 0 ? `${v.quantity.toLocaleString()} L` : '—',
        v.rate > 0 ? pdfNaira(v.rate) : '—',
        v.expected > 0 ? pdfNaira(v.expected) : '—',
        v.amount === 0 ? '—' : pdfNaira(v.amount),
        v.payer, v.bank, v.phone, v.enteredBy,
      ])
    }
    const sub = new Array(PAYMENT_COLUMNS.length).fill('')
    sub[4] = d.day
      ? `${format(parseISO(d.day), DATE_PATTERN)} — ${d.totals.count} ${d.totals.count === 1 ? 'entry' : 'entries'}`
      : `No date — ${d.totals.count} entries`
    sub[9] = pdfNaira(d.totals.paid)
    body.push(sub)
  }
  // Which body rows are a day total, so didParseCell can shade them.
  const subtotalRows = new Set<number>()
  {
    let i = 0
    for (const d of byDay) { i += d.rows.length; subtotalRows.add(i); i += 1 }
  }

  const foot = new Array(PAYMENT_COLUMNS.length).fill('')
  foot[4] = `TOTAL (${t.count} across ${byDay.length} ${byDay.length === 1 ? 'day' : 'days'})`
  foot[9] = pdfNaira(t.paid)

  autoTable(doc, {
    startY: cursorY,
    head: [PAYMENT_COLUMNS.map((c) => c.header)],
    body,
    foot: [foot],
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: { ...pdfStyles.foot, fillColor: PDF.grandTotalTint },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const isSubtotal = subtotalRows.has(data.row.index)
      if (isSubtotal) {
        data.cell.styles.fillColor = PDF.summaryTint
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = PDF.ink
        if (data.column.index === 9) data.cell.styles.textColor = PDF.gain
        return
      }
      if (data.row.index % 2 === 1) data.cell.styles.fillColor = PDF.bandTint
      if (data.column.index === 9) {
        data.cell.styles.textColor = PDF.gain
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })

  drawPdfFooters(doc, `Soroman Delivery Payments · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters, 'PAYMENTS')}.pdf`)
}
