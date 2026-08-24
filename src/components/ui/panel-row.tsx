import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * A label/value line inside a PANEL.
 *
 * The dashboard's panels were built as a stack of identical rows — every
 * label and every figure at `text-sm font-semibold` — so a panel read as a
 * wall of equal facts with nothing to land on. Hierarchy here comes from
 * three things, in this order:
 *
 *   weight    the figure is semibold, the label is not
 *   colour    the label is muted, the figure is foreground
 *   size      only the `lead` row is larger, and there is at most one
 *
 * `tone` is reserved for figures whose state means something — money held,
 * money owed, money over. It is deliberately not available for decoration:
 * if every third row were coloured, none of them would read as a warning.
 *
 * Figures are tabular-nums so a column of them lines up on the decimal
 * rather than drifting by digit width.
 */
export type PanelRowTone = 'plain' | 'warning' | 'positive' | 'negative'

const TONE_CLASS: Record<PanelRowTone, string> = {
  plain: 'text-foreground',
  warning: 'text-warning',
  positive: 'text-accent',
  negative: 'text-destructive',
}

export interface PanelRowProps {
  label: React.ReactNode
  value: React.ReactNode
  /** A quiet second line under the label — units, a qualifier, a count. */
  hint?: React.ReactNode
  tone?: PanelRowTone
  /**
   * The one row in the panel that carries the headline figure. Larger and
   * tighter-tracked; use it once per panel or not at all.
   */
  lead?: boolean
  className?: string
}

export function PanelRow({
  label,
  value,
  hint,
  tone = 'plain',
  lead = false,
  className,
}: PanelRowProps) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 px-6',
        lead ? 'py-4' : 'py-3.5',
        className,
      )}
    >
      <div className="min-w-0">
        <span
          className={cn(
            'block truncate',
            lead ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground',
          )}
        >
          {label}
        </span>
        {hint && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          lead
            ? 'text-lg font-semibold tracking-[-0.01em]'
            : 'text-sm font-semibold',
          TONE_CLASS[tone],
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** The hairline-divided stack these rows live in. */
export function PanelRows({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div className={cn('divide-y divide-foreground/10', className)} {...props} />
}
