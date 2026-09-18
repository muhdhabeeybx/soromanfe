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
  /** Which override this cell carries, where it carries one. */
  field?: CfoOverrideField
  /** Kept off the PDF — it is a portrait-width document and will not take it. */
  auditOnly?: boolean
}

/**
 * In reading order: what the batch is, what it started with, what has gone,
 * what is left, what that came to, what reached the bank, and the gap.
 *
 * A reader takes the quantity block and the money block as two groups, so
 * they are not interleaved even though stock balance and sales value are
 * about the same litres.
 */
export const CFO_COLUMNS: CfoColumn[] = [
  { key: 'sn', header: 'S/N', kind: 'index', width: 6 },
  { key: 'pfi', header: 'PFI', kind: 'text', width: 30 },
  { key: 'location', header: 'Location', kind: 'text', width: 26 },
  { key: 'product', header: 'Product', kind: 'text', width: 13 },
  { key: 'initialQty', header: 'Initial Qty', kind: 'qty', width: 15, field: 'initialQty' },
  {
    key: 'cumulativeVolume',
    header: 'Cumulative Sales Volume',
    kind: 'qty',
    width: 19,
    field: 'cumulativeVolume',
  },
  { key: 'dayVolume', header: "Sales Volume (Day)", kind: 'qty', width: 16, field: 'dayVolume' },
  // Derived — no `field`, so nothing renders an input over it. See the header
  // of useCfoReport for why these two cannot be typed.
  { key: 'stockBalance', header: 'Stock Balance', kind: 'qty', width: 16 },
  { key: 'salesValue', header: 'Sales Value To Date', kind: 'money', width: 20, field: 'salesValue' },
  {
    key: 'bankInflow',
    header: 'Bank Inflow Confirmed',
    kind: 'money',
    width: 20,
    field: 'bankInflow',
  },
  { key: 'surplusDeficit', header: 'Surplus / (Deficit)', kind: 'signed', width: 20 },
  { key: 'remarks', header: 'Remarks', kind: 'text', width: 40 },
  /**
   * Two columns the workbook carries and the screen and the page do not.
   *
   * A spreadsheet is where this report gets checked line by line, and the two
   * questions asked there are "how much of this money can I tie to a bank
   * statement" and "who changed this row". Neither belongs in the twelve
   * columns the report is read as, and both are wanted the moment somebody
   * starts reconciling.
   */
  { key: 'bankBacked', header: 'Of Which Bank-Backed', kind: 'money', width: 20, auditOnly: true },
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
 * Not every batch is litres — LPG is bought and sold in kilogrammes — and a
 * column that suffixed every figure with "L" regardless would be printing a
 * wrong number, not a differently-worded one.
 */
export function unitShort(unit: string): string {
  return /^lit(re|er)s?$/i.test(unit) ? 'L' : unit || 'L'
}

const qty = (n: number, unit: string) =>
  `${Math.round(n).toLocaleString('en-NG')} ${unitShort(unit)}`

const naira = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Money that carries meaning in its sign — parenthesised when negative. */
const nairaSigned = (n: number) =>
  n < 0
    ? `(₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    : naira(n)

/**
 * One row's cells as RAW values — numbers stay numbers.
 *
 * The workbook needs real numbers with a cell format applied: a litres column
 * that reads like litres but is text cannot be summed, and summing it is the
 * first thing anybody does with this sheet. The screen and the PDF format
 * these through `cfoDisplay` below.
 */
export function cfoRowValues(row: CfoRow, index: number): Record<string, string | number> {
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
    remarks: row.remarks,
    // Blank rather than 0 once the inflow has been corrected: the
    // statement-backed portion describes the payment rows the system found and
    // says nothing about a figure somebody typed. See verifiableShare.
    bankBacked: row.edited.includes('bankInflow') ? '' : row.computed.statementInflow,
    correctedBy: row.updatedByName || '',
  }
}

/** The same cell, formatted for a human to read. */
export function cfoDisplay(
  column: CfoColumn,
  value: string | number,
  unit: string,
): string {
  if (column.kind === 'qty') return qty(Number(value) || 0, unit)
  if (column.kind === 'money') return value === '' ? '—' : naira(Number(value) || 0)
  if (column.kind === 'signed') return nairaSigned(Number(value) || 0)
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
