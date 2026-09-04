/**
 * One truck, whole.
 *
 * The directory answers "which truck is the problem"; this page answers "what
 * is going on with this one", and a table row cannot hold the second answer —
 * not the motor boy's number, the road-worthiness date that lapsed last
 * month, and the entries that produced the balance, all at once.
 *
 * ── How it is laid out ───────────────────────────────────────────────────
 *
 * Money leads, two cards to a row, because that is what the truck is opened
 * for. The period selector sits directly above those cards and governs them
 * and the ledger at the foot of the page — and nothing else, because a
 * chassis number does not have a July value.
 *
 * Everything between is a spec sheet: label left in quiet type, value right
 * in bold, one row per fact, hairlines between. That rhythm is what makes a
 * page of forty small facts scannable — the eye runs down the right-hand
 * column reading only values, and drops left only when it needs the name of
 * the one it landed on. The earlier version stacked micro-labels above their
 * values in a grid, which gave every fact the same weight and produced a
 * field of grey with no way in.
 *
 * ── The ledger is the same ledger ────────────────────────────────────────
 *
 * Entries and running balance come from the fleet-ledger module, not from
 * arithmetic redone here. A detail page that totals a truck differently from
 * the ledger page is worse than one that does not exist.
 */

import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Pencil, Wallet, TrendingDown, TrendingUp, User, Users, UserPlus,
  AlertTriangle, ShieldCheck, ExternalLink, Gauge, FileText,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageHeader } from '#/components/PageHeader'
import { PageLoader } from '#/components/PageLoader'
import { PageEmpty } from '#/components/PageEmpty'
import { PhoneLink } from '#/components/ContactLink'
import { TruckDialog } from '#/components/TruckDialog'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  useFleetTruck, useFleetLedger, parseStatus, parseIncidents, isExpired,
  type LedgerEntry,
} from '#/lib/hooks/useFleet'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { byDate, isExpense, amountOf } from '#/routes/fleet-ledger/-fleet-ledger-data'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/fleet-trucks/details')({
  beforeLoad: () => routeGuard('/fleet-trucks'),
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: (search.id as string) || undefined,
  }),
  component: TruckDetailPage,
})

