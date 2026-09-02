import { useState } from 'react'
import { CalendarDays, Check, X } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import { cn } from '#/lib/utils'

/**
 * Presets, plus any range you can name with two dates.
 *
 * These four were the whole of it: Today, This Week, This Month, This Year.
 * A question as ordinary as "how did last month go" or "what did we do over
 * that fortnight" could not be asked at all.
 *
 * The values match the presets lib/reportPeriod understands on the server, so
 * there is one vocabulary rather than a translation layer between them.
 */
const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
] as const

export type Period = (typeof PRESETS)[number]['value'] | 'custom'

/** What each preset is called before the server has answered. */
export const PERIOD_LABELS = Object.fromEntries(
  PRESETS.map((p) => [p.value, p.label]),
) as Record<string, string>

export interface PeriodValue {
  period: Period
  /** Only set when `period` is 'custom'. */
  from?: string
  to?: string
}

/** The query params to send. A custom range sends dates, a preset sends a name. */
export function periodParams(v: PeriodValue): Record<string, string> {
  if (v.period === 'custom' && v.from) {
    return { from: v.from, ...(v.to ? { to: v.to } : {}) }
  }
  return { period: v.period }
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export function PeriodFilter({
  value,
  onChange,
  className,
}: {
  value: PeriodValue
  onChange: (v: PeriodValue) => void
  className?: string
}) {
  const [open, setOpen] = useState(value.period === 'custom')
  const [from, setFrom] = useState(value.from ?? todayISO())
  const [to, setTo] = useState(value.to ?? todayISO())

  const applyCustom = () => {
    if (!from) return
    // Backwards is a slip, not a request for nothing — the server swaps them
    // too, but fixing it here keeps the inputs showing what was applied.
    const [a, b] = to && to < from ? [to, from] : [from, to]
    onChange({ period: 'custom', from: a, to: b || a })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <NativeSelect
        className="h-8 w-40 text-xs"
        value={value.period === 'custom' ? '' : value.period}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return
          setOpen(false)
          onChange({ period: v as Period })
        }}
      >
        {/* Present only while a custom range is applied, so the control shows
            what is actually in force rather than snapping to a preset that
            is not what the page is displaying. */}
        {value.period === 'custom' && <option value="">Custom range</option>}
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </NativeSelect>

      <Button
        variant={value.period === 'custom' ? 'default' : 'outline'}
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarDays className="size-3.5" />
        {value.period === 'custom' ? 'Change dates' : 'Pick dates'}
      </Button>

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-foreground/15 bg-background p-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">From</Label>
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={from}
              max={todayISO()}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">To</Label>
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={to}
              max={todayISO()}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={applyCustom} disabled={!from}>
            <Check className="size-3.5" />
            Apply
          </Button>
          {value.period === 'custom' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground"
              onClick={() => {
                setOpen(false)
                onChange({ period: 'month' })
              }}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
