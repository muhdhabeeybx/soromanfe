/**
 * One truck, whole.
 *
 * The directory answers "which truck is the problem"; this page answers
 * "what is going on with this one" — and those are different enough that the
 * second question was previously answered nowhere. A row in a table can hold
 * a balance and a driver's name. It cannot hold the motor boy's phone number,
 * the road-worthiness date that lapsed last month, and the eleven ledger
 * entries that produced the balance, all at once.
 *
 * ── Money first ──────────────────────────────────────────────────────────
 *
 * Debits, credits and balance lead, because that is what the truck is opened
 * for, and they move with the period selector so the figures always describe
 * the entries listed underneath them. Everything else on the page — people,
 * vehicle, compliance — is a property of the truck and ignores the period
 * entirely; a chassis number does not have a July value.
 *
 * ── The ledger is the same ledger ────────────────────────────────────────
 *
 * The entries and the running balance come from the fleet-ledger module, not
 * from arithmetic redone here. A detail page that totals a truck differently
 * from the ledger page is worse than a detail page that does not exist.
 */

import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Pencil, Truck, Wallet, TrendingDown, TrendingUp, Phone, User, Users,
  AlertTriangle, ShieldCheck, ExternalLink, ArrowLeft, Gauge, FileText,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageHeader } from '#/components/PageHeader'
