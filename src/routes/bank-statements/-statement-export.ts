import { format } from 'date-fns'
import { formatPlainDay } from '#/lib/bank-statement-parser'
import type { AccountStatementLine, StatementAccountSummary } from '#/lib/hooks/useBankStatements'

/**
 * A bank statement off the screen and into somebody's hands.
 *
 * ── The columns are grouped by the question they answer ────────────────────
 *
 * A statement line carries three unrelated kinds of fact, and they were
 * interleaved: the source file sat beside the customer, the deposit reference
 * between the order and who matched it. So the sheet is banded —
 *
 *   THE CREDIT     what the bank says happened: date, amount, payer, reference
 *   MATCHED TO     what became of it: status, order, customer, who and when
 *   IMPORTED       how it got here: who uploaded it and when
 *
 * — and a band header sits above the column headers, so one glance answers
 * "where do I look for the order" without reading eleven headings.
 *
 * ── What was dropped ───────────────────────────────────────────────────────
 *
 * Deposit reference was the bank reference again, verbatim, in a second
 * column. Narration is the depositor line with more of the same text after
 * it. Source file belongs to the upload rather than to the credit, and the
 * screen still carries it. Eleven columns instead of fourteen, none a copy.
 *
 * ── Real numbers, with a cell format ───────────────────────────────────────
 *
 * Amounts go in as numbers with a currency format, as everywhere else in this
 * app. The first thing done with a statement export is to total a column, and
 * a column of text cannot be totalled. The totals row is a real SUM for the
 * same reason: it survives the rows being sorted or filtered.
 *
 * ── Dates split into what they are ─────────────────────────────────────────
 *
 * The transaction date is a calendar day and is written as one. The upload and
 * match timestamps are instants and keep their time — "when was this matched"
 * is a question about an afternoon, not a date.
 */

const NGN = '₦#,##0.00;[Red]-₦#,##0.00'
const DAY = 'dd mmm yyyy'
const STAMP = 'dd mmm yyyy, hh:mm'

/** One palette, so the sheet reads as a single document. */
const INK = 'FF1F2933'
const MUTED = 'FF6B7280'
const RULE = 'FFD9DEE5'
const NAVY = 'FF1F3864'
const BAND = 'FFE8EDF5'
const ZEBRA = 'FFF7F8FA'
const GREEN_INK = 'FF0B6E4F'
const GREEN_FILL = 'FFE8F5EE'
const AMBER_INK = 'FF8A5A00'
const AMBER_FILL = 'FFFDF3E2'
const RED_INK = 'FF9B1C1C'

const solid = (argb: string) =>
  ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

const hairline = (argb = RULE) => ({
  top: { style: 'thin' as const, color: { argb } },
  left: { style: 'thin' as const, color: { argb } },
  bottom: { style: 'thin' as const, color: { argb } },
  right: { style: 'thin' as const, color: { argb } },
})

/** A filename that survives being emailed around. */
const slug = (s: string) =>
  s.trim().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'statement'

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** A plain day string as a Date at noon — never a day out however it is read. */
const asDay = (d: string | null | undefined) => {
  if (!d) return null
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return null
  return new Date(y, m - 1, day, 12)
}

const asStamp = (s: string | null | undefined) => (s ? new Date(s) : null)

type Column = {
  label: string
  width: number
  value: (l: AccountStatementLine) => string | number | Date | null
  fmt?: string
  align?: 'left' | 'right' | 'center'
}

/** The three bands, in the order a credit is actually read. */
const GROUPS: { label: string; columns: Column[] }[] = [
  {
    label: 'The credit',
    columns: [
      { label: 'Date', width: 14, fmt: DAY, value: (l) => asDay(l.txn_date) },
      { label: 'Amount', width: 20, fmt: NGN, align: 'right', value: (l) => Number(l.amount) },
      { label: 'Depositor', width: 38, value: (l) => l.depositor || null },
      { label: 'Bank reference', width: 22, value: (l) => l.bank_ref || null },
    ],
  },
  {
    label: 'Matched to',
    columns: [
      {
        label: 'Status', width: 13, align: 'center',
        value: (l) => (l.status === 'MATCHED' ? 'Matched' : 'Unmatched'),
      },
      {
        label: 'Order', width: 14,
        // A matched line whose order has since been deleted is a real state,
        // and a blank cell would hide it. See the repository note on PU11486.
        value: (l) => l.order_reference || (l.status === 'MATCHED' ? 'Order deleted' : null),
      },
      { label: 'Customer', width: 32, value: (l) => l.customer_name || null },
      { label: 'Matched by', width: 22, value: (l) => l.matched_by_name || null },
      { label: 'Matched on', width: 21, fmt: STAMP, value: (l) => asStamp(l.matched_at) },
    ],
  },
  {
    label: 'Imported',
    columns: [
      { label: 'Uploaded by', width: 22, value: (l) => l.uploaded_by_name || null },
      { label: 'Uploaded on', width: 21, fmt: STAMP, value: (l) => asStamp(l.uploaded_at) },
    ],
  },
]

