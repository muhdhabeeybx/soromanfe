import type { CfoRow, CfoTotals, CfoOverrideField } from '#/lib/hooks/useCfoReport'

/**
 * The CFO report's columns, defined once for the screen, the workbook and the
 * page.
 *
 * All three render from this list and from `cfoRowValues` below, so they
 * cannot drift from each other — the failure mode being a spreadsheet that
 * disagrees with the screen it was exported from, which nobody notices until
 * somebody has acted on one of them.
 */

export type CfoColumnKind = 'index' | 'text' | 'qty' | 'money' | 'signed'

export interface CfoColumn {
  key: string
  header: string
  /** How it is formatted and aligned. `signed` is money that can be either way. */
  kind: CfoColumnKind
  /** Excel column width, in characters. */
  width: number
  /**
   * PDF column width, in millimetres.
   *
   * Set on every numeric column and left off the prose ones. Without it
   * autotable sizes columns by content and a money figure at 12 columns wide
   * wrapped mid-number — "₦32,784,600,0" on one line and "00.00" on the next,
   * which is not a hard-to-read figure, it is a wrong one.
   */
  pdf?: number
  /** Which override this cell carries, where it carries one. */
  field?: CfoOverrideField
  /** Kept off the PDF — it is a portrait-width document and will not take it. */
  auditOnly?: boolean
}

/**
 * In reading order: what the PFI is, what it started with, what has gone,
 * what is left, what that came to, what reached the bank, and the gap.
 *
 * A reader takes the quantity block and the money block as two groups, so
 * they are not interleaved even though stock balance and sales value are
 * about the same litres.
 */
export const CFO_COLUMNS: CfoColumn[] = [
  { key: 'sn', header: 'S/N', kind: 'index', width: 6, pdf: 9 },
  { key: 'pfi', header: 'PFI', kind: 'text', width: 32, pdf: 28 },
  { key: 'location', header: 'Location', kind: 'text', width: 26, pdf: 22 },
  { key: 'product', header: 'Product', kind: 'text', width: 13, pdf: 14 },
  { key: 'initialQty', header: 'Initial Qty', kind: 'qty', width: 16, pdf: 19, field: 'initialQty' },
  {
    key: 'cumulativeVolume',
    header: 'Cumulative Sales Volume',
    kind: 'qty',
    width: 20,
    pdf: 21,
    field: 'cumulativeVolume',
  },
  { key: 'dayVolume', header: "Sales Volume (Day)", kind: 'qty', width: 17, pdf: 19, field: 'dayVolume' },
  // Derived — no `field`, so nothing renders an input over it. See the header
  // of useCfoReport for why these two cannot be typed.
  { key: 'stockBalance', header: 'Stock Balance', kind: 'qty', width: 17, pdf: 19 },
  { key: 'salesValue', header: 'Sales Value To Date', kind: 'money', width: 23, pdf: 31, field: 'salesValue' },
  {
    key: 'bankInflow',
    header: 'Bank Inflow Confirmed',
    kind: 'money',
    width: 23,
    pdf: 31,
    field: 'bankInflow',
  },
  { key: 'surplusDeficit', header: 'Surplus / (Deficit)', kind: 'signed', width: 23, pdf: 29 },
  // No pdf width: Remarks takes whatever the numeric columns leave, and prose
  // is the one thing on this sheet that SHOULD wrap.
  { key: 'remarks', header: 'Remarks', kind: 'text', width: 46 },
  /**
   * Two columns the workbook carries and the screen and the page do not.
   *
   * A spreadsheet is where this report gets checked line by line, and the two
   * questions asked there are "how much of this money can I tie to a bank
   * statement" and "who changed this row". Neither belongs in the twelve
   * columns the report is read as, and both are wanted the moment somebody
   * starts reconciling.
   */
  { key: 'bankBacked', header: 'Of Which Bank-Backed', kind: 'money', width: 23, auditOnly: true },
  { key: 'correctedBy', header: 'Corrected By', kind: 'text', width: 22, auditOnly: true },
]

/** The twelve the screen and the PDF show. */
export const CFO_CORE_COLUMNS = CFO_COLUMNS.filter((c) => !c.auditOnly)

