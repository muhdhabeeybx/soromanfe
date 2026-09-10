import { format, parseISO } from 'date-fns'

import {
  XL, PDF, NGN, COUNT, DATE_FMT, DATE_PATTERN, qtyFormat,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, BAND_FILL,
  GRAND_TOTAL_FILL, SUMMARY_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'
import { shareMoney, type LoadMoney, type StatusDisplay } from '#/lib/delivery-records'
import type { LoadSplit } from '#/lib/load-split'

/**
 * The delivery inventory, exported as it reads on screen — expanded.
 *
 * ── What was wrong with the old file ──────────────────────────────────────
 *
 * A flat CSV of truck rows. Every batch's identity was a repeated string in
 * column two, there were no batch totals at all, and not one figure of money:
 * a reader who wanted to know what PFI-40B was worth had to select its rows
 * by eye and sum them by hand. It was the table with the structure taken out.
 *
 * ── What it is now ────────────────────────────────────────────────────────
 *
 * The screen's own shape, with every batch already open. A bold batch row
 * carrying its totals, the trucks that made it up indented underneath, and on
 * a split load one further line per customer — the three row kinds the table
 * has, in the order the table has them. Money is on all three, so a batch can
 * be read down: what it is worth, what has come in, what is left.
 *
 * ── The one colour rule ───────────────────────────────────────────────────
 *
 * Red means money still owed; green means settled or overpaid. Nothing else
 * in the sheet is red or green. Taken from the sales ledger export
 * deliberately: these two reports are read side by side and a balance must
 * not change colour between them.
 */

// ══════════════════════════════════════════════════════════════════════════
// What the page hands over
// ══════════════════════════════════════════════════════════════════════════

/** One truck's load, as the inventory page has already resolved it. */
export interface ExportLoad {
  truckPlate: string
  driverName: string
  custName: string
  destination: string
  qty: number
  unitLabel: string
  rate: number
  money: LoadMoney
  status: StatusDisplay
  dateLoaded: string
  split: LoadSplit
}

/** One batch: the row, and the loads that drop down from it. */
export interface ExportBatch {
  code: string
  product: string
  depot: string
  /** When the batch loaded — the earliest of its trucks. */
  dateLoaded: string
  records: ExportLoad[]
}

/** Every filter in force, so the file can say what it is a view of. */
export interface DeliveryInventoryFilters {
  status: string
  truck: string
  customer: string
  customerType: string
  code: string
  search: string
  dateFrom: string
  dateTo: string
}

/**
 * Balance, plain. NGN's own format turns negatives red, which here would mean
 * "overpaid" reads as an alarm; the colour is applied per cell instead.
 */
const BALANCE_FMT = '₦#,##0.00;(₦#,##0.00)'

type RowKind = 'batch' | 'truck' | 'share'

const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Batch', key: 'batch', width: 14 },
  { header: 'Product', key: 'product', width: 14 },
  { header: 'Loaded At', key: 'depot', width: 18 },
  { header: 'Date Loaded', key: 'date', width: 13 },
  { header: 'Truck No.', key: 'truck', width: 14 },
  { header: 'Driver', key: 'driver', width: 18 },
  { header: 'Customer', key: 'customer', width: 24 },
  { header: 'Destination', key: 'destination', width: 18 },
  { header: 'Quantity', key: 'quantity', width: 14, fmt: 'QTY' },
  { header: 'Rate', key: 'rate', width: 12, fmt: NGN },
  { header: 'Value', key: 'value', width: 17, fmt: NGN },
  { header: 'Paid', key: 'paid', width: 17, fmt: NGN },
  { header: 'Balance', key: 'balance', width: 17, fmt: BALANCE_FMT },
  { header: 'Status', key: 'status', width: 13 },
]

const up = (v: string | null | undefined) => (v || '').toUpperCase()

/**
 * The quantity format for this export.
 *
 * A page carrying LPG in kilograms and fuel in litres has no single right
 * suffix, so where the batches disagree the figures go out bare rather than
 * all labelled with whichever unit came first.
 */
