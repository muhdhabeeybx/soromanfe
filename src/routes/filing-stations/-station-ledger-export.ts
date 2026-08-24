import { format, parseISO } from 'date-fns'
import type { DeliverySale } from '#/lib/types'
import { toNum } from '#/lib/sales-ledger-utils'
import { resolveBankAccount } from '#/lib/bank-accounts'
import type { BankAccount } from '#/lib/types'
import {
  bankCharges,
  depositChannelLabel,
  hasBothChannels,
  sumByChannel,
} from '#/lib/deposit-channel'
import {
  XL, PDF, NGN, NGN_SIGNED, QTY, COUNT, DATE_FMT, DATE_PATTERN,
  ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUBROW_FILL, BAND_FILL,
  TOTAL_FILL, GRAND_TOTAL_FILL, SUMMARY_FILL,
  HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, writeSectionHeading, paintSigned,
  pdfStyles, drawPdfHeader, drawPdfFooters, pdfNaira, triggerDownload,
} from '#/lib/report-theme'

/**
 * The filling-station ledger, exported.
 *
 * ── Why this replaces the old CSV ─────────────────────────────────────────
 *
 * The previous export wrote one line per truck cycle with a single
 * `Deposited` column holding the SUM of every remittance on that cycle. Five
 * separate deposits — different days, different banks, different depositors,
 * some POS and some cash — came out as one number, and nothing in the file
 * could take you back to the individual entries. That is what "it merges
 * entries of deposit even though they're separate entries" means, and it is
 * the whole reason this file exists.
 *
 * Now each cycle is a header row and every remittance on it is its own
 * indented row underneath, carrying its own date, channel, bank account,
 * depositor and amount. The cycle row still totals them, so nothing is lost
 * — the total is just no longer the only thing there.
 */

interface StationLedgerGroup {
  key: string
  stationName: string
  truckNumber: string
  cycleNum?: number
  code: string
  dateLoaded: string
  quantity: number
  totalQtySold: number
  rate: number
  expected: number
  totalPaid: number
  totalExpenses: number
  balance: number
  location: string
  depot: string
  payments: DeliverySale[]
}

export interface StationLedgerFilters {
  periodLabel: string
  stationName: string
  search: string
}

/** Order rows carry cycle facts; remittance rows carry one payment each. */
type RowScope = 'cycle' | 'remittance'

const COLUMNS: Array<{
  header: string
  key: string
  width: number
  fmt?: string
  scope: RowScope
  /** Green/red on sign. Reserved for figures where the sign carries meaning. */
  signed?: boolean
}> = [
  { header: 'S/N', key: 'sn', width: 6, scope: 'cycle' },
  { header: 'Station', key: 'station', width: 26, scope: 'cycle' },
  { header: 'Truck', key: 'truck', width: 14, scope: 'cycle' },
  { header: 'Cycle', key: 'cycle', width: 9, scope: 'cycle' },
  { header: 'Allocation Code', key: 'code', width: 16, scope: 'cycle' },
  { header: 'Date Loaded', key: 'dateLoaded', width: 13, scope: 'cycle' },
  { header: 'Qty Allocated', key: 'qtyAllocated', width: 14, fmt: QTY, scope: 'cycle' },
  { header: 'Qty Sold', key: 'qtySold', width: 13, fmt: QTY, scope: 'cycle' },
  { header: 'Rate', key: 'rate', width: 12, fmt: NGN, scope: 'cycle' },
  { header: 'Expected', key: 'expected', width: 16, fmt: NGN, scope: 'cycle' },
  // ── the remittance side ──
  { header: 'Date Paid', key: 'datePaid', width: 13, scope: 'remittance' },
  { header: 'Type', key: 'channel', width: 15, scope: 'remittance' },
  { header: 'Bank Account', key: 'bank', width: 34, scope: 'remittance' },
  { header: 'Depositor', key: 'depositor', width: 22, scope: 'remittance' },
  { header: 'Status', key: 'status', width: 11, scope: 'remittance' },
  { header: 'Amount', key: 'amount', width: 16, fmt: NGN, scope: 'remittance' },
  // ── back to cycle totals ──
  { header: 'POS Total', key: 'posTotal', width: 15, fmt: NGN, scope: 'cycle' },
  { header: 'Deposit Total', key: 'depositTotal', width: 15, fmt: NGN, scope: 'cycle' },
  { header: 'Bank Charges', key: 'charges', width: 15, fmt: NGN_SIGNED, scope: 'cycle', signed: true },
  { header: 'Total Remitted', key: 'totalPaid', width: 16, fmt: NGN, scope: 'cycle' },
  { header: 'Expenses', key: 'expenses', width: 14, fmt: NGN, scope: 'cycle' },
  { header: 'Balance', key: 'balance', width: 16, fmt: NGN_SIGNED, scope: 'cycle', signed: true },
  { header: 'Location', key: 'location', width: 18, scope: 'cycle' },
  { header: 'Depot', key: 'depot', width: 18, scope: 'cycle' },
]

