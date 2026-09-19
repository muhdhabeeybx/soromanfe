import { format } from 'date-fns'
import { formatPlainDay } from '#/lib/bank-statement-parser'
import type { AccountStatementLine, StatementAccountSummary } from '#/lib/hooks/useBankStatements'

/**
 * A bank statement off the screen and into somebody's hands.
 *
 * ── Every column, not the ones the table has room for ──────────────────────
 *
 * The screen has to choose what fits; a file does not. So the export carries
 * the whole trace of every line — the file it arrived in, who imported it,
 * when, the order that claimed it, who claimed it and when — because the
 * reason anybody exports a bank statement is to answer a question the screen
 * could not, usually to somebody outside the system.
 *
 * ── Real numbers, with a cell format ───────────────────────────────────────
 *
 * Amounts go in as numbers with a currency format, as everywhere else in this
 * app. The first thing done with a statement export is to total a column, and
 * a column of text cannot be totalled.
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
}

const COLUMNS: Column[] = [
  { label: 'Date', width: 14, fmt: DAY, value: (l) => asDay(l.txn_date) },
  { label: 'Amount', width: 18, fmt: NGN, value: (l) => Number(l.amount) },
  { label: 'Depositor', width: 34, value: (l) => l.depositor || null },
  { label: 'Bank reference', width: 24, value: (l) => l.bank_ref || null },
  { label: 'Narration', width: 44, value: (l) => l.narration || null },
  { label: 'Status', width: 12, value: (l) => (l.status === 'MATCHED' ? 'Matched' : 'Unmatched') },
  {
    label: 'Order',
    width: 14,
    // A matched line whose order has since been deleted is a real state, and
    // a blank cell would hide it. See the repository note on PU11486.
    value: (l) =>
      l.order_reference || (l.status === 'MATCHED' ? 'Order deleted' : null),
  },
  { label: 'Customer', width: 30, value: (l) => l.customer_name || null },
  { label: 'Deposit reference', width: 22, value: (l) => l.deposit_reference || null },
  { label: 'Matched by', width: 22, value: (l) => l.matched_by_name || null },
  { label: 'Matched on', width: 20, fmt: STAMP, value: (l) => asStamp(l.matched_at) },
  { label: 'Source file', width: 34, value: (l) => l.filename || null },
  { label: 'Uploaded on', width: 20, fmt: STAMP, value: (l) => asStamp(l.uploaded_at) },
  { label: 'Uploaded by', width: 22, value: (l) => l.uploaded_by_name || null },
]

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

  const ws = wb.addWorksheet('Statement')
  const lastCol = COLUMNS.length

  const period = day
    ? formatPlainDay(day)
    : from || to
      ? `${from ? formatPlainDay(from) : 'the beginning'} – ${to ? formatPlainDay(to) : 'today'}`
      : 'all dates'

  ws.mergeCells(1, 1, 1, lastCol)
  const title = ws.getCell(1, 1)
  title.value = `${account.bank_name} — ${account.account_name} · ${account.account_number}`
  title.font = { bold: true, size: 13 }

  const total = lines.reduce((s, l) => s + Number(l.amount), 0)
  const matched = lines.filter((l) => l.status === 'MATCHED')
  const matchedTotal = matched.reduce((s, l) => s + Number(l.amount), 0)

  ws.mergeCells(2, 1, 2, lastCol)
  const meta = ws.getCell(2, 1)
  // The totals go in the header so the file answers the headline question
  // without anybody having to select a column first.
  meta.value = [
    period,
    `${lines.length} row${lines.length === 1 ? '' : 's'}`,
    `Total ₦${total.toLocaleString()}`,
    `Matched ₦${matchedTotal.toLocaleString()} (${matched.length})`,
    `Unmatched ₦${(total - matchedTotal).toLocaleString()} (${lines.length - matched.length})`,
    status ? `Filtered to ${status.toLowerCase()} rows only` : '',
    `Exported ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
  ].filter(Boolean).join('   ·   ')
  meta.font = { size: 9, color: { argb: 'FF6B7280' } }

  const header = ws.getRow(4)
  header.values = COLUMNS.map((c) => c.label)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }

  let cursor = 5
  for (const l of lines) {
    const row = ws.getRow(cursor)
    row.values = COLUMNS.map((c) => c.value(l))
    COLUMNS.forEach((c, i) => {
      if (c.fmt) row.getCell(i + 1).numFmt = c.fmt
    })
    cursor++
  }

  // A totals row, formatted like the column above it so it can be read at a
  // glance and trusted — it is a real SUM, not a number typed once.
  if (lines.length > 0) {
    const totals = ws.getRow(cursor + 1)
    totals.getCell(1).value = 'Total'
    totals.getCell(1).font = { bold: true }
    const amountCell = totals.getCell(2)
    amountCell.value = { formula: `SUM(B5:B${cursor - 1})`, result: total }
    amountCell.numFmt = NGN
    amountCell.font = { bold: true }
  }

  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })
  ws.views = [{ state: 'frozen', ySplit: 4 }]
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: lastCol } }

  const stamp = day || [from, to].filter(Boolean).join('_') || 'all'
  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(
    buffer as ArrayBuffer,
    `${slug(account.bank_name)}_${slug(account.account_number)}_${stamp}.xlsx`,
  )
}
