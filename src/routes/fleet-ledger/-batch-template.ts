/**
 * Shortcodes for batch descriptions.
 *
 * A batch posts the same thing to a dozen trucks, and the one part that
 * should *not* be the same is the description — "Salary" on twelve rows tells
 * you nothing six months later, while "July salary — Musa Bello (ABC-123-XY)"
 * reads correctly on every one of them. Typing that twelve times is exactly
 * the work the batch exists to remove, so the description is a template and
 * the per-truck facts are filled in on the way out.
 *
 * Substitution happens on the screen, not on the server: the operator sees
 * the finished lines in the preview before committing, and what they approved
 * is literally what gets sent. A server-side template would mean approving a
 * pattern and storing something you never actually read.
 *
 * Unknown tokens are left alone rather than blanked — "{plaet}" surviving
 * into the preview is how the operator sees the typo; silently swallowing it
 * would post a dozen rows with a hole in them.
 */

import { format } from 'date-fns'

export interface TemplateContext {
  plate: string
  driver: string
  make: string
  /** The entry date, as yyyy-MM-dd. */
  date: string
  category: string
  amount: number
}

export interface Shortcode {
  token: string
  label: string
  /** What it resolves to, shown beside the chip. */
  sample: (ctx: TemplateContext) => string
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`

const asDate = (raw: string): Date | null => {
  const d = new Date(`${raw}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Falls back to the raw string so a half-typed date still previews. */
const fmt = (raw: string, pattern: string) => {
  const d = asDate(raw)
  return d ? format(d, pattern) : raw
}

export const SHORTCODES: Shortcode[] = [
  { token: '{plate}', label: 'Plate', sample: (c) => c.plate },
  { token: '{driver}', label: 'Driver', sample: (c) => c.driver || '—' },
  { token: '{truck}', label: 'Make', sample: (c) => c.make || '—' },
  { token: '{month}', label: 'Month', sample: (c) => fmt(c.date, 'MMMM') },
  { token: '{year}', label: 'Year', sample: (c) => fmt(c.date, 'yyyy') },
  { token: '{date}', label: 'Date', sample: (c) => fmt(c.date, 'd MMM yyyy') },
  { token: '{category}', label: 'Category', sample: (c) => c.category || '—' },
  { token: '{amount}', label: 'Amount', sample: (c) => naira(c.amount) },
]

const RESOLVERS: Record<string, (c: TemplateContext) => string> = Object.fromEntries(
  SHORTCODES.map((s) => [s.token, s.sample]),
)

/** Every token in one pass, so a replacement can never be re-scanned. */
const TOKEN_RE = /\{[a-z]+\}/gi

export function applyTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TOKEN_RE, (match) => {
    const resolve = RESOLVERS[match.toLowerCase()]
    return resolve ? resolve(ctx) : match
  })
}

/** Tokens the operator typed that nothing will fill in — worth warning about. */
export function unknownTokens(template: string): string[] {
  const found = template.match(TOKEN_RE) ?? []
  return [...new Set(found.filter((t) => !RESOLVERS[t.toLowerCase()]))]
}