const COLUMNS = GROUPS.flatMap((g) => g.columns)
const AMOUNT_COL = 2
const ORDER_COL = 6
const STATUS_COL = 5
const HEADER_ROW = 8
const FIRST_DATA_ROW = HEADER_ROW + 1

export async function exportStatementLines({
  account, lines, from, to, day, status,
}: {
  account: Pick<StatementAccountSummary, 'bank_name' | 'account_name' | 'account_number'>
  lines: AccountStatementLine[]
  from?: string
  to?: string
  day?: string
  status?: string
}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman'
  wb.created = new Date()

  const ws = wb.addWorksheet('Statement', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
  })
  const lastCol = COLUMNS.length

  const total = lines.reduce((s, l) => s + Number(l.amount), 0)
  const matched = lines.filter((l) => l.status === 'MATCHED')
  const matchedTotal = matched.reduce((s, l) => s + Number(l.amount), 0)
  const days = [...new Set(lines.map((l) => String(l.txn_date).slice(0, 10)))].sort()

  // ── Title ───────────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, lastCol)
  const title = ws.getCell(1, 1)
  title.value = account.account_name.toUpperCase()
  title.font = { bold: true, size: 16, color: { argb: INK } }
  ws.getRow(1).height = 24

  ws.mergeCells(2, 1, 2, lastCol)
  const sub = ws.getCell(2, 1)
  sub.value = `${account.bank_name.toUpperCase()}  ·  ${account.account_number}`
  sub.font = { size: 11, color: { argb: MUTED } }

  /*
    ── The summary is a table now ────────────────────────────────────────

    It was one concatenated sentence: period, row count and three amounts run
    together with middots. Nothing in it could be read at a glance or copied
    out on its own, which is most of what a summary is for. Each figure gets a
    labelled cell of its own instead.
  */
  const period = day
    ? formatPlainDay(day)
    : from || to
      ? `${from ? formatPlainDay(from) : 'the beginning'} – ${to ? formatPlainDay(to) : 'today'}`
      : days.length
        ? `${formatPlainDay(days[0])} – ${formatPlainDay(days[days.length - 1])}`
        : 'all dates'

  const summary: { label: string; value: string | number; fmt?: string; ink?: string }[] = [
    { label: 'Payments', value: lines.length },
    { label: 'Total credited', value: total, fmt: NGN },
    { label: 'Matched', value: matchedTotal, fmt: NGN, ink: GREEN_INK },
    { label: 'Unmatched', value: total - matchedTotal, fmt: NGN, ink: AMBER_INK },
    { label: 'Matched / unmatched', value: `${matched.length} / ${lines.length - matched.length}` },
    { label: 'Days covered', value: days.length },
    { label: 'Period', value: period },
    { label: 'Exported', value: format(new Date(), 'd MMM yyyy, HH:mm') },
  ]

  summary.forEach((f, i) => {
    const col = i + 1
    const label = ws.getCell(4, col)
    label.value = f.label.toUpperCase()
    label.font = { bold: true, size: 8, color: { argb: MUTED } }
    label.fill = solid(BAND)
    label.border = hairline()
    label.alignment = { vertical: 'middle' }

    const cell = ws.getCell(5, col)
    cell.value = f.value
    if (f.fmt) cell.numFmt = f.fmt
    cell.font = { bold: true, size: 11, color: { argb: f.ink || INK } }
    cell.border = hairline()
    cell.alignment = { vertical: 'middle' }
  })
  ws.getRow(4).height = 16
  ws.getRow(5).height = 20

  // A filter is stated only when there is one, so its absence is not a claim —
  // and stated loudly, because a partial statement that looks whole is the
  // worst thing this file can be.
  if (status) {
    ws.mergeCells(6, 1, 6, lastCol)
    const note = ws.getCell(6, 1)
    note.value = `Filtered to ${status.toLowerCase()} payments only — this is not the whole statement.`
    note.font = { italic: true, bold: true, size: 9, color: { argb: AMBER_INK } }
    note.fill = solid(AMBER_FILL)
  }

  // ── Band headers, above the column headers ──────────────────────────────
  let at = 1
  for (const g of GROUPS) {
    const start = at
    const end = at + g.columns.length - 1
    ws.mergeCells(7, start, 7, end)
    const cell = ws.getCell(7, start)
    cell.value = g.label.toUpperCase()
    cell.font = { bold: true, size: 9, color: { argb: NAVY } }
    cell.fill = solid(BAND)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = hairline(NAVY)
    at = end + 1
  }
  ws.getRow(7).height = 18

  const header = ws.getRow(HEADER_ROW)
  header.values = COLUMNS.map((c) => c.label)
  header.height = 20
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = solid(NAVY)
    cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' }
    cell.border = hairline(NAVY)
  })

  // ── The rows ────────────────────────────────────────────────────────────
  let cursor = FIRST_DATA_ROW
  for (const l of lines) {
    const row = ws.getRow(cursor)
    row.values = COLUMNS.map((c) => c.value(l))
    const isMatched = l.status === 'MATCHED'
    const zebra = (cursor - FIRST_DATA_ROW) % 2 === 1

    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.fmt) cell.numFmt = c.fmt
      cell.border = hairline()
      cell.alignment = { horizontal: c.align || 'left', vertical: 'top', wrapText: c.width > 30 }
      cell.font = { size: 10, color: { argb: INK } }
      // Unmatched money is what somebody is hunting for, so the whole row
      // carries it rather than one cell.
      if (!isMatched) cell.fill = solid(AMBER_FILL)
      else if (zebra) cell.fill = solid(ZEBRA)
    })

    // The amount is the figure the sheet exists for.
    const amount = row.getCell(AMOUNT_COL)
    amount.font = { bold: true, size: 11, color: { argb: GREEN_INK } }
    if (isMatched) amount.fill = solid(GREEN_FILL)

    const statusCell = row.getCell(STATUS_COL)
    statusCell.font = { bold: true, size: 10, color: { argb: isMatched ? GREEN_INK : AMBER_INK } }

    // "Order deleted" is a finding, not a reference — it should not read like
    // one sitting in a column of order numbers.
    if (isMatched && !l.order_reference) {
      row.getCell(ORDER_COL).font = { bold: true, size: 10, color: { argb: RED_INK } }
    }
    cursor++
  }

  // ── Totals ──────────────────────────────────────────────────────────────
  if (lines.length > 0) {
    const totals = ws.getRow(cursor)
    totals.height = 20
    for (let i = 1; i <= lastCol; i++) {
      const cell = totals.getCell(i)
      cell.fill = solid(BAND)
      cell.border = { ...hairline(), top: { style: 'medium', color: { argb: NAVY } } }
      cell.font = { bold: true, size: 11, color: { argb: INK } }
      cell.alignment = { vertical: 'middle' }
    }
    totals.getCell(1).value = `${lines.length} payment${lines.length === 1 ? '' : 's'}`

    const amountCell = totals.getCell(AMOUNT_COL)
    amountCell.value = { formula: `SUM(B${FIRST_DATA_ROW}:B${cursor - 1})`, result: total }
    amountCell.numFmt = NGN
    amountCell.font = { bold: true, size: 12, color: { argb: GREEN_INK } }
    amountCell.alignment = { horizontal: 'right', vertical: 'middle' }

    const statusTotal = totals.getCell(STATUS_COL)
    statusTotal.value = `${matched.length} matched`
    statusTotal.alignment = { horizontal: 'center', vertical: 'middle' }
    statusTotal.font = { bold: true, size: 10, color: { argb: GREEN_INK } }
  }

  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } }

  const stamp = day || [from, to].filter(Boolean).join('_') || 'all'
  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(
    buffer as ArrayBuffer,
    `${slug(account.account_name)}_${slug(account.account_number)}_${stamp}.xlsx`,
  )
}
