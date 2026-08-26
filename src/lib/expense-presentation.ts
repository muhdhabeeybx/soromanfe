import type { PfiExpense } from '#/lib/hooks/usePfis'

/**
 * How an expense is coloured, in one place, for the screen and for both
 * exports.
 *
 * The table and the sheet used to decide this separately, which meant a row
 * that read as "paid" in green on screen arrived in Excel as plain text and
 * the reader had to find the status column to learn the same thing. Defining
 * each tone once, in all three colour spaces, is what keeps the downloaded
 * report recognisable as the page it came from.
 *
 * Two things are coloured, and they answer different questions:
 *
 *   status    where the request has got to — the thing being scanned for
 *   category  what kind of cost it is — the thing being grouped by
 *
 * Colouring both on one row would produce a rainbow with no focus, so the
 * status owns the row (a tinted left rail and a faint wash) and the category
 * owns only its own chip.
 */

// ── Status ────────────────────────────────────────────────────────────────

/**
 * The row's own tint, keyed to the same statuses as STATUS_TONE.
 *
 * Deliberately much fainter than the badge: it has to survive being read
 * behind text for the length of a wide table without making the text harder
 * to read. The left rail carries the actual signal — a solid 2px edge is
 * legible at a glance down the page in a way a 4% wash is not.
 */
export const STATUS_ROW: Record<string, { rail: string; wash: string }> = {
  pending:           { rail: 'border-l-muted-foreground/40', wash: '' },
  changes_requested: { rail: 'border-l-warning',             wash: 'bg-warning/[0.04]' },
  verified:          { rail: 'border-l-info/60',             wash: 'bg-info/[0.03]' },
  audit_approved:    { rail: 'border-l-info',                wash: 'bg-info/[0.05]' },
  admin_approved:    { rail: 'border-l-accent',              wash: 'bg-accent/[0.05]' },
  paid:              { rail: 'border-l-success',             wash: 'bg-success/[0.05]' },
  rejected:          { rail: 'border-l-destructive',         wash: 'bg-destructive/[0.05]' },
}

export const statusRow = (status: string) =>
  STATUS_ROW[status] ?? { rail: 'border-l-transparent', wash: '' }

/** ARGB fills for ExcelJS — the same seven meanings, opaque enough to print. */
export const STATUS_XL: Record<string, { fill: string; ink: string }> = {
  pending:           { fill: 'FFF4F5F7', ink: 'FF5A6472' },
  changes_requested: { fill: 'FFFFF4E0', ink: 'FF9A6700' },
  verified:          { fill: 'FFEAF2FD', ink: 'FF1D4ED8' },
  audit_approved:    { fill: 'FFDDE9FC', ink: 'FF1D4ED8' },
  admin_approved:    { fill: 'FFE3F1EC', ink: 'FF007A55' },
  paid:              { fill: 'FFDDF0E5', ink: 'FF0B7A3B' },
  rejected:          { fill: 'FFFCE4E4', ink: 'FFCC0000' },
}

export const statusXl = (status: string) =>
  STATUS_XL[status] ?? { fill: 'FFFFFFFF', ink: 'FF141414' }

/** RGB tuples for jsPDF / autotable. */
export const STATUS_PDF: Record<string, { fill: [number, number, number]; ink: [number, number, number] }> = {
  pending:           { fill: [244, 245, 247], ink: [90, 100, 114] },
  changes_requested: { fill: [255, 244, 224], ink: [154, 103, 0] },
  verified:          { fill: [234, 242, 253], ink: [29, 78, 216] },
  audit_approved:    { fill: [221, 233, 252], ink: [29, 78, 216] },
  admin_approved:    { fill: [227, 241, 236], ink: [0, 122, 85] },
  paid:              { fill: [221, 240, 229], ink: [11, 122, 59] },
  rejected:          { fill: [252, 228, 228], ink: [204, 0, 0] },
}

export const statusPdf = (status: string) =>
  STATUS_PDF[status] ?? { fill: [255, 255, 255] as [number, number, number], ink: [20, 20, 20] as [number, number, number] }

// ── Category ──────────────────────────────────────────────────────────────

/**
 * A cost's kind, keyed by GL subgroup — the five PFI headings plus overheads.
 *
 * Keyed by subgroup rather than by category because there are 70 categories
 * and only six kinds. Seventy colours would be a rainbow nobody could learn;
 * six can be recognised without a legend after a couple of sheets.
 *
 * Hues are explicit rather than semantic tokens: the app has four semantic
 * colours and they already mean approved / paid / rejected / changes-needed
 * on this very row. Reusing them for cost kinds would make a green chip mean
 * two different things depending on which column it sat in.
 */