function quantityFormat(batches: ExportBatch[]): string {
  const units = new Set<string>()
  for (const b of batches) for (const r of b.records) if (r.unitLabel) units.add(r.unitLabel)
  if (units.size !== 1) return COUNT
  const unit = [...units][0].toLowerCase()
  if (unit.startsWith('lit')) return qtyFormat('L')
  if (unit.startsWith('kilo') || unit === 'kg') return qtyFormat('kg')
  if (unit.startsWith('ton') || unit === 'mt') return qtyFormat('MT')
  return COUNT
}

function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  try {
    const d = parseISO(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Totals
// ══════════════════════════════════════════════════════════════════════════

export interface InventoryTotals {
  batches: number
  trucks: number
  quantity: number
  unsold: number
  unsoldQty: number
  sold: number
  soldQty: number
  value: number
  paid: number
  outstanding: number
  overpaid: number
}

/** One batch's line: its trucks summed, so the row states the batch. */
export function batchTotals(batch: ExportBatch) {
  let quantity = 0, value = 0, paid = 0, balance = 0
  let unsold = 0, unsoldQty = 0, sold = 0, soldQty = 0
  for (const r of batch.records) {
    quantity += r.qty
    value += r.money.expected
    paid += r.money.paid
    balance += r.money.balance
    if (r.status.key === 'loaded') { unsold += 1; unsoldQty += r.qty }
    else if (r.status.key === 'offloaded') { sold += 1; soldQty += r.qty }
  }
  return { quantity, value, paid, balance, unsold, unsoldQty, sold, soldQty, trucks: batch.records.length }
}

/**
 * Outstanding and overpaid are kept apart rather than netted — a report whose
 * one balance figure is the sum of both says "₦0 outstanding" for a book where
 * half the customers are owing and the other half have overpaid.
 */
export function computeTotals(batches: ExportBatch[]): InventoryTotals {
  const t: InventoryTotals = {
    batches: batches.length, trucks: 0, quantity: 0, unsold: 0, unsoldQty: 0,
    sold: 0, soldQty: 0, value: 0, paid: 0, outstanding: 0, overpaid: 0,
  }
  for (const batch of batches) {
    for (const r of batch.records) {
      t.trucks += 1
      t.quantity += r.qty
      t.value += r.money.expected
      t.paid += r.money.paid
      if (r.money.balance > 0) t.outstanding += r.money.balance
      else if (r.money.balance < 0) t.overpaid += Math.abs(r.money.balance)
      if (r.status.key === 'loaded') { t.unsold += 1; t.unsoldQty += r.qty }
      else if (r.status.key === 'offloaded') { t.sold += 1; t.soldQty += r.qty }
    }
  }
  return t
}

// ══════════════════════════════════════════════════════════════════════════
// Naming and provenance
// ══════════════════════════════════════════════════════════════════════════

export function buildFilename(filters: DeliveryInventoryFilters): string {
  const scope = filters.code || 'ALL BATCHES'
  return `SOROMAN DELIVERY INVENTORY ${scope} ${format(new Date(), 'dd-MM-yy')}`
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

/**
 * Every filter in force, written into the file.
 *
 * A filtered export that does not say what it was filtered by is a report
 * nobody can check, and these get forwarded well past the person who ran them.
 */
function subtitleOf(filters: DeliveryInventoryFilters, tail: string): string {
  const parts = [`Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`]
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`Loaded ${filters.dateFrom || '…'} to ${filters.dateTo || '…'}`)
  }
  if (filters.code) parts.push(`Batch: ${filters.code}`)
  if (filters.status) parts.push(`Status: ${filters.status}`)
  if (filters.truck) parts.push(`Truck: ${filters.truck}`)
  if (filters.customer) parts.push(`Customer: ${filters.customer}`)
  if (filters.customerType) parts.push(`Customer type: ${filters.customerType}`)
  if (filters.search) parts.push(`Search: "${filters.search}"`)
  parts.push(tail)
  return parts.join('   ·   ')
}

// ══════════════════════════════════════════════════════════════════════════
// The rows, built once and written by both writers
// ══════════════════════════════════════════════════════════════════════════

type CellValue = string | number | Date | null

interface ExportRow {
  kind: RowKind
  values: Record<string, CellValue>
  /** Owed, settled, or not priced at all — decides the balance colour. */
  balance: number
  priced: boolean
}

/**
 * The screen's rows, in the screen's order.
 *
 * Built once for both writers so the workbook and the PDF cannot say
 * different things — the ledger export learned that the hard way by building
 * its body twice.
 */
export function buildRows(batches: ExportBatch[]): ExportRow[] {
  const rows: ExportRow[] = []

  batches.forEach((batch, i) => {
    const t = batchTotals(batch)
    const status = [
      t.unsold > 0 ? `${t.unsold} unsold` : '',
      t.sold > 0 ? `${t.sold} sold` : '',
    ].filter(Boolean).join(' · ') || '—'

    rows.push({
      kind: 'batch',
      balance: t.balance,
      priced: t.value > 0,
      values: {
        sn: i + 1,
        batch: up(batch.code) || 'NO CODE',
        product: up(batch.product) || '—',
        depot: up(batch.depot) || '—',
        date: safeDate(batch.dateLoaded),
        truck: `${t.trucks} truck${t.trucks === 1 ? '' : 's'}`,
        driver: '',
        customer: '',
        destination: '',
        quantity: t.quantity || null,
        rate: null,
        value: t.value || null,
        paid: t.paid || null,
        balance: t.value > 0 ? t.balance : null,
        status,
      },
    })

    for (const r of batch.records) {
      const split = r.split.isSplit
      rows.push({
        kind: 'truck',
        balance: r.money.balance,
        priced: r.money.expected > 0,
        values: {
          sn: '',
          batch: '',
          product: '',
          depot: '',
          date: safeDate(r.dateLoaded),
          truck: up(r.truckPlate) || '—',
          driver: up(r.driverName) || '—',
          // The whole truck on the truck's row; who took what is on the
          // lines below it, exactly as the table does it.
          customer: split ? `SPLIT ACROSS ${r.split.shares.length}` : (up(r.custName) || 'UNASSIGNED'),
          destination: split ? '' : (up(r.destination) || '—'),
          quantity: r.qty || null,
          rate: split ? null : (r.rate || null),
          value: r.money.expected || null,
          paid: r.money.paid || null,
          balance: r.money.expected > 0 ? r.money.balance : null,
          status: r.status.label.toUpperCase(),
        },
      })

      if (!split) continue

      for (const share of r.split.shares) {
        const m = shareMoney(share, r.rate)
        rows.push({
          kind: 'share',
          balance: m.balance,
          priced: m.expected > 0,
          values: {
            sn: '', batch: '', product: '', depot: '', date: null, truck: '', driver: '',
            customer: `   ↳ ${up(share.customerName) || 'UNASSIGNED'}`,
            destination: up(share.destination) || '—',
            quantity: share.quantity || null,
            rate: share.rate || null,
            value: m.expected || null,
            paid: m.paid || null,
            balance: m.expected > 0 ? m.balance : null,
            status: '',
          },
        })
      }

      // Loaded but sold to nobody yet. Written because without it the shares
      // do not add up to the truck above them.
      if (r.split.unassigned > 0) {
        rows.push({
          kind: 'share',
          balance: 0,
          priced: false,
          values: {
            sn: '', batch: '', product: '', depot: '', date: null, truck: '', driver: '',
            customer: '   ↳ UNASSIGNED',
            destination: '—',
            quantity: r.split.unassigned,
            rate: null, value: null, paid: null, balance: null,
            status: '',
          },
        })
      }
    }
  })

  return rows
}

// ══════════════════════════════════════════════════════════════════════════
// Excel
// ══════════════════════════════════════════════════════════════════════════

/** Outstanding red, settled or overpaid green. Nothing else is coloured. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paintBalance(cell: any, value: number, priced: boolean) {
  if (!priced) return
  cell.font = { ...(cell.font || {}), color: { argb: value > 0 ? XL.loss : XL.gain } }
}

interface SummaryCell { header: string; value: number; fmt: string; alarm?: boolean; good?: boolean }

/** The band of headline figures under the title. */
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
    ['BOLD ROW = BATCH TOTAL', XL.ink],
    ['INDENTED ↳ = ONE CUSTOMER ON A SPLIT LOAD', XL.inkSoft],
    ['RED FIGURE = STILL OWING', XL.loss],
    ['GREEN = SETTLED OR OVERPAID', XL.gain],
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

export async function exportDeliveryInventoryExcel(
  batches: ExportBatch[],
  filters: DeliveryInventoryFilters,
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const totals = computeTotals(batches)
  const QTY_FMT = quantityFormat(batches)
  const fmtOf = (key: string) => {
    const c = COLUMNS.find((x) => x.key === key)
    return c?.fmt === 'QTY' ? QTY_FMT : c?.fmt
  }

  const ws = wb.addWorksheet('Delivery Inventory', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — DELIVERY INVENTORY',
    subtitle: subtitleOf(filters, `${totals.batches} batches · ${totals.trucks} trucks`),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  cursor = writeSummaryBand(ws, cursor, [
    { header: 'Batches', value: totals.batches, fmt: COUNT },
    { header: 'Trucks', value: totals.trucks, fmt: COUNT },
    { header: 'Volume', value: totals.quantity, fmt: QTY_FMT },
    { header: 'Unsold', value: totals.unsold, fmt: COUNT, alarm: true },
    { header: 'Unsold Volume', value: totals.unsoldQty, fmt: QTY_FMT },
    { header: 'Sold', value: totals.sold, fmt: COUNT, good: true },
    { header: 'Value', value: totals.value, fmt: NGN },
    { header: 'Paid', value: totals.paid, fmt: NGN, good: true },
    { header: 'Outstanding', value: totals.outstanding, fmt: NGN, alarm: true },
    { header: 'Overpaid', value: totals.overpaid, fmt: NGN },
  ])
  cursor = writeLegend(ws, cursor + 1)
  cursor += 2

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

  let band = false
  for (const row of buildRows(batches)) {
    // Banding follows the BATCH, not the row: a batch and its trucks share
    // one tint, so the block a reader is inside is never in doubt.
    if (row.kind === 'batch') band = !band

    const r = ws.getRow(cursor)
    for (const c of COLUMNS) {
      const v = row.values[c.key]
      if (v !== null && v !== undefined && v !== '') r.getCell(c.key).value = v as never
    }
    r.height = ROW_HEIGHT.body

    for (const c of COLUMNS) {
      const cell = r.getCell(c.key)
      cell.border = ALL_BORDERS
      const fmt = fmtOf(c.key)
      if (fmt) cell.numFmt = fmt
      if (row.kind === 'batch') cell.fill = SUMMARY_FILL
      else if (row.kind === 'share') cell.fill = SUBROW_FILL
      else if (band) cell.fill = BAND_FILL
      if (row.kind === 'batch') cell.font = TOTAL_FONT
    }
    if (r.getCell('date').value) r.getCell('date').numFmt = DATE_FMT
    paintBalance(r.getCell('balance'), row.balance, row.priced)
    if (row.kind === 'truck') r.getCell('truck').font = { bold: true }
    cursor++
  }

  // Freeze everything above the table, and let the header filter the body.
  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: COLUMNS.length },
  }

  const totalRow = ws.getRow(cursor)
  totalRow.getCell('batch').value = `TOTAL — ${totals.batches} batches`
  totalRow.getCell('truck').value = `${totals.trucks} trucks`
  totalRow.getCell('quantity').value = totals.quantity
  totalRow.getCell('value').value = totals.value
  totalRow.getCell('paid').value = totals.paid
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
    const fmt = fmtOf(c.key)
    if (fmt) totalRow.getCell(c.key).numFmt = fmt
  }
  paintBalance(totalRow.getCell('balance'), totals.outstanding - totals.overpaid, totals.value > 0)

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${buildFilename(filters)}.xlsx`,
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════════════════════════════

export async function exportDeliveryInventoryPdf(
  batches: ExportBatch[],
  filters: DeliveryInventoryFilters,
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  const totals = computeTotals(batches)
  const startY = drawPdfHeader(
    doc,
    'Soroman — Delivery Inventory',
    subtitleOf(filters, `${totals.batches} batches · ${totals.trucks} trucks`),
  )

  const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

  autoTable(doc, {
    startY,
    head: [['Batches', 'Trucks', 'Volume', 'Unsold', 'Sold', 'Value', 'Paid', 'Outstanding', 'Overpaid']],
    body: [[
      String(totals.batches), String(totals.trucks), qty(totals.quantity),
      `${totals.unsold} · ${qty(totals.unsoldQty)}`,
      `${totals.sold} · ${qty(totals.soldQty)}`,
      pdfNaira(totals.value), pdfNaira(totals.paid),
      pdfNaira(totals.outstanding), pdfNaira(totals.overpaid),
    ]],
    styles: pdfStyles.body,
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen },
    bodyStyles: pdfStyles.summaryBody,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (data.column.index === 6) data.cell.styles.textColor = PDF.gain
      if (data.column.index === 7 && totals.outstanding > 0) data.cell.styles.textColor = PDF.loss
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cursorY = (doc as any).lastAutoTable.finalY + 6

  const rows = buildRows(batches)
  const body = rows.map((row) =>
    COLUMNS.map((c) => {
      const v = row.values[c.key]
      if (v === null || v === undefined || v === '') return ''
      if (v instanceof Date) return format(v, DATE_PATTERN)
      if (typeof v === 'number') {
        if (c.key === 'quantity') return qty(v)
        return pdfNaira(v)
      }
      return v
    }),
  )

  const footRow = new Array(COLUMNS.length).fill('')
  const at = (key: string, value: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === key)
    if (idx >= 0) footRow[idx] = value
  }
  at('batch', `TOTAL (${totals.batches})`)
  at('truck', `${totals.trucks} trucks`)
  at('quantity', qty(totals.quantity))
  at('value', pdfNaira(totals.value))
  at('paid', pdfNaira(totals.paid))
  at('balance', pdfNaira(totals.outstanding - totals.overpaid))

  const balanceIndex = COLUMNS.findIndex((c) => c.key === 'balance')
  const statusIndex = COLUMNS.findIndex((c) => c.key === 'status')

  autoTable(doc, {
    startY: cursorY,
    head: [COLUMNS.map((c) => c.header)],
    body,
    foot: [footRow],
    styles: pdfStyles.body,
    headStyles: pdfStyles.head,
    footStyles: pdfStyles.foot,
    columnStyles: Object.fromEntries(
      COLUMNS.map((c, i) => [i, {
        halign: ['quantity', 'rate', 'value', 'paid', 'balance', 'sn'].includes(c.key)
          ? 'right' as const
          : 'left' as const,
      }]),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const row = rows[data.row.index]
      if (!row) return
      // The batch row is the one a reader scans for; everything under it is
      // detail. Weight and tint say so before any of the figures are read.
      if (row.kind === 'batch') {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = PDF.summaryTint
      } else if (row.kind === 'share') {
        data.cell.styles.textColor = PDF.inkSoft
      }
      if (data.column.index === balanceIndex && row.priced) {
        data.cell.styles.textColor = row.balance > 0 ? PDF.loss : PDF.gain
      }
      if (data.column.index === statusIndex && row.kind === 'truck') {
        data.cell.styles.textColor = data.cell.text[0] === 'SOLD' ? PDF.gain : PDF.inkSoft
      }
    },
  })

  drawPdfFooters(doc, 'Soroman delivery inventory — batches, their trucks, and the money on them')
  doc.save(`${buildFilename(filters)}.pdf`)
}
