import { Split, Users } from 'lucide-react'
import { cn } from '#/lib/utils'
import { formatShareBreakdown, type LoadSplit } from '#/lib/load-split'

/**
 * How a split load reads, in one place.
 *
 * A truck divided between customers has to say so wherever it appears, and say
 * the same thing each time: the whole load as the headline figure, the shares
 * that make it up underneath, and a badge so a split is recognisable at a
 * glance rather than inferred from a customer column that happens to hold two
 * names.
 */

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

export function SplitBadge({ split, className }: { split: LoadSplit; className?: string }) {
  if (!split.isSplit) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10',
        'px-1.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300 whitespace-nowrap',
        className,
      )}
      title={`This load is split between ${split.shares.length} customers`}
    >
      <Split className="size-3" />
      Split · {split.shares.length}
    </span>
  )
}

/**
 * The load's full quantity, with the shares it breaks into below it.
 *
 * `unassigned` is shown as its own part rather than folded away: a truck with
 * 15,000 L still unsold is a different thing from one fully assigned, and the
 * gap is what tells an operator there is work left on the row.
 */
export function LoadQuantity({
  split,
  unit = 'Litres',
  className,
  align = 'left',
}: {
  split: LoadSplit
  unit?: string
  className?: string
  align?: 'left' | 'right'
}) {
  if (split.total <= 0) return <span className="text-muted-foreground">—</span>

  return (
    <div className={cn('flex flex-col gap-0.5', align === 'right' && 'items-end text-right', className)}>
      <span className="font-semibold text-foreground whitespace-nowrap tabular-nums">
        {fmtQty(split.total)} {unit}
      </span>
      {split.isSplit && (
        <span
          className="text-xs font-normal text-muted-foreground whitespace-nowrap tabular-nums"
          title={`${split.shares.length} customers on this load`}
        >
          {formatShareBreakdown(split)}
        </span>
      )}
      {!split.isSplit && split.unassigned > 0 && split.assigned > 0 && (
        <span className="text-xs font-normal text-muted-foreground whitespace-nowrap tabular-nums">
          {fmtQty(split.assigned)} sold · {fmtQty(split.unassigned)} unassigned
        </span>
      )}
    </div>
  )
}

/** The shares themselves — customer, volume, and where it went. */
export function ShareList({
  split,
  className,
  showDestination = false,
}: {
  split: LoadSplit
  className?: string
  showDestination?: boolean
}) {
  if (!split.shares.length) return <span className="text-muted-foreground">—</span>

  return (
    <div className={cn('flex flex-col gap-1 py-0.5', className)}>
      {split.shares.map((share, i) => (
        <div key={share.customerId || `share-${i}`} className="flex items-center gap-1.5">
          <span className="truncate text-xs font-normal capitalize text-foreground">
            {share.customerName || 'Unassigned'}
          </span>
          {share.quantity > 0 && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
              {fmtQty(share.quantity)}L
            </span>
          )}
          {showDestination && share.destination && (
            <span className="truncate text-xs capitalize text-muted-foreground">→ {share.destination}</span>
          )}
        </div>
      ))}
      {split.unassigned > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-normal italic text-muted-foreground">Unassigned</span>
          <span className="inline-flex items-center rounded border border-dashed border-border px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {fmtQty(split.unassigned)}L
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * The banner a split load carries on its own page — the whole load, every
 * share, and the arithmetic between them laid out rather than implied.
 */
export function SplitSummaryCard({
  split,
  unit = 'Litres',
  className,
}: {
  split: LoadSplit
  unit?: string
  className?: string
}) {
  if (!split.isSplit) return null

  return (
    <div className={cn('rounded-xl border border-blue-500/30 bg-blue-500/5 p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4 text-blue-600 dark:text-blue-400" />
          Split load — {split.shares.length} customers
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {fmtQty(split.total)} {unit}
        </span>
      </div>

      <div className="space-y-1.5">
        {split.shares.map((share, i) => {
          const pct = split.total > 0 ? Math.round((share.quantity / split.total) * 100) : 0
          return (
            <div key={share.customerId || `share-${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-semibold capitalize text-foreground">
                  {share.customerName || 'Unassigned'}
                  {share.destination && (
                    <span className="ml-1.5 font-normal capitalize text-muted-foreground">→ {share.destination}</span>
                  )}
                </span>
                <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                  {fmtQty(share.quantity)} {unit}
                  <span className="ml-1 font-normal text-muted-foreground">({pct}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}

        {split.unassigned > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-blue-500/20 pt-2 text-xs">
            <span className="font-normal italic text-muted-foreground">Not yet assigned</span>
            <span className="whitespace-nowrap font-semibold tabular-nums text-muted-foreground">
              {fmtQty(split.unassigned)} {unit}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