const up = (v: string) => (v || '').toUpperCase()

function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  try {
    const d = parseISO(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/** The remittances on a cycle, oldest first — the order a ledger is read in. */
function remittancesOf(group: StationLedgerGroup): DeliverySale[] {
  return group.payments
    .filter((p) => toNum(p.paymentAmount) > 0)
    .sort((a, b) => {
      const ad = safeDate(a.dateOfPayment)?.getTime() ?? 0
      const bd = safeDate(b.dateOfPayment)?.getTime() ?? 0
      return ad - bd
    })
}

function cycleValues(group: StationLedgerGroup, index: number) {
  const totals = sumByChannel(group.payments)
  const charge = bankCharges(totals)
  return {
    sn: index + 1,
    station: up(group.stationName),
    truck: up(group.truckNumber),
    cycle: group.cycleNum ? `Cycle ${group.cycleNum}` : '—',
    code: up(group.code) || '—',
    dateLoaded: safeDate(group.dateLoaded),
    qtyAllocated: group.quantity,
    qtySold: group.totalQtySold,
    rate: group.rate,
    expected: group.expected,
    posTotal: totals.pos,
    depositTotal: totals.bankDeposit,
    // Only written once both channels are present. A cycle with one side
    // entered has no charge yet, and writing 0 there would read as "no
    // charge" rather than "not yet known".
    charges: hasBothChannels(totals) ? charge : null,
    totalPaid: group.totalPaid,
    expenses: group.totalExpenses,
    balance: group.balance,
    location: up(group.location) || '—',
    depot: up(group.depot) || '—',
  }
}

function remittanceValues(entry: DeliverySale, accounts: BankAccount[]) {
  const account = resolveBankAccount(accounts, entry.bank)
  return {
    datePaid: safeDate(entry.dateOfPayment),
    channel: up(depositChannelLabel(entry.depositChannel)),
    // Resolves to the managed account's name when it can, and falls back to
    // whatever string the row recorded — which for older rows is all there is.
    bank: account
      ? up(`${account.accountNumber} · ${account.bankName} · ${account.accountName}`)
      : up(entry.bank) || '—',
    depositor: up(entry.payerName) || '—',
    status: entry.depositStatus === 'paid' ? 'CONFIRMED' : 'PENDING',
    amount: toNum(entry.paymentAmount),
  }
}

export interface StationLedgerTotals {
  cycles: number
  remittances: number
  expected: number
  pos: number
  bankDeposit: number
  charges: number
  totalPaid: number
  expenses: number
  balance: number
}

/**
 * Charges total across the whole report.
 *
 * Summed per cycle rather than as (all deposits − all POS): a cycle with only
 * one channel entered has no charge, and rolling its lone figure into a
 * report-wide subtraction would invent one. Same rule as the per-cycle cell.
 */
export function computeTotals(groups: StationLedgerGroup[]): StationLedgerTotals {
  const t: StationLedgerTotals = {
    cycles: groups.length, remittances: 0, expected: 0, pos: 0, bankDeposit: 0,
    charges: 0, totalPaid: 0, expenses: 0, balance: 0,
  }
  for (const g of groups) {
    const totals = sumByChannel(g.payments)
    t.remittances += remittancesOf(g).length
    t.expected += g.expected
    t.pos += totals.pos
    t.bankDeposit += totals.bankDeposit
    if (hasBothChannels(totals)) t.charges += bankCharges(totals)
    t.totalPaid += g.totalPaid
    t.expenses += g.totalExpenses
    t.balance += g.balance
  }
  return t
}

export function buildFilename(filters: StationLedgerFilters): string {
  const scope = filters.stationName && filters.stationName !== 'All stations'
    ? filters.stationName
    : 'ALL STATIONS'
  return `${scope} STATION LEDGER ${format(new Date(), 'dd-MM-yy')}`
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

function subtitleOf(filters: StationLedgerFilters, totals: StationLedgerTotals): string {
  const parts = [
    `Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    `Period: ${filters.periodLabel}`,
    `Station: ${filters.stationName}`,
    `${totals.cycles} cycles · ${totals.remittances} remittances`,
  ]
  if (filters.search) parts.push(`Search: "${filters.search}"`)
  return parts.join('   ·   ')
}

// ══════════════════════════════════════════════════════════════════════════
// Excel
// ══════════════════════════════════════════════════════════════════════════

export async function exportStationLedgerExcel(
  groups: StationLedgerGroup[],
  filters: StationLedgerFilters,
  accounts: BankAccount[],
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const ws = wb.addWorksheet('Station Ledger', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  // key + width only — a `header` here would auto-write row 1, and row 1
  // belongs to the title block.
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const totals = computeTotals(groups)
  let cursor = writeTitleBlock(ws, 1, {
    title: 'SOROMAN — FILLING STATION LEDGER',
    subtitle: subtitleOf(filters, totals),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  // ── Summary band ────────────────────────────────────────────────────
  const summaryCols: Array<{ header: string; value: number; fmt: string; signed?: boolean }> = [
    { header: 'Cycles', value: totals.cycles, fmt: COUNT },
    { header: 'Remittances', value: totals.remittances, fmt: COUNT },
    { header: 'Expected', value: totals.expected, fmt: NGN },
    { header: 'POS Transactions', value: totals.pos, fmt: NGN },
    { header: 'Bank Deposits', value: totals.bankDeposit, fmt: NGN },
    { header: 'Bank Charges', value: totals.charges, fmt: NGN_SIGNED, signed: true },
    { header: 'Total Remitted', value: totals.totalPaid, fmt: NGN },
    { header: 'Expenses', value: totals.expenses, fmt: NGN },
    { header: 'Balance', value: totals.balance, fmt: NGN_SIGNED, signed: true },
  ]

  // Widen only the columns the summary band actually occupies — "Bank
  // Deposits" is far wider than the 6-wide S/N column was tuned for.
  summaryCols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width || 10, c.header.length + 3)
  })

  const sumHead = ws.getRow(cursor)
  sumHead.values = summaryCols.map((c) => c.header)
  sumHead.height = ROW_HEIGHT.header
  sumHead.eachCell((cell) => {
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

  // ── The ledger itself ───────────────────────────────────────────────
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
    // Cycle columns only — the remittance columns stay empty on this row so
    // the eye reads straight down the payment list underneath it.
    // Assigned cell by cell rather than through row.values: the cycle
    // columns are not contiguous (the remittance block sits between Expected
    // and POS Total), and a keyed object literal loses ExcelJS's typing.
    for (const c of COLUMNS) {
      if (c.scope !== 'cycle') continue
      const v = (values as Record<string, unknown>)[c.key]
      if (v != null && v !== '') row.getCell(c.key).value = v as never
    }
    row.height = ROW_HEIGHT.body
    // Alternating bands on the cycle rows only; sub-rows carry their own
    // tint, and striping both would make the grouping unreadable.
    const band = i % 2 === 1
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (band) cell.fill = BAND_FILL
      if (c.fmt) cell.numFmt = c.fmt
      if (c.signed) {
        const v = (values as Record<string, unknown>)[c.key]
        if (typeof v === 'number') paintSigned(cell, v)
      }
    }
    row.getCell('station').font = { bold: true }
    if (row.getCell('dateLoaded').value) row.getCell('dateLoaded').numFmt = DATE_FMT
    cursor++

    for (const entry of remittancesOf(group)) {
      const rv = remittanceValues(entry, accounts)
      const sub = ws.getRow(cursor)
      sub.values = rv
      sub.height = ROW_HEIGHT.body
      for (const c of COLUMNS) {
        const cell = sub.getCell(c.key)
        cell.border = ALL_BORDERS
        cell.fill = SUBROW_FILL
        if (c.key === 'amount') cell.numFmt = NGN
      }
      if (sub.getCell('datePaid').value) sub.getCell('datePaid').numFmt = DATE_FMT
      // A pending deposit is money not yet confirmed in the bank — worth
      // seeing without hunting for it.
      if (rv.status === 'PENDING') {
        sub.getCell('status').font = { color: { argb: XL.warn }, bold: true }
      }
      cursor++
    }
  })

  ws.views = [{ state: 'frozen', ySplit: tableStart - 1 }]
  ws.autoFilter = {
    from: { row: tableStart - 1, column: 1 },
    to: { row: tableStart - 1, column: COLUMNS.length },
  }

  // ── Grand total ─────────────────────────────────────────────────────
  const totalRow = ws.getRow(cursor)
  totalRow.values = {
    station: `TOTAL — ${totals.cycles} cycles, ${totals.remittances} remittances`,
    expected: totals.expected,
    amount: totals.totalPaid,
    posTotal: totals.pos,
    depositTotal: totals.bankDeposit,
    charges: totals.charges,
    totalPaid: totals.totalPaid,
    expenses: totals.expenses,
    balance: totals.balance,
  }
  totalRow.height = ROW_HEIGHT.total
  // Walked by position, not eachCell: eachCell skips columns this row never
  // set, which leaves the shaded bar stopping partway across the sheet.
  for (let i = 1; i <= COLUMNS.length; i++) {
    const cell = totalRow.getCell(i)
    cell.border = TOTAL_BORDERS
    cell.fill = GRAND_TOTAL_FILL
    cell.font = TOTAL_FONT
  }
  for (const c of COLUMNS) {
    if (c.fmt) totalRow.getCell(c.key).numFmt = c.fmt
  }
  totalRow.getCell('amount').numFmt = NGN
  paintSigned(totalRow.getCell('charges'), totals.charges)
  paintSigned(totalRow.getCell('balance'), totals.balance)
  cursor += 3

  // ── Channel reconciliation ──────────────────────────────────────────
  cursor = writeSectionHeading(ws, cursor, 'REMITTANCE CHANNEL RECONCILIATION')
  cursor++

  const reconRows: Array<[string, number | string, string]> = [
    ['POS Transactions', totals.pos, 'Card payments taken at the pump'],
    ['Bank Deposits', totals.bankDeposit, 'Cash paid in over the counter'],
    ['Bank Charges (Deposit − POS)', totals.charges, 'Only counted on cycles where both sides were entered'],
    ['Total Remitted', totals.totalPaid, 'Includes remittances recorded before the channel split'],
  ]
  const reconHead = ws.getRow(cursor)
  reconHead.values = ['Channel', 'Amount', 'Note']
  reconHead.height = ROW_HEIGHT.header
  for (let i = 1; i <= 3; i++) {
    const cell = reconHead.getCell(i)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle' }
  }
  cursor++

  for (const [label, value, note] of reconRows) {
    const r = ws.getRow(cursor)
    r.values = [label, value, note]
    r.height = ROW_HEIGHT.body
    for (let i = 1; i <= 3; i++) {
      r.getCell(i).border = ALL_BORDERS
    }
    const amountCell = r.getCell(2)
    if (typeof value === 'number') {
      const signed = label.startsWith('Bank Charges')
      amountCell.numFmt = signed ? NGN_SIGNED : NGN
      if (signed) paintSigned(amountCell, value)
    }
    r.getCell(3).font = { size: 9, color: { argb: XL.inkSoft } }
    if (label === 'Total Remitted') {
      for (let i = 1; i <= 3; i++) {
        r.getCell(i).fill = TOTAL_FILL
        r.getCell(i).font = i === 3 ? { size: 9, color: { argb: XL.inkSoft } } : TOTAL_FONT
      }
    }
    cursor++
  }

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

export async function exportStationLedgerPdf(
  groups: StationLedgerGroup[],
  filters: StationLedgerFilters,
  accounts: BankAccount[],
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape' })
  const totals = computeTotals(groups)
  const startY = drawPdfHeader(
    doc,
    'Soroman — Filling Station Ledger',
    subtitleOf(filters, totals),
  )

  const summaryHead = [
    'Cycles', 'Remittances', 'Expected', 'POS', 'Bank Deposits',
    'Bank Charges', 'Total Remitted', 'Expenses', 'Balance',
  ]
  const summaryBody = [
    String(totals.cycles), String(totals.remittances), pdfNaira(totals.expected),
    pdfNaira(totals.pos), pdfNaira(totals.bankDeposit), pdfNaira(totals.charges),
    pdfNaira(totals.totalPaid), pdfNaira(totals.expenses), pdfNaira(totals.balance),
  ]

  autoTable(doc, {
    startY,
    head: [summaryHead],
    body: [summaryBody],
    styles: pdfStyles.body,
    headStyles: { ...pdfStyles.head, fillColor: PDF.brandGreen },
    bodyStyles: pdfStyles.summaryBody,
    // The two signed figures carry their meaning in colour here as well as
    // in parentheses, matching the workbook.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      const signedColumns = [5, 8]
      if (!signedColumns.includes(data.column.index)) return
      const negative = String(data.cell.raw).trim().startsWith('(')
      data.cell.styles.textColor = negative ? PDF.loss : PDF.gain
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cursorY = (doc as any).lastAutoTable.finalY + 6

  // Row layout walks COLUMNS and asks each whether this row kind fills it,
  // so a column can move or change scope without index arithmetic here.
  const cellsFor = (scope: RowScope, values: Record<string, string | number>) =>
    COLUMNS.map((c) => (c.scope === scope ? (values[c.key] ?? '') : ''))

  const body: (string | number)[][] = []
  groups.forEach((group, i) => {
    const v = cycleValues(group, i)
    body.push(
      cellsFor('cycle', {
        sn: v.sn,
        station: v.station,
        truck: v.truck,
        cycle: v.cycle,
        code: v.code,
        dateLoaded: v.dateLoaded ? format(v.dateLoaded, DATE_PATTERN) : '—',
        qtyAllocated: `${v.qtyAllocated.toLocaleString()} L`,
        qtySold: `${v.qtySold.toLocaleString()} L`,
        rate: pdfNaira(v.rate),
        expected: pdfNaira(v.expected),
        posTotal: pdfNaira(v.posTotal),
        depositTotal: pdfNaira(v.depositTotal),
        charges: v.charges == null ? '—' : pdfNaira(v.charges),
        totalPaid: pdfNaira(v.totalPaid),
        expenses: pdfNaira(v.expenses),
        balance: pdfNaira(v.balance),
        location: v.location,
        depot: v.depot,
      }),
    )

    for (const entry of remittancesOf(group)) {
      const rv = remittanceValues(entry, accounts)
      body.push(
        cellsFor('remittance', {
          datePaid: rv.datePaid ? format(rv.datePaid, DATE_PATTERN) : '—',
          channel: rv.channel,
          bank: rv.bank,
          depositor: rv.depositor,
          status: rv.status,
          amount: pdfNaira(rv.amount),
        }),
      )
    }
  })

  const footRow = new Array(COLUMNS.length).fill('')
  const footAt = (key: string, value: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === key)
    if (idx >= 0) footRow[idx] = value
  }
  footAt('station', `TOTAL (${totals.cycles} cycles)`)
  footAt('expected', pdfNaira(totals.expected))
  footAt('posTotal', pdfNaira(totals.pos))
  footAt('depositTotal', pdfNaira(totals.bankDeposit))
  footAt('charges', pdfNaira(totals.charges))
  footAt('totalPaid', pdfNaira(totals.totalPaid))
  footAt('expenses', pdfNaira(totals.expenses))
  footAt('balance', pdfNaira(totals.balance))

  const snIndex = COLUMNS.findIndex((c) => c.key === 'sn')
  const chargesIndex = COLUMNS.findIndex((c) => c.key === 'charges')
  const balanceIndex = COLUMNS.findIndex((c) => c.key === 'balance')
  const statusIndex = COLUMNS.findIndex((c) => c.key === 'status')

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

      // A remittance row is the one whose S/N cell is blank. Plain
      // alternating striping would be meaningless here, since whether a row
      // is a cycle or one of its payments depends on what came before it.
      const isRemittance = data.section === 'body' && raw[snIndex] === ''
      if (isRemittance) {
        data.cell.styles.fillColor = PDF.subRowTint
        if (data.column.index === statusIndex && String(data.cell.raw) === 'PENDING') {
          data.cell.styles.textColor = [154, 103, 0]
          data.cell.styles.fontStyle = 'bold'
        }
        return
      }

      if (data.section === 'body' && data.column.index === 1) {
        data.cell.styles.fontStyle = 'bold'
      }

      // Signed money: green for a gain, red for a shortfall, in the body and
      // in the totals bar alike.
      if (data.column.index === chargesIndex || data.column.index === balanceIndex) {
        const text = String(data.cell.raw).trim()
        if (text && text !== '—') {
          data.cell.styles.textColor = text.startsWith('(') ? PDF.loss : PDF.gain
        }
      }
    },
  })

  drawPdfFooters(doc, `Soroman Filling Station Ledger · ${filters.periodLabel}`)
  doc.save(`${buildFilename(filters)}.pdf`)
}