const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString('en-NG')}`
const signedNaira = (n: number) => (n < 0 ? `(${naira(Math.abs(n))})` : naira(n))
const signedTone = (n: number) =>
  n > 0 ? 'text-accent' : n < 0 ? 'text-destructive' : 'text-muted-foreground'

function TruckDetailPage() {
  const { id } = Route.useSearch()
  const navigate = useNavigate()
  const truckId = Number(id)

  const [preset, setPreset] = useState<DatePreset>('all')
  // Two dates, but one is optional: resolveRange reads a `from` with no `to`
  // as that single day, so "the 3rd" and "the 3rd to the 9th" are the same
  // control rather than two.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState(false)

  const { data: truck, isLoading } = useFleetTruck(Number.isFinite(truckId) ? truckId : null)
  const { data: allEntries = [] } = useFleetLedger()

  const range = useMemo(
    () => resolveRange(preset, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    }),
    [preset, from, to],
  )

  /** This truck's entries, oldest first — the order a running balance needs. */
  const entries = useMemo(
    () => allEntries.filter((e) => e.truck_id === truckId).sort(byDate),
    [allEntries, truckId],
  )

  const inRange = useMemo(
    () => entries.filter((e) => !range
      || isWithinInterval(new Date(e.entry_date), { start: range.from, end: range.to })),
    [entries, range],
  )

  // Balances run over the truck's whole history, not the filtered window: a
  // running balance that restarts at the top of an arbitrary period is not a
  // balance, it is a subtotal wearing the wrong label.
  const balances = useMemo(() => {
    const map = new Map<number, number>()
    let running = 0
    for (const e of entries) {
      running += isExpense(e) ? -amountOf(e) : amountOf(e)
      map.set(e.id, running)
    }
    return map
  }, [entries])

  const lifetime = balances.get(entries[entries.length - 1]?.id) ?? 0

  const money = useMemo(() => {
    let debits = 0
    let credits = 0
    for (const e of inRange) {
      if (isExpense(e)) debits += amountOf(e)
      else credits += amountOf(e)
    }
    return { debits, credits, balance: credits - debits, entries: inRange.length }
  }, [inRange])

  const status = parseStatus(truck?.truckStatus)
  const incidents = useMemo(() => parseIncidents(truck?.incidents), [truck?.incidents])

  if (isLoading) return <PageLoader message="Loading truck…" />
  if (!truck) {
    return (
      <PageEmpty
        title="Truck not found"
        description="It may have been removed. Go back to the directory to pick another."
      />
    )
  }

  const lapsed = isExpired(truck.insuranceExpiry) || isExpired(truck.roadWorthinessExpiry)

  // A custom window names itself: one date reads as that day, two as the
  // span. "Custom" on a total would tell the reader nothing about what they
  // are looking at.
  const customLabel = from && to && from !== to
    ? `${fmtDate(from)} – ${fmtDate(to)}`
    : fmtDate(from || to)
  const periodLabel = (preset === 'custom' && customLabel)
    || DATE_PRESETS.find((p) => p.value === preset)?.label
    || 'All time'

  return (
    <div className="animate-fade-in space-y-6">
      {/* No breadcrumb trail above this: it would end on the plate, and the
          heading directly beneath is the same plate again. The header's own
          back arrow is the way out, and it does not stutter.

          The plate is the heading, plainly — set in the page's display face
          rather than in mono, which at 30px reads as a code sample, and with
          no chips crowded onto the same line at heading size. The state of
          the truck belongs on the line underneath, at the size chips are
          actually drawn for. */}
      <PageHeader
        eyebrow="Transport"
        title={truck.plateNumber}
        description={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <StatusChip
              tone={status.rating === 'Bad' ? 'destructive' : status.rating === 'Fair' ? 'warning' : 'accent'}
            >
              {status.rating}
            </StatusChip>
            {!truck.isActive && <StatusChip tone="inert">Retired</StatusChip>}
            <span>
              {[
                truck.truckMake,
                truck.model,
                truck.maxCapacity ? `${Number(truck.maxCapacity).toLocaleString('en-NG')} L` : null,
              ].filter(Boolean).join(' · ') || 'No vehicle details on file'}
            </span>
          </span>
        }
        backAction={() => navigate({ to: '/fleet-trucks' })}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Lands on the ledger already filtered to this truck — a button
                that dumps you in the whole fleet's ledger is a small lie. */}
            <Button variant="outline" size="sm" asChild>
              <Link to="/fleet-ledger" search={{ truck: String(truck.id) }}>
                <FileText data-icon="inline-start" />
                Open ledger
              </Link>
            </Button>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" />
              Edit truck
            </Button>
          </div>
        }
      />

      {status.reason && (
        <p className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-semibold text-warning">Flagged {status.rating.toLowerCase()}</span>
            {' — '}{status.reason}
          </span>
        </p>
      )}

      {/* ── Money ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(MICRO, 'mr-1 text-muted-foreground')}>Money for</span>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value} type="button" onClick={() => setPreset(p.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                preset === p.value
                  ? 'border-accent/40 bg-accent/10 font-medium text-accent'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}

          {/* One date is a day, two are a span. Typing in either box switches
              off whichever preset was lit, so the chips never claim a period
              the figures are not actually showing. */}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border py-0.5 pr-1.5 pl-3 transition-colors duration-250 ease-luxe',
              preset === 'custom' ? 'border-accent/40 bg-accent/10' : 'border-border',
            )}
          >
            <span className={cn('text-xs', preset === 'custom' ? 'text-accent' : 'text-muted-foreground')}>
              Or
            </span>
            <Input
              type="date" value={from} aria-label="From"
              onChange={(e) => { setFrom(e.target.value); setPreset('custom') }}
              className="h-6 w-[8.5rem] border-transparent bg-transparent px-1.5 text-xs dark:bg-transparent"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date" value={to} aria-label="To"
              onChange={(e) => { setTo(e.target.value); setPreset('custom') }}
              className="h-6 w-[8.5rem] border-transparent bg-transparent px-1.5 text-xs dark:bg-transparent"
            />
            {preset === 'custom' && (
              <button
                type="button"
                onClick={() => { setFrom(''); setTo(''); setPreset('all') }}
                className="rounded-full px-1.5 text-xs text-muted-foreground transition-colors duration-250 ease-luxe outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Clear
              </button>
            )}
          </span>

          {preset === 'custom' && from && !to && (
            <span className="text-xs text-muted-foreground">
              A single day. Add a second date for a range.
            </span>
          )}
        </div>

        {/* Two to a row: these are four large figures, and four across turns
            each into a cramped column no wider than its own label. */}
        <StatCardGrid count={4} className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <StatCard
            tone="red" icon={<TrendingDown />} label="Total spend"
            value={naira(money.debits)}
            description={`${money.entries} entr${money.entries === 1 ? 'y' : 'ies'} · ${periodLabel}`}
          />
          <StatCard
            tone="green" icon={<TrendingUp />} label="Total earned"
            value={naira(money.credits)}
            description="Income credited to this truck"
          />
          <StatCard
            tone={money.balance < 0 ? 'red' : 'green'} icon={<Wallet />} label={`Balance · ${periodLabel}`}
            value={signedNaira(money.balance)} valueClassName={signedTone(money.balance)}
            description={money.balance < 0 ? 'It cost more than it earned' : 'It earned more than it cost'}
          />
          <StatCard
            tone={lifetime < 0 ? 'red' : 'green'} icon={<Gauge />} label="Lifetime balance"
            value={signedNaira(lifetime)} valueClassName={signedTone(lifetime)}
            description={`Across all ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
          />
        </StatCardGrid>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Crew ─────────────────────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Crew</span>
            {truck.driverId && (
              <Link
                to="/drivers/details"
                search={{ id: String(truck.driverId) }}
                className="inline-flex items-center gap-1 text-xs text-accent transition-opacity duration-250 ease-luxe hover:opacity-70"
              >
                Full driver record <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
          <div className={PANEL_BODY}>
            <div className="divide-y divide-foreground/[0.08]">
              <Person
                icon={<User className="size-4" />} role="Driver" primary
                name={truck.driverName} phones={[truck.driverPhone, truck.driverAltPhone]}
              />
              <Person
                icon={<Users className="size-4" />} role="Motor boy"
                name={truck.motorBoyName} phones={[truck.motorBoyPhone]}
              />
              <Person
                icon={<UserPlus className="size-4" />} role="Spare driver"
                name={truck.spareDriverName} phones={[truck.spareDriverPhone]}
              />
            </div>
          </div>
        </section>

        {/* ── Papers ───────────────────────────────────────────────────── */}
        <section className={cn(PANEL, lapsed && 'border-warning/40')}>
          <div className={cn(PANEL_RAIL, lapsed && 'border-warning/25')}>
            <span className={MICRO}>Papers</span>
            {lapsed
              ? <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                  <AlertTriangle className="size-3.5" /> Something has lapsed
                </span>
              : <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
                  <ShieldCheck className="size-3.5" /> All current
                </span>}
          </div>
          <div className={cn(PANEL_BODY, 'pt-2')}>
            <Expiry label="Insurance" value={truck.insuranceExpiry} />
            <Expiry label="Road worthiness" value={truck.roadWorthinessExpiry} />
            <Expiry label="Registration" value={truck.registrationExpiry} />
            <Expiry label="Next service due" value={truck.nextServiceDate} />
            <Row label="Last serviced" value={fmtDate(truck.lastServiceDate)} />
            <Row
              label="Next service mileage"
              value={truck.nextServiceMileage ? `${Number(truck.nextServiceMileage).toLocaleString('en-NG')} km` : null}
            />
          </div>
        </section>

        {/* ── Vehicle ──────────────────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}><span className={MICRO}>The vehicle</span></div>
          <div className={cn(PANEL_BODY, 'pt-2')}>
            <Row label="Make" value={truck.truckMake} />
            <Row label="Model" value={truck.model} />
            <Row label="Year" value={truck.year} />
            <Row label="Type" value={truck.truckType} />
            <Row label="Chassis number" value={truck.chassisNumber} mono />
            <Row label="VIN" value={truck.vin} mono />
            <Row
              label="Max capacity"
              value={truck.maxCapacity ? `${Number(truck.maxCapacity).toLocaleString('en-NG')} L` : null}
            />
            <Row
              label="Fuel capacity"
              value={truck.fuelCapacity ? `${Number(truck.fuelCapacity).toLocaleString('en-NG')} L` : null}
            />
            <Row
              label="Average per trip"
              value={truck.avgLitresPerTrip ? `${Number(truck.avgLitresPerTrip).toLocaleString('en-NG')} L` : null}
            />
            <Row
              label="Mileage"
              value={truck.mileage ? `${Number(truck.mileage).toLocaleString('en-NG')} km` : null}
            />
          </div>
        </section>

        {/* ── Incidents and notes ──────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Incidents &amp; notes</span>
            <span className="text-xs text-muted-foreground">
              {incidents.length === 0 ? 'None recorded' : `${incidents.length} on file`}
            </span>
          </div>
          <div className={cn(PANEL_BODY, 'space-y-4')}>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been logged against this truck.</p>
            ) : (
              <ul className="space-y-3">
                {incidents.map((incident, i) => (
                  <li key={i} className="border-l-2 border-destructive/40 pl-3">
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {fmtDate(incident.date) || 'Undated'}
                    </span>
                    <span className="block text-sm font-medium">{incident.description || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
            {truck.notes && (
              <div className={cn(incidents.length > 0 && 'border-t border-foreground/10 pt-4')}>
                <span className={cn(MICRO, 'block text-muted-foreground')}>Notes</span>
                <p className="mt-1.5 text-sm whitespace-pre-wrap">{truck.notes}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── This truck's ledger ────────────────────────────────────────── */}
      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            Ledger · {inRange.length} entr{inRange.length === 1 ? 'y' : 'ies'}
          </span>
          {inRange.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              <span className="font-medium text-destructive">{naira(money.debits)}</span> debit
              {' · '}
              <span className="font-medium text-accent">{naira(money.credits)}</span> credit
            </span>
          )}
        </div>
        {inRange.length === 0 ? (
          <PageEmpty
            title="No entries in this period"
            description="Widen the period above, or add an entry from the ledger page."
          />
        ) : (
          <div className="px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow className="border-foreground/15 hover:bg-transparent">
                  <TableHead className="text-sm font-medium">Date</TableHead>
                  <TableHead className="text-sm font-medium">Description</TableHead>
                  <TableHead className="text-sm font-medium">Category</TableHead>
                  <TableHead className="text-right text-sm font-medium text-destructive">Debit</TableHead>
                  <TableHead className="text-right text-sm font-medium text-accent">Credit</TableHead>
                  <TableHead className="text-right text-sm font-medium">Balance</TableHead>
                  <TableHead className="text-sm font-medium">Entered by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Newest first here, unlike the ledger's per-truck block: this
                    is a truck being checked on, and the recent entries are the
                    ones being checked. The balance column is unaffected — it
                    was computed in date order above. */}
                {[...inRange].reverse().map((e, i) => (
                  <LedgerLine key={e.id} entry={e} index={i} balance={balances.get(e.id) ?? 0} />
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="border-t-2 border-foreground/25 bg-muted/70 hover:bg-muted/70">
                  <TableCell className="py-3 font-semibold" colSpan={3}>
                    {periodLabel} total
                  </TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular-nums text-destructive">
                    {naira(money.debits)}
                  </TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular-nums text-accent">
                    {naira(money.credits)}
                  </TableCell>
                  <TableCell className={cn('py-3 text-right font-semibold tabular-nums', signedTone(money.balance))}>
                    {signedNaira(money.balance)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </tfoot>
            </Table>
          </div>
        )}
      </section>

      <TruckDialog truck={truck} open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function LedgerLine({
  entry, index, balance,
}: {
  entry: LedgerEntry
  index: number
  balance: number
}) {
  const expense = isExpense(entry)
  return (
    <TableRow className={cn('border-foreground/10', index % 2 === 1 && 'bg-foreground/[0.02]')}>
      <TableCell className="whitespace-nowrap tabular-nums">
        {format(new Date(entry.entry_date), 'd MMM yyyy')}
      </TableCell>
      <TableCell className="max-w-[24rem] truncate" title={entry.description || undefined}>
        {entry.description || '—'}
      </TableCell>
      <TableCell className="text-muted-foreground">{entry.category}</TableCell>
      <TableCell className="text-right font-medium tabular-nums text-destructive">
        {expense ? naira(entry.amount) : ''}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums text-accent">
        {expense ? '' : naira(entry.amount)}
      </TableCell>
      <TableCell className={cn('text-right tabular-nums', signedTone(balance))}>
        {signedNaira(balance)}
      </TableCell>
      <TableCell className="text-muted-foreground">{entry.entered_by || '—'}</TableCell>
    </TableRow>
  )
}

/**
 * One spec-sheet line: quiet label left, bold value right.
 *
 * The value carries the weight because it is the thing being looked up; the
 * label is only there to say what you found. Missing values stay unbolded and
 * muted, so an empty field reads as absent rather than as a fact.
 */
function Row({ label, value, mono }: { label: string; value?: unknown; mono?: boolean }) {
  const shown = value === null || value === undefined || value === '' ? null : String(value)
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-foreground/[0.07] py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-sm',
          mono && 'font-mono',
          shown ? 'font-semibold' : 'text-muted-foreground',
        )}
        title={shown ?? undefined}
      >
        {shown ?? '—'}
      </span>
    </div>
  )
}

/** A date that can already have passed, and says so where it stands. */
function Expiry({ label, value }: { label: string; value?: string | null }) {
  const gone = isExpired(value)
  const shown = fmtDate(value)
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-foreground/[0.07] py-2.5 last:border-0">
      <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {gone && <AlertTriangle className="size-3.5 text-warning" aria-label="Expired" />}
      </span>
      <span
        className={cn(
          'text-right text-sm tabular-nums',
          gone ? 'font-semibold text-warning' : shown ? 'font-semibold' : 'text-muted-foreground',
        )}
      >
        {shown ?? '—'}
        {gone && <span className="ml-1.5 text-xs font-normal">expired</span>}
      </span>
    </div>
  )
}

