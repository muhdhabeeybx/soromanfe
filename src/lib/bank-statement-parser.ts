import { format } from 'date-fns'
/**
 * Client-side statement parsing.
 *
 * The app already ships a spreadsheet reader, so the grid is read here rather
 * than uploaded raw. That makes the format-setup screen instant — you see the
 * real rows while choosing which column is which.
 *
 * Deduplication is deliberately NOT done here. It stays on the server, behind
 * a unique index, so it cannot be bypassed by a client.
 */

export type Grid = string[][]

export type ColumnMapping = {
  headerRow: number
  dateColumn: number
  /** How a bare numeric date is read. Day-first unless the account says otherwise. */
  dateOrder?: DateOrder
  /** A single signed amount column… */
  amountColumn: number | null
  /** …or a dedicated credit column. When set, debits are skipped entirely. */
  creditColumn: number | null
  depositorColumn: number | null
  referenceColumn: number | null
  narrationColumn: number | null
}

export type ParsedRow = {
  txnDate: string
  amount: number
  depositor: string
  bankRef: string
  narration: string
  rawRow: string[]
}

/**
 * A safety ceiling, not a working limit.
 *
 * This was 400, named MAX_PREVIEW_ROWS — but the grid it capped is the one
 * that gets UPLOADED, not just the one shown. Anything past row 400 of a
 * statement was silently dropped: no warning, no skipped count, the import
 * simply reported the rows it had kept and looked successful. On a bank
 * statement that is the worst possible failure, because the missing lines are
 * indistinguishable from lines the bank never sent.
 *
 * The ceiling now exists only to stop a browser dying on a pathological file,
 * and crossing it THROWS rather than truncates. A statement that will not fit
 * is a problem somebody has to know about.
 */
const MAX_ROWS = 50000

const tooManyRows = () =>
  new Error(
    `This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it and upload the parts `
    + 'separately — importing part of a statement without saying so would be worse.',
  )

/** Reads the first worksheet into a plain 2D array of display strings. */
export async function readGrid(file: File): Promise<Grid> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()

  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = new TextDecoder().decode(buffer).split(/\r?\n/)
    if (lines.length > MAX_ROWS) throw tooManyRows()
    return lines.map((line) => splitCsvLine(line))
  }

  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []

  const grid: Grid = []
  let overflow = false
  ws.eachRow({ includeEmpty: true }, (row, i) => {
    if (i > MAX_ROWS) { overflow = true; return }
    const values = row.values as any[]
    // exceljs is 1-indexed and puts a hole at position 0.
    grid.push(values.slice(1).map((v) => cellToString(v)))
  })
  if (overflow) throw tooManyRows()
  return grid
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function cellToString(v: any): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    // Formula cells and rich text.
    if ('result' in v) return cellToString(v.result)
    if ('text' in v) return String(v.text)
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('')
    return ''
  }
  return String(v)
}

/**
 * Which way round a bare numeric date is read.
 *
 * 07/09/2026 is 7 September to a Nigerian bank and 9 July to an American one,
 * and nothing in the string says which. Software cannot settle this; the
 * person who has the statement open can. Day-first stays the default because
 * it is the local convention, but the upload preview shows the result and the
 * choice is saved per bank account, so a bank that exports the other way is
 * fixed once rather than misread every month.
 */
export type DateOrder = 'day-first' | 'month-first'

/**
 * A statement date is a CALENDAR DATE, not an instant.
 *
 * Built at UTC midnight, never local midnight. `new Date(2026, 6, 9)` in Lagos
 * is 2026-07-08T23:00Z — the day BEFORE — so the row was stored one day early
 * and only looked right because the dashboard rendered it back in the same
 * timezone. Anything reading the database directly, exporting, or opening the
 * page from another timezone saw the previous day. 1,066 rows carry that shift.
 */
const utcDate = (year: number, month1: number, day: number): Date | null => {
  const d = new Date(Date.UTC(year, month1 - 1, day))
  if (Number.isNaN(d.getTime())) return null
  // Reject what Date silently rolls over: 31/02 becoming 3 March is a parse
  // failure wearing a valid date's clothes, and on a statement that is worse
  // than a skipped row.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month1 - 1 || d.getUTCDate() !== day) {
    return null
  }
  return d
}

/**
 * YYYY-MM-DD off a Date's UTC parts.
 *
 * `toISOString().slice(0,10)` would do the same only because coerceDate builds
 * at UTC midnight; taking the parts explicitly means this keeps working if
 * that ever changes.
 */
/**
 * Render a plain YYYY-MM-DD exactly as stored.
 *
 * `new Date('2026-07-09')` is parsed as UTC midnight, so anywhere west of
 * Greenwich it formats as 8 July — the same class of error that put these
 * dates a day out to begin with. Splitting the string and building a LOCAL
 * date keeps the day the bank printed, whoever is reading.
 */
export function formatPlainDay(v?: string | null, pattern = 'd MMM yyyy'): string {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return format(new Date(v), pattern)
  return format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), pattern)
}