/** Right-aligned everywhere: the figures. */
export const CFO_NUMERIC = new Set(
  CFO_COLUMNS.filter((c) => c.kind !== 'text' && c.kind !== 'index').map((c) => c.key),
)

/**
 * The short unit suffix a quantity is printed with.
 *
 * Not every PFI is litres — LPG is bought and sold in kilogrammes — and a
 * column that suffixed every figure with "L" regardless would be printing a
 * wrong number, not a differently-worded one.
 */
export function unitShort(unit: string): string {
  return /^lit(re|er)s?$/i.test(unit) ? 'L' : unit || 'L'
}

const qty = (n: number, unit: string) =>
  `${Math.round(n).toLocaleString('en-NG')} ${unitShort(unit)}`

/**
 * Naira, with kobo shown ONLY where there is kobo to show.
 *
 * A forced ".00" on every cell costs three characters in each of three money
 * columns, and at this scale that is what pushed the PDF's figures into
 * wrapping mid-number. Dropping the decimals outright would have been the
 * wrong fix: 5 rows in the whole book carry real kobo (₦56,900,000.99 among
 * them), and rounding a reconciliation figure to hide a 99k discrepancy is
 * exactly the kind of quiet wrong number this report exists to surface.
 *
 * So: minimumFractionDigits 0, maximumFractionDigits 2. A whole-naira figure
 * prints clean, and a figure with kobo keeps every digit of it.
 *
 * The workbook is unaffected — it writes real numbers with a fixed 2dp cell
 * format, which is what a spreadsheet column should be.
 */
const MONEY_DIGITS = { minimumFractionDigits: 0, maximumFractionDigits: 2 } as const

/** Writes one money figure. See CurrencyMark for why this is a parameter. */
export type MoneyWriter = (n: number) => string

const nairaAmount = (n: number) => n.toLocaleString('en-NG', MONEY_DIGITS)

const naira = (n: number) => `₦${nairaAmount(n)}`

/** Money that carries meaning in its sign — parenthesised when negative. */
const nairaSigned = (n: number) => (n < 0 ? `(₦${nairaAmount(Math.abs(n))})` : naira(n))

/**
 * Money at a glance, for a remark or a stat card — "₦16.1m", "₦1.29bn".
 *
 * Only ever used in prose, never in a figure column. A reconciliation column
 * has to carry every digit; a sentence saying how a PFI stands does not, and
 * "₦16,000,000" in the middle of one is harder to read than "₦16m".
 */