import { PageLoader } from '#/components/PageLoader'
import { PageEmpty } from '#/components/PageEmpty'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { SummaryCards } from '#/components/SummaryCards'
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
  const [editing, setEditing] = useState(false)

  const { data: truck, isLoading } = useFleetTruck(Number.isFinite(truckId) ? truckId : null)
  const { data: allEntries = [] } = useFleetLedger()

  const range = useMemo(() => resolveRange(preset), [preset])

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

  const cards = useMemo(() => [
    {
      title: 'Total spend', value: naira(money.debits), icon: <TrendingDown />, tone: 'red' as const,
      description: `${money.entries} entr${money.entries === 1 ? 'y' : 'ies'} in this period`,
    },
    {
      title: 'Total earned', value: naira(money.credits), icon: <TrendingUp />, tone: 'green' as const,
      description: 'Income credited to this truck',
    },
    {
      title: 'Balance', value: signedNaira(money.balance), icon: <Wallet />,
      tone: (money.balance < 0 ? 'red' : 'green') as 'red' | 'green',
      className: signedTone(money.balance),
      description: money.balance < 0 ? 'It cost more than it earned' : 'It earned more than it cost',
    },
    {
      title: 'Lifetime balance', value: signedNaira(balances.get(entries[entries.length - 1]?.id) ?? 0),
      icon: <Gauge />,
      tone: ((balances.get(entries[entries.length - 1]?.id) ?? 0) < 0 ? 'red' : 'green') as 'red' | 'green',
      description: `Across all ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    },
  ], [money, balances, entries])

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

  return (
    <div className="animate-fade-in space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Fleet Directory', href: '/fleet-trucks' },
          { label: String(truck.plateNumber || '—') },
        ]}
      />

      <PageHeader
        eyebrow="Transport"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{truck.plateNumber}</span>
            <StatusChip
              tone={status.rating === 'Bad' ? 'destructive' : status.rating === 'Fair' ? 'warning' : 'accent'}
            >
              {status.rating}
            </StatusChip>
            {!truck.isActive && <StatusChip tone="inert">Retired</StatusChip>}
          </span>
        }
        description={
          [truck.truckMake, truck.model, truck.maxCapacity ? `${truck.maxCapacity}L` : null]
            .filter(Boolean).join(' · ') || 'No vehicle details on file'
        }
        backAction={() => navigate({ to: '/fleet-trucks' })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/fleet-ledger">
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
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {status.reason}
        </p>
      )}

      {/* Period applies to the money and the ledger below it, and to nothing
          else on the page — the rest is not a per-period fact. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(MICRO, 'text-muted-foreground')}>Money for</span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value} type="button" onClick={() => setPreset(p.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              preset === p.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <SummaryCards cards={cards} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── People ───────────────────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Who runs it</span>
            {truck.driverId && (
              <Link
                to="/drivers/details"
                search={{ id: String(truck.driverId) }}
                className="inline-flex items-center gap-1 text-xs text-accent transition-opacity duration-250 ease-luxe hover:opacity-70"
              >
                Driver record <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
          <div className={cn(PANEL_BODY, 'space-y-4')}>
            <Person
              icon={<User className="size-3.5" />} role="Driver"
              name={truck.driverName} phone={truck.driverPhone} altPhone={truck.driverAltPhone}
            />
            <Person
              icon={<Users className="size-3.5" />} role="Motor boy"
              name={truck.motorBoyName} phone={truck.motorBoyPhone}
            />
            <Person
              icon={<User className="size-3.5" />} role="Spare driver"
              name={truck.spareDriverName} phone={truck.spareDriverPhone}
            />
          </div>
        </section>

        {/* ── Vehicle ──────────────────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}><span className={MICRO}>The vehicle</span></div>
          <div className={cn(PANEL_BODY, 'grid gap-x-6 gap-y-3 sm:grid-cols-2')}>
            <Detail label="Make" value={truck.truckMake} />
            <Detail label="Model" value={truck.model} />
            <Detail label="Year" value={truck.year} />
            <Detail label="Type" value={truck.truckType} />
            <Detail label="Chassis number" value={truck.chassisNumber} mono />
            <Detail label="VIN" value={truck.vin} mono />
            <Detail label="Max capacity" value={truck.maxCapacity ? `${truck.maxCapacity} L` : null} />
            <Detail label="Fuel capacity" value={truck.fuelCapacity ? `${truck.fuelCapacity} L` : null} />
            <Detail label="Avg litres per trip" value={truck.avgLitresPerTrip} />
            <Detail label="Mileage" value={truck.mileage ? Number(truck.mileage).toLocaleString('en-NG') : null} />
          </div>
        </section>

        {/* ── Compliance ───────────────────────────────────────────────── */}
        <section className={cn(PANEL, lapsed && 'border-warning/40')}>
          <div className={cn(PANEL_RAIL, lapsed && 'border-warning/25')}>
            <span className={MICRO}>Papers</span>
            {lapsed
              ? <span className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> Something has lapsed
                </span>
              : <span className="flex items-center gap-1.5 text-xs text-accent">
                  <ShieldCheck className="size-3.5" /> Current
                </span>}
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-x-6 gap-y-3 sm:grid-cols-2')}>
            <Expiry label="Insurance" value={truck.insuranceExpiry} />
            <Expiry label="Road worthiness" value={truck.roadWorthinessExpiry} />
            <Expiry label="Registration" value={truck.registrationExpiry} />
            <Expiry label="Next service" value={truck.nextServiceDate} />
            <Detail label="Last service" value={fmtDate(truck.lastServiceDate)} />
            <Detail label="Next service mileage" value={truck.nextServiceMileage} />
          </div>
        </section>

        {/* ── Incidents and notes ──────────────────────────────────────── */}
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Incidents</span>
            <span className="text-xs text-muted-foreground">
              {incidents.length === 0 ? 'None recorded' : `${incidents.length} on file`}
            </span>
          </div>
          <div className={cn(PANEL_BODY, 'space-y-3')}>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been logged against this truck.</p>
            ) : (
              <ul className="space-y-3">
                {incidents.map((incident, i) => (
                  <li key={i} className="border-l-2 border-destructive/40 pl-3">
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {fmtDate(incident.date) || 'Undated'}
                    </span>
                    <span className="block text-sm">{incident.description || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
            {truck.notes && (
              <div className="border-t border-foreground/10 pt-3">
                <span className={cn(MICRO, 'block text-muted-foreground')}>Notes</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{truck.notes}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── This truck's ledger ────────────────────────────────────────── */}
      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            {inRange.length} entr{inRange.length === 1 ? 'y' : 'ies'}
          </span>
          {inRange.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              <span className="text-destructive">{naira(money.debits)} debit</span>
              {' · '}
              <span className="text-accent">{naira(money.credits)} credit</span>
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
                    Period total
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

      <TruckDialog
        truck={truck}
        open={editing}
        onOpenChange={setEditing}
      />
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

/** A named person with the numbers you would actually ring. */
function Person({
  icon, role, name, phone, altPhone,
}: {
  icon: React.ReactNode
  role: string
  name?: string | null
  phone?: string | null
  altPhone?: string | null
}) {
  const numbers = [phone, altPhone].filter(Boolean) as string[]
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <span className={cn(MICRO, 'block text-muted-foreground')}>{role}</span>
        <span className="block truncate text-sm font-medium">
          {name || <span className="font-normal text-muted-foreground">Not assigned</span>}
        </span>
        {numbers.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {numbers.map((n) => (
              // tel: because the number on this page is there to be called,
              // usually from the phone the page is open on.
              <a
                key={n} href={`tel:${n}`}
                className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground transition-colors duration-250 ease-luxe hover:text-accent"
              >
                <Phone className="size-3" />{n}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value?: unknown; mono?: boolean }) {
  const shown = value === null || value === undefined || value === '' ? null : String(value)
  return (
    <div className="min-w-0">
      <span className={cn(MICRO, 'block text-muted-foreground')}>{label}</span>
      <span className={cn('block truncate text-sm', mono && 'font-mono', !shown && 'text-muted-foreground')}>
        {shown ?? '—'}
      </span>
    </div>
  )
}

const fmtDate = (raw?: string | null) => {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : format(d, 'd MMM yyyy')
}

/** A date that can be in the past, and says so. */
function Expiry({ label, value }: { label: string; value?: string | null }) {
  const gone = isExpired(value)
  return (
    <div className="min-w-0">
      <span className={cn(MICRO, 'flex items-center gap-1.5 text-muted-foreground')}>
        {label}
        {gone && <AlertTriangle className="size-3 text-warning" aria-label="Expired" />}
      </span>
      <span className={cn('block truncate text-sm tabular-nums', gone ? 'text-warning' : !value && 'text-muted-foreground')}>
        {fmtDate(value) ?? '—'}
      </span>
    </div>
  )
}