export function toPlainDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/**
 * Work out which way round a file writes its dates, from the file itself.
 *
 * A single row cannot say: 09/01/2026 is 1 September to one bank and 9 January
 * to another. A COLUMN usually can. Any row whose first half is over 12 must
 * be day-first, because there is no thirteenth month; any row whose second
 * half is over 12 must be month-first. One statement almost always contains a
 * date past the 12th, and that one row settles every other row in the file.
 *
 * This is what the Fidelity statement needed: every visible row was 09/0x —
 * both halves under 12, and unreadable on its own — while further down the
 * same column sat 09/25, which is only a date if the month comes first.
 *
 * Returns null when the file genuinely cannot say, which is rare and honest:
 * a short statement where every transaction fell before the 13th. The caller
 * falls back to the account's setting, and the upload screen says so rather
 * than quietly choosing.
 */
export function detectDateOrder(grid: Grid, dateColumn: number, startRow = 0): {
  order: DateOrder | null
  dayFirstEvidence: number
  monthFirstEvidence: number
} {
  let dayFirst = 0
  let monthFirst = 0

  for (let i = startRow; i < grid.length; i++) {
    const cell = String(grid[i]?.[dateColumn] ?? '').trim()
    const m = cell.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
    if (!m) continue
    const first = Number(m[1])
    const second = Number(m[2])
    if (first > 12 && second <= 12) dayFirst++
    else if (second > 12 && first <= 12) monthFirst++
  }

  /**
   * Evidence both ways means the file is not consistent, and guessing a winner
   * would silently mangle whichever rows lose. Reported as undecided so a
   * person looks.
   */
  const order = dayFirst > 0 && monthFirst > 0
    ? null
    : dayFirst > 0
      ? 'day-first'
      : monthFirst > 0
        ? 'month-first'
        : null

  return { order, dayFirstEvidence: dayFirst, monthFirstEvidence: monthFirst }
}

/** Excel serial dates, ISO strings and common Nigerian d/m/y formats. */
export function coerceDate(raw: string, order: DateOrder = 'day-first'): Date | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  // Excel serial (days since 1899-12-30). Already UTC-based.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000))
    return Number.isNaN(d.getTime()) ? null : d
  }

  const numeric = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (numeric) {
    const [, a, b, c] = numeric
    const year = c.length === 2 ? 2000 + Number(c) : Number(c)
    const first = Number(a)
    const second = Number(b)

    /**
     * One half over 12 settles it whatever the setting says.
     *
     * 25/09 cannot be month-first and 09/25 cannot be day-first, so an
     * unambiguous row is read correctly even if the account is configured the
     * other way. Only genuinely ambiguous rows — both halves 12 or under —
     * fall back to the choice, which is exactly where a choice is needed.
     */
    if (first > 12 && second <= 12) return utcDate(year, second, first)
    if (second > 12 && first <= 12) return utcDate(year, first, second)

    return order === 'month-first'
      ? utcDate(year, first, second)
      : utcDate(year, second, first)
  }

  // An ISO or named-month string. Normalised to UTC midnight for the same
  // reason as above — Date parses "9 Jul 2026" as local midnight.
  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parsed
  return utcDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

/** Strips currency symbols, thousands separators and bracketed negatives. */
export function coerceAmount(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const negative = /^\(.*\)$/.test(s)
  const cleaned = s.replace(/[₦$,\s()]/g, '')
  if (!cleaned || Number.isNaN(Number(cleaned))) return null
  const n = Number(cleaned)
  return negative ? -n : n
}

/**
 * Turns a raw grid into importable credit rows.
 *
 * Anything without a valid date or a positive amount is skipped rather than
 * raised — repeated headers, blank rows, totals and debits all fall out here.
 */
export function parseRows(grid: Grid, mapping: ColumnMapping) {
  const rows: ParsedRow[] = []
  let skipped = 0

  const at = (row: string[], col: number | null) =>
    col === null || col === undefined ? '' : (row[col] ?? '')

  /**
   * What the file says about itself beats what the account was configured to
   * expect. A bank that changes its export format, or a file exported through
   * different software, is a real thing — and the evidence in the column is
   * the only source that cannot be stale.
   */
  const detected = detectDateOrder(grid, mapping.dateColumn, mapping.headerRow + 1)
  const order = detected.order ?? mapping.dateOrder ?? 'day-first'

  for (let i = mapping.headerRow + 1; i < grid.length; i++) {
    const row = grid[i]
    if (!row || row.every((c) => !String(c ?? '').trim())) { skipped++; continue }

    const date = coerceDate(at(row, mapping.dateColumn), order)
    if (!date) { skipped++; continue }

    // A credit column means debits live elsewhere and are simply not read.
    const amountSource = mapping.creditColumn ?? mapping.amountColumn
    const amount = coerceAmount(at(row, amountSource))
    if (amount === null || amount <= 0) { skipped++; continue }

    rows.push({
      /**
       * The day, exactly as it was read — no hour, no zone.
       *
       * A full ISO instant is what put rows a day out: it was built at local
       * midnight, stored as the previous day in UTC, and read back through the
       * same timezone so the error never showed on screen. The column is a
       * `date` now and this sends a date.
       */
      txnDate: toPlainDay(date),
      amount,
      depositor: String(at(row, mapping.depositorColumn)).trim(),
      bankRef: String(at(row, mapping.referenceColumn)).trim(),
      narration: String(at(row, mapping.narrationColumn)).trim(),
      rawRow: row.map((c) => String(c ?? '')),
    })
  }

  return {
    rows,
    skipped,
    /** How dates were read, and whether the file proved it or it was assumed. */
    dateOrder: order,
    dateOrderDetected: detected.order !== null,
  }
}