export function nairaCompact(n: number, symbol: CurrencyMark = '₦'): string {
  const abs = Math.abs(n)
  // ASCII, not U+2212: neither Satoshi nor jsPDF's Helvetica carries the
  // typographic minus, and a dropped sign turns a deficit into a surplus.
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}m`
  if (abs >= 1e3) return `${sign}${symbol}${Math.round(abs / 1e3)}k`
  return `${sign}${symbol}${Math.round(abs).toLocaleString('en-NG')}`
}

/**
 * How naira is marked in a given document.
 *
 * '₦' everywhere the typeface has the glyph, 'NGN ' in the PDF — which is set
 * in Satoshi, and Satoshi has no U+20A6. This has to reach the REMARKS as well
 * as the figure columns: the generated remark quotes an amount, and the first
 * version of this export printed a broken bar inside the sentence while the
 * columns beside it read correctly.
 */
export type CurrencyMark = '₦' | 'NGN '

/** Money in full, marked for the document it is going into. */
export const nairaIn = (symbol: CurrencyMark): MoneyWriter => (n) => `${symbol}${nairaAmount(n)}`

/** The same, parenthesised when negative. */
export const nairaSignedIn = (symbol: CurrencyMark): MoneyWriter => (n) =>
  n < 0 ? `(${symbol}${nairaAmount(Math.abs(n))})` : `${symbol}${nairaAmount(n)}`

/** A quantity at a glance, same job as nairaCompact. */
export function qtyText(n: number, unit: string): string {
  return `${Math.round(n).toLocaleString('en-NG')} ${unitShort(unit)}`
}

/**
 * How drawn down a PFI is: 0 when the tank is untouched, 1 when it is empty.
 *
 * Null where there is no initial quantity to measure against — a bar drawn
 * from a denominator of zero is a bar that means nothing, and it must read as
 * "not known" rather than as "full" or "empty". Clamped, because a PFI can be
 * oversold: more confirmed orders than the tank ever held is a real state, and
 * it is reported in the figures rather than by a bar running off its track.
 */
export function drawnDownShare(row: CfoRow): number | null {
  if (!row.initialQty) return null
  return Math.min(1, Math.max(0, row.cumulativeVolume / row.initialQty))
}

/**
 * Where a PFI stands on money — the polarity question, as a labelled state.
 *
 * A label, not just a colour. The palette already reserves red and green for
 * signed money, and this is what lets that pairing carry a word beside it so
 * the state survives a monochrome print-out and a colour-blind reader, which
 * a coloured figure on its own does not.
 *
 * "Settled" is a strict zero rather than a tolerance. Five payments on the
 * whole book carry kobo, and rounding a ₦0.99 discrepancy away on a
 * reconciliation sheet is precisely the quiet wrong number this report exists
 * to surface.
 */
export type MoneyState = 'settled' | 'surplus' | 'deficit'

export function moneyState(row: CfoRow): MoneyState {
  if (row.surplusDeficit === 0) return 'settled'
  return row.surplusDeficit > 0 ? 'surplus' : 'deficit'
}

export const MONEY_STATE_LABEL: Record<MoneyState, string> = {
  settled: 'Settled',
  surplus: 'Surplus',
  deficit: 'Deficit',
}

/**
 * The remark a row writes about itself when nobody has written one.
 *
 * ── Why the column is filled in at all ────────────────────────────────────
 *
 * A Remarks column that is empty on every row is a column of dashes that
 * teaches the reader to skip it, and then the one row somebody DID annotate
 * gets skipped with the rest. Filling it from the row's own figures makes it
 * worth reading, and makes a typed remark stand out by contrast rather than
 * by being the only thing there.
 *
 * ── It must never be mistaken for something a person wrote ────────────────
 *
 * This is an audit document, so a generated sentence carries `auto: true` and
 * every surface renders it differently: muted and italic on screen, in the
 * soft ink with a cell note in the workbook, italic in the PDF. A typed
 * remark always wins outright — it is never merged with a generated one,
 * because a half-generated sentence signed by a person is worse than either.
 *
 * ── What it says ──────────────────────────────────────────────────────────
 *
 * Two clauses at most, in the order the desk asks them: did it move today,
 * and does the money agree. A stock warning is added only when the answer is
 * unusual, so it keeps its force.
 */
/**
 * How drawn down a PFI has to be before the remark says so.
 *
 * A presentation threshold, not a business rule — the exact balance is in the
 * column directly above, and this only decides whether the sentence bothers to
 * mention it. At 97% four of the twelve PFIs currently trading would carry the
 * phrase and it would stop meaning anything; at 98% it flags the two that are
 * genuinely about to run out.
 */
const NEARLY_DRY = 0.98

export function rowRemark(
  row: CfoRow,
  symbol: CurrencyMark = '₦',
): { text: string; auto: boolean } {
  if (row.remarks) return { text: row.remarks, auto: false }

  const parts: string[] = []

  parts.push(
    row.dayVolume > 0
      ? `Sold ${qtyText(row.dayVolume, row.productUnit)}.`
      : 'No movement.',
  )

  const share = drawnDownShare(row)
  if (row.stockBalance <= 0) {
    parts.push('Fully drawn down.')
  } else if (share !== null && share >= NEARLY_DRY) {
    parts.push(`Nearly dry — ${qtyText(row.stockBalance, row.productUnit)} left.`)
  }

  // Kept short on purpose. This is the last column on a twelve-column sheet
  // and every extra clause is another wrapped line in the PDF.
  const state = moneyState(row)
  if (state === 'settled') parts.push('Settled in full.')
  else if (state === 'deficit') parts.push(`${nairaCompact(Math.abs(row.surplusDeficit), symbol)} still owed.`)
  else parts.push(`${nairaCompact(row.surplusDeficit, symbol)} surplus held.`)

  return { text: parts.join(' '), auto: true }
}

/**
 * One row's cells as RAW values — numbers stay numbers.
 *
 * The workbook needs real numbers with a cell format applied: a litres column
 * that reads like litres but is text cannot be summed, and summing it is the
 * first thing anybody does with this sheet. The screen and the PDF format
 * these through `cfoDisplay` below.
 */
export function cfoRowValues(
  row: CfoRow,
  index: number,
  symbol: CurrencyMark = '₦',
): Record<string, string | number> {
  return {
    sn: index + 1,
    pfi: row.pfiNumber,
    location: row.locationName,
    product: row.productName,
    initialQty: row.initialQty,
    cumulativeVolume: row.cumulativeVolume,
    dayVolume: row.dayVolume,
    stockBalance: row.stockBalance,
    salesValue: row.salesValue,
    bankInflow: row.bankInflow,
    surplusDeficit: row.surplusDeficit,
    // The typed remark, or the one the row writes about itself. Callers that
    // need to know which it was ask rowRemark directly — see its header.
    remarks: rowRemark(row, symbol).text,
    // Blank rather than 0 once the inflow has been corrected: the
    // statement-backed portion describes the payment rows the system found and
    // says nothing about a figure somebody typed. See verifiableShare.
    bankBacked: row.edited.includes('bankInflow') ? '' : row.computed.statementInflow,
    correctedBy: row.updatedByName || '',
  }
}

/**
 * How money is written, given the typeface the document is set in.
 *
 * Satoshi has no U+20A6, so a PDF set in it prints an empty box beside every
 * figure — which is exactly what the first version of this report did in
 * Helvetica, whose core encoding lacks the glyph too. The ISO form is the
 * standard on financial documents anyway, so a caller that has switched faces
 * passes `pdfNairaIso` here and the column reads "NGN 32,784,600,000".
 */
const SIGNED_DEFAULT: MoneyWriter = nairaSigned

/** The same cell, formatted for a human to read. */
export function cfoDisplay(
  column: CfoColumn,
  value: string | number,
  unit: string,
  money: MoneyWriter = naira,
  signed: MoneyWriter = SIGNED_DEFAULT,
): string {
  if (column.kind === 'qty') return qty(Number(value) || 0, unit)
  if (column.kind === 'money') return value === '' ? '—' : money(Number(value) || 0)
  if (column.kind === 'signed') return signed(Number(value) || 0)
  if (column.kind === 'index') return String(value)
  return String(value ?? '') || '—'
}

/**
 * A totals row, keyed the same way as a data row so both render through the
 * same column list.
 *
 * Quantity cells are null when the rows below them are in more than one unit.
 * That is the honest answer — litres and kilogrammes have no sum — and the
 * per-unit figures are printed beside the table instead. A single-unit day
 * gets its totals in the column where a reader expects them.
 */
export function cfoTotalValues(
  totals: CfoTotals,
  label: string,
): { values: Record<string, string | number | null>; unit: string | null } {
  const units = Object.keys(totals.byUnit)
  const only = units.length === 1 ? units[0] : null
  const q = only ? totals.byUnit[only] : null

  return {
    unit: only,
    values: {
      sn: '',
      pfi: label,
      location: '',
      product: '',
      initialQty: q ? q.initialQty : null,
      cumulativeVolume: q ? q.cumulativeVolume : null,
      dayVolume: q ? q.dayVolume : null,
      stockBalance: q ? q.stockBalance : null,
      salesValue: totals.salesValue,
      bankInflow: totals.bankInflow,
      surplusDeficit: totals.surplusDeficit,
      remarks: '',
      bankBacked: null,
      correctedBy: '',
    },
  }
}

/** "1,623,284 L · 940 kg" — quantities across units, never added together. */
export function quantityAcrossUnits(
  totals: CfoTotals,
  pick: (u: CfoTotals['byUnit'][string]) => number,
): string {
  const parts = Object.values(totals.byUnit)
    .filter((u) => pick(u) !== 0)
    .map((u) => qty(pick(u), u.unit))
  return parts.length ? parts.join(' · ') : '0'
}