/**
 * A named person with the numbers you would actually ring.
 *
 * The driver reads a size larger than the other two: the crew has an order,
 * and flattening it would make the page ask you to work out which of three
 * equal names is the one who drives.
 */
function Person({
  icon, role, name, phones, primary,
}: {
  icon: React.ReactNode
  role: string
  name?: string | null
  phones: Array<string | null | undefined>
  primary?: boolean
}) {
  const numbers = phones.filter((p) => p && String(p).trim()) as string[]
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          'mt-0.5 flex shrink-0 items-center justify-center rounded-full',
          primary ? 'size-9 bg-accent/10 text-accent' : 'size-9 bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn(MICRO, 'block text-muted-foreground')}>{role}</span>
        <span
          className={cn(
            'block truncate',
            name ? 'font-semibold' : 'text-muted-foreground',
            primary ? 'text-base' : 'text-sm',
          )}
        >
          {name || 'Not assigned'}
        </span>
        {numbers.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {numbers.map((n) => (
              <PhoneLink key={n} value={n} className="text-sm text-muted-foreground" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const fmtDate = (raw?: string | null) => {
  if (!raw) return null
  // A bare yyyy-MM-dd is a calendar date, not an instant. Left to `new Date`
  // it parses as UTC midnight and renders as the day before anywhere west of
  // Greenwich, so it is read as local time instead.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw)
  return Number.isNaN(d.getTime()) ? null : format(d, 'd MMM yyyy')
}
