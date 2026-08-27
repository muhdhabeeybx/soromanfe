import { cn } from '#/lib/utils'
import type { PfiFinancials } from '#/lib/hooks/usePfis'

/**
 * A null money figure is not zero. An uncosted batch must read "—" so nobody
 * takes an unpriced cargo for a free one.
 */
export function naira(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (opts?.compact) {
    const abs = Math.abs(v)
    const sign = v < 0 ? '-' : ''
    if (abs >= 1_000_000_000) return `${sign}₦${(abs / 1_000_000_000).toFixed(2)}bn`
    if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(1)}m`
    if (abs >= 1_000) return `${sign}₦${(abs / 1_000).toFixed(0)}k`
  }
  // Sign before the symbol: "₦-3,871,765,923" reads as a currency code for a
  // second before it reads as a loss.
  const sign = v < 0 ? '-' : ''
  return `${sign}₦${Math.abs(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function litres(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v).toLocaleString('en-NG')} L`
}

/**
 * How a product's unit is written, in the three lengths the UI needs.
 *
 * A PFI's quantity is not always litres. LPG is bought and sold in metric
 * tonnes or kilograms, and every label that said "Litres" regardless was
 * asking for a tonnage figure under the wrong name — a form that reads
 * "Quantity (Litres)" beside "Cooking Gas" invites someone to convert, and a
 * converted figure is a wrong figure.
 *
 * Matched on substrings rather than exact equality: the product form offers
 * "Liters", "Metric Tonnes", "Kilograms", "Barrels" and "US Gallons", but PFIs
 * predating that carry free text — "Litres", "MT", "Tons" — and those rows
 * have to keep reading correctly.
 */
export type UnitNames = {
  /** Plural, as the product list writes it: "Metric Tonnes". */
  plural: string
  /** "Metric Tonne" — for "Price per …". */
  singular: string
  /** "MT" — for figures, where the long form would crowd the number out. */
  short: string
  /** Tonnage and weight are fractional; a litre is not. */
  decimals: number
}

const UNIT_TABLE: Array<{ match: RegExp; names: UnitNames }> = [
  { match: /metric|(^|[^a-z])mt([^a-z]|$)|ton/i, names: { plural: 'Metric Tonnes', singular: 'Metric Tonne', short: 'MT', decimals: 2 } },
  { match: /kilogram|(^|[^a-z])kgs?([^a-z]|$)/i, names: { plural: 'Kilograms', singular: 'Kilogram', short: 'kg', decimals: 2 } },
  { match: /barrel|(^|[^a-z])bbls?([^a-z]|$)/i, names: { plural: 'Barrels', singular: 'Barrel', short: 'bbl', decimals: 2 } },
  { match: /gallon/i, names: { plural: 'US Gallons', singular: 'Gallon', short: 'Gal', decimals: 2 } },
]

const LITRES: UnitNames = { plural: 'Litres', singular: 'Litre', short: 'L', decimals: 0 }

export function unitNames(raw: string | null | undefined): UnitNames {
  const text = String(raw || '').trim()
  if (!text) return LITRES
  return UNIT_TABLE.find((u) => u.match.test(text))?.names || LITRES
}

/**
 * A quantity written in its own unit — the unit-aware {@link litres}.
 *
 * Same "null is not zero" rule: a quantity nobody has entered reads "—".
 */
export function qty(v: number | null | undefined, unit?: string | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const u = unitNames(unit)
  return `${v.toLocaleString('en-NG', {
    minimumFractionDigits: u.decimals,
    maximumFractionDigits: u.decimals,
  })} ${u.short}`
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)}%`
}

/** Green above zero, red below, muted at nothing. */
export function moneyTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'text-muted-foreground'
  return v > 0 ? 'text-accent' : 'text-destructive'
}

/**
 * Background + border for a card's profit/loss hero block. Pairs with
 * {@link moneyTone} on the figure inside it — the tint carries the same
 * verdict the text colour does, so it reads before anyone parses the number.
 */
export function profitTint(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'border-foreground/10 bg-muted/40'
  return v > 0 ? 'border-accent/25 bg-accent/5' : 'border-destructive/25 bg-destructive/5'
}

/**
 * The gap between the tank and the papers.
 *
 * A surplus is product you got for free; a deficit is money paid for product
 * that never arrived. Neither is neutral, so neither renders neutral.
 */
export function SurplusDeficit({
  litres: value,
  unit,
  className,
}: {
  litres: number | null
  /** The product's unit — an LPG cargo's gap is tonnes, not litres. */
  unit?: string | null
  className?: string
}) {
  if (value == null) {
    return <span className={cn('text-muted-foreground', className)}>—</span>
  }
  if (value === 0) return <span className={cn('text-muted-foreground', className)}>Exact</span>

  const surplus = value > 0
  return (
    <span className={cn(surplus ? 'text-accent' : 'text-destructive', className)}>
      {surplus ? '+' : '−'}
      {qty(Math.abs(value), unit)}
      <span className="ml-1 text-[0.7em] uppercase opacity-70">
        {surplus ? 'surplus' : 'deficit'}
      </span>
    </span>
  )
}

/**
 * How much of the batch has actually gone out.
 *
 * This bar is the single most important thing on the page, because it is what
 * tells you whether the profit figure beside it means anything yet.
 */
export function SellThroughBar({ value, className }: { value: number | null; className?: string }) {
  const share = value == null ? 0 : Math.round(value * 100)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            share >= 99 ? 'bg-accent' : share >= 50 ? 'bg-warning' : 'bg-foreground/25',
          )}
          style={{ width: `${Math.min(100, Math.max(share === 0 ? 0 : 2, share))}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{share}%</span>
    </div>
  )
}

/**
 * The one sentence that stops a paper loss being read as a real one.
 *
 * Cost is charged in full from day one while revenue only accrues as orders
 * are booked, so a healthy half-sold batch still shows a large loss.
 */
export function profitCaveat(f: PfiFinancials): string | null {
  if (f.profitIsMeaningful || f.sellThrough == null) return null
  const share = Math.round(f.sellThrough * 100)
  return `Only ${share}% of this PFI has been sold so this is not yet a real loss.`
  // return `Only ${share}% of this PFI has been sold. The full cargo cost is charged against ${share}% of the revenue, so this is not yet a real loss — read it as "have we recovered the cargo cost".`
}