const CATEGORY_KINDS = {
  general:    { label: 'General',    chip: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',        xl: 'FFEFF1F4', pdf: [239, 241, 244] },
  cargo:      { label: 'Cargo',      chip: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',               xl: 'FFE7EFFC', pdf: [231, 239, 252] },
  inspection: { label: 'Inspection', chip: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900',   xl: 'FFF0EAFB', pdf: [240, 234, 251] },
  insurance:  { label: 'Insurance',  chip: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-900',               xl: 'FFE2F4F1', pdf: [226, 244, 241] },
  operational:{ label: 'Operations', chip: 'bg-amber-50 text-amber-800 ring-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',         xl: 'FFFBF0DC', pdf: [251, 240, 220] },
  other:      { label: 'Other PFI',  chip: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',               xl: 'FFFBE8EC', pdf: [251, 232, 236] },
} as const

export type CategoryKind = keyof typeof CATEGORY_KINDS

/**
 * Matched on the subgroup's leading word so a heading can be reworded without
 * silently losing its colour — "Cargo / Vessel Costs" and a later "Cargo &
 * Vessel" both stay blue.
 */
export function categoryKind(e: {
  gl_group?: string | null
  gl_subgroup?: string | null
  pfi_id?: number | null
}): CategoryKind {
  if (e.gl_group === 'general') return 'general'
  const sub = (e.gl_subgroup || '').toLowerCase()
  if (sub.startsWith('cargo')) return 'cargo'
  if (sub.startsWith('inspection')) return 'inspection'
  if (sub.startsWith('insurance')) return 'insurance'
  if (sub.startsWith('pfi operational')) return 'operational'
  if (sub.startsWith('other pfi')) return 'other'
  // A retired pre-chart category has no group at all. It is still either
  // attached to a cargo or not, which is the one thing that survives.
  return e.pfi_id ? 'other' : 'general'
}

export const categoryChip = (e: Parameters<typeof categoryKind>[0]) =>
  CATEGORY_KINDS[categoryKind(e)].chip

export const categoryXl = (e: Parameters<typeof categoryKind>[0]) =>
  CATEGORY_KINDS[categoryKind(e)].xl

export const categoryPdf = (e: Parameters<typeof categoryKind>[0]) =>
  CATEGORY_KINDS[categoryKind(e)].pdf as unknown as [number, number, number]

/** "Cargo / Vessel Costs", or the group's name when there is no subgroup. */
export const categoryGrouping = (e: {
  gl_group?: string | null
  gl_subgroup?: string | null
  pfi_id?: number | null
}) => e.gl_subgroup || (e.gl_group === 'general' ? 'General Expenses' : CATEGORY_KINDS[categoryKind(e)].label)

// ── Bank details ──────────────────────────────────────────────────────────

/**
 * Who the money went to: the payee's own bank details as recorded on the
 * request.
 *
 * Three separate columns on the row, shown as one, because they are one fact
 * — you cannot pay against an account number without the bank, or against a
 * bank without the number. Returned as parts rather than a joined string so
 * the table can set the account number in mono and the exports can put each
 * on its own line.
 */
export function payeeAccount(e: {
  payee_bank_name?: string | null
  payee_account_number?: string | null
  payee_account_name?: string | null
}) {
  const bank = (e.payee_bank_name || '').trim()
  const number = (e.payee_account_number || '').trim()
  const name = (e.payee_account_name || '').trim()
  return {
    bank,
    number,
    name,
    /** Empty when the request never carried payee details at all. */
    any: Boolean(bank || number || name),
    /** One line, for a PDF cell or a CSV-shaped export. */
    line: [name, bank, number].filter(Boolean).join(' · '),
  }
}

/**
 * Where the money went out from.
 *
 * `bank_paid_from` is free text and has been written seventeen different ways
 * for about five accounts — "SRM FIDELITY EXPENSES ACCOUNT", "FIDELITY SRM
 * MAIN", bare "UBA". Resolving it against the managed accounts turns whichever
 * spelling was typed into the account's real name and bank; anything that
 * resolves to nothing keeps its own text verbatim, so no historical row loses
 * its label. Same rule, and the same reason, as formatBankLabel.
 */
export function paidFromParts(
  raw: string | null | undefined,
  resolved: { accountName: string; bankName: string; accountNumber: string } | null,
) {
  if (!raw) return { name: '', bank: '', number: '', line: '', resolved: false }
  if (!resolved) return { name: raw, bank: '', number: '', line: raw, resolved: false }
  return {
    name: resolved.accountName,
    bank: resolved.bankName,
    number: resolved.accountNumber,
    line: [resolved.accountName, resolved.bankName].filter(Boolean).join(' · '),
    resolved: true,
  }
}

// ── Totals ────────────────────────────────────────────────────────────────

/**
 * What a set of expenses adds up to.
 *
 * `paid` follows the same rule the table does: a request awaiting payment has
 * not paid ₦0, and a paid row with no amount_paid (recorded before that column
 * existed) falls back to the requested figure rather than reading as nothing
 * having cleared.
 */
export function expenseTotals(rows: PfiExpense[]) {
  let requested = 0
  let paid = 0
  let vat = 0
  let wht = 0
  const byStatus = new Map<string, { label: string; count: number; amount: number }>()
  const byKind = new Map<string, { label: string; count: number; amount: number }>()

  for (const e of rows) {
    const amount = Number(e.amount) || 0
    requested += amount
    vat += Number(e.vat_amount) || 0
    wht += Number(e.wht_deduction) || 0
    if (e.amount_paid != null) paid += Number(e.amount_paid) || 0
    else if (e.status === 'paid') paid += amount

    const s = byStatus.get(e.status) ?? { label: e.status_label || e.status, count: 0, amount: 0 }
    s.count++; s.amount += amount
    byStatus.set(e.status, s)

    const key = categoryGrouping(e)
    const k = byKind.get(key) ?? { label: key, count: 0, amount: 0 }
    k.count++; k.amount += amount
    byKind.set(key, k)
  }

  return {
    count: rows.length,
    requested,
    paid,
    outstanding: requested - paid,
    vat,
    wht,
    byStatus: [...byStatus.entries()].map(([status, v]) => ({ status, ...v })),
    byKind: [...byKind.values()].sort((a, b) => b.amount - a.amount),
  }
}
