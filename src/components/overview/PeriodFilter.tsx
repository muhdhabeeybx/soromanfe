import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
] as const

export type Period = (typeof PERIODS)[number]['value']

/**
 * The same labels the buttons carry, keyed by value. Page copy reads these
 * rather than waiting for the response to name the period, so a heading does
 * not rewrite itself the moment the request lands.
 */
export const PERIOD_LABELS = Object.fromEntries(
  PERIODS.map((p) => [p.value, p.label]),
) as Record<Period, string>

interface PeriodFilterProps {
  value: Period
  onChange: (period: Period) => void
  className?: string
}

export function PeriodFilter({ value, onChange, className }: PeriodFilterProps) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {PERIODS.map((p) => (
        <Button
          key={p.value}
          variant={value === p.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(p.value)}
          className="h-7 text-xs"
        >
          {p.label}
        </Button>
      ))}
    </div>
  )
}
