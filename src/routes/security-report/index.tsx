import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Truck, Droplets, FileSpreadsheet, FileText, Loader2, Search, X,
  LogIn, LogOut, Clock,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { useDepotsForFilter, usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import {
  useGateMovements, gateDriver, gateQuantity, timeOnSite, officerName,
  type GateMovement,
} from '#/lib/hooks/useGateMovements'
import {
  exportGateReportExcel, exportGateReportPdf, GATE_COLUMNS, GATE_NUMERIC, gateRowValues,
  type GateReportFilters,
} from './-gate-report-export'

export const Route = createFileRoute('/security-report/')({
  beforeLoad: () => routeGuard('/security-report'),
  component: SecurityReportPage,
})

const ALL = ''
const fmt = (n: unknown) => Number(n || 0).toLocaleString('en-NG')

/** 12-hour throughout, so a shift reads it the way it speaks it. */
const clock = (iso: string | null) => (iso ? format(new Date(iso), 'h:mm a') : null)

type FilterOption = { id?: string | number; _id?: string; name?: string; pfiNumber?: string; locationId?: string | number | null }
const idOf = (x: FilterOption) => String(x?.id ?? x?._id ?? '')

/**
 * The gate register.
 *
 * Every truck security handled — in, out, by whom, and everything recorded
 * about the load. It shows today on arrival: there is no "Run report" button
 * because there is no longer anything to wait for. The page used to fetch
 * every order in the book, guess which might hold a load in range, then issue
 * one request per candidate; a single endpoint does it now.
 *
 * Anchored on entry, not exit. A truck that came in and has not left is the
 * one an officer most needs to see, and keying the report on exit hid them
 * completely.
 */
function SecurityReportPage() {
  const [search, setSearch] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [customDate, setCustomDate] = useState('')
  const [locationId, setLocationId] = useState(ALL)
  const [pfiId, setPfiId] = useState(ALL)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const range = useMemo(
    () => resolveRange(datePreset, { from: customDate ? new Date(customDate) : undefined }),
    [datePreset, customDate],
  )
  const dateFrom = range ? range.from.toISOString() : undefined
  const dateTo = range ? range.to.toISOString() : undefined
  const periodLabel = datePreset === 'custom'
    ? (customDate ? format(new Date(customDate), 'd MMM yyyy') : 'Custom date')
    : (DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? 'All Time')

  const { data, isLoading, isError, error, refetch, isFetching } = useGateMovements({
    dateFrom,
    dateTo,
    depotId: locationId || undefined,
    pfiId: pfiId || undefined,
    search: search || undefined,
  })

  const { data: depots = [] } = useDepotsForFilter()
  const { data: pfiData } = usePfiList({ limit: 500 })
  const pfis: PfiWithFinancials[] = useMemo(() => pfiData?.pfis || [], [pfiData])

  const pfiOptions = useMemo(() => {
    if (!locationId) return pfis
    return pfis.filter((p) => String(p.locationId ?? '') === String(locationId))
  }, [pfis, locationId])

  const trucks = useMemo(() => data?.trucks || [], [data])
  const totals = data?.totals
  const hasFilters = !!(search || locationId || pfiId || datePreset !== 'today')

  const selectedDepot = useMemo(() => depots.find((d) => idOf(d) === locationId), [depots, locationId])
  const selectedPfi = useMemo(() => pfis.find((p) => idOf(p) === pfiId), [pfis, pfiId])

  const exportFilters: GateReportFilters = {
    periodLabel,
    dateFrom: range ? format(range.from, 'yyyy-MM-dd') : '',
    dateTo: range ? format(range.to, 'yyyy-MM-dd') : '',
    locationName: selectedDepot?.name || 'All locations',
    pfiNumber: selectedPfi?.pfiNumber || 'All PFIs',
    search,
  }

  const clearFilters = () => {
    setSearch(''); setLocationId(ALL); setPfiId(ALL); setDatePreset('today'); setCustomDate('')
  }

  const runExport = async (kind: 'excel' | 'pdf') => {
    if (!trucks.length || !totals) return
    setExporting(kind)
    try {
      if (kind === 'excel') await exportGateReportExcel(trucks, totals, exportFilters)
      else await exportGateReportPdf(trucks, totals, exportFilters)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Security"
        title="Gate register"
        description="Every truck security handled — when it came in, when it left, and who cleared it."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runExport('excel')} disabled={!trucks.length || exporting !== null}>
              {exporting === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => runExport('pdf')} disabled={!trucks.length || exporting !== null}>
              {exporting === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText data-icon="inline-start" />}
              PDF
            </Button>
          </div>
        }
      />

      {!isLoading && !isError && totals && (
        <StatCardGrid count={4}>
          <StatCard
            icon={<LogIn />} label="Trucks entered" value={fmt(totals.entered)}
            description={periodLabel}
          />
          <StatCard icon={<LogOut />} label="Trucks exited" value={fmt(totals.exited)} />
          {/* The only figure on this page that is about right now rather than
              about the period: what security still has inside. */}
          <StatCard
            tone={totals.onSite > 0 ? 'amber' : 'green'}
            icon={<Truck />} label="Still on site" value={fmt(totals.onSite)}
            description={totals.onSite > 0 ? 'Entered, not yet gated out' : 'Everything cleared'}
          />
          <StatCard
            icon={<Droplets />} label="Litres exited" value={fmt(totals.quantityExited)}
            description={`${fmt(totals.quantityEntered)} entered`}
          />
        </StatCardGrid>
      )}

      <FilterBar>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search truck number, driver, phone, loader, order or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <NativeSelect
          className="w-44"
          value={locationId}
          onChange={(e) => { setLocationId(e.target.value); setPfiId(ALL) }}
        >
          <option value={ALL}>All locations</option>
          {depots.map((d) => <option key={idOf(d)} value={idOf(d)}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect
          className="w-48"
          value={pfiId}
          onChange={(e) => {
            const next = e.target.value
            setPfiId(next)
            if (next) {
              const chosen = pfis.find((p) => idOf(p) === next)
              if (chosen?.locationId != null) setLocationId(String(chosen.locationId))
            }
          }}
        >
          <option value={ALL}>All PFIs</option>
          {pfiOptions.map((p) => <option key={idOf(p)} value={idOf(p)}>{p.pfiNumber}</option>)}
        </NativeSelect>
        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => { setDatePreset(p.value); setCustomDate('') }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                datePreset === p.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Input
          type="date"
          value={customDate}
          aria-label="Custom date"
          onChange={(e) => { setCustomDate(e.target.value); setDatePreset('custom') }}
          className="w-40"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>
            {totals
              ? `${fmt(totals.entered)} truck${totals.entered === 1 ? '' : 's'} · ${periodLabel}`
              : 'Gate register'}
          </span>
          {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        {isLoading ? (
          <PageLoader message="Loading the gate register…" />
        ) : isError ? (
          <PageError message={(error as Error)?.message || 'Failed to load'} onRetry={() => refetch()} />
        ) : trucks.length === 0 ? (
          <PageEmpty
            icon={<Truck />}
            title={hasFilters ? 'No trucks match those filters' : 'No trucks through the gate yet'}
            description={
              hasFilters
                ? 'Try widening the date range or clearing a filter.'
                : 'Trucks appear here the moment security gates them in.'
            }
          />
        ) : (
          <div className={cn(PANEL_BODY, 'overflow-x-auto p-0')}>
            <Table>
              <TableHeader>
                <TableRow>
                  {GATE_COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        c.key === 'sn' && 'w-10',
                        GATE_NUMERIC.has(c.key) && 'text-right',
                        'whitespace-nowrap',
                      )}
                    >
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trucks.map((t, i) => (
                  <GateRow key={t.id} truck={t} index={i} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* The hand-filled Daily Gate Report is commented out — it lives under
          My Report now, and having two places to produce the same document
          meant two versions of it going out. The component is gone rather
          than parked here: `git log -- src/routes/security-report` has it if
          it is ever wanted back on this page.
      <DailyGateReport … />
      */}
    </div>
  )
}

/**
 * One truck's row.
 *
 * The values come from gateRowValues — the same function both exports use —
 * so the screen and the sheet cannot say different things. Only the handful
 * of cells that carry extra meaning on screen are rendered specially.
 */
function GateRow({ truck, index }: { truck: GateMovement; index: number }) {
  const v = gateRowValues(truck, index) as Record<string, string | number>
  const driver = gateDriver(truck)
  const onSite = !truck.exitedAt

  const cells: Record<string, React.ReactNode> = {
    truck: <span className="font-mono whitespace-nowrap">{v.truck}</span>,
    driver: (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {driver.name || '—'}
        {/* The allocated driver and the one who turned up are both recorded.
            Where they differ that is worth seeing, not quietly resolving. */}
        {driver.swapped && (
          <Badge className="bg-warning/15 text-warning border-warning/30 font-normal" title={`Ticketed to ${truck.driverName}`}>
            swapped
          </Badge>
        )}
      </span>
    ),
    qty: <span className="whitespace-nowrap font-medium">{fmt(gateQuantity(truck))}</span>,
    ref: <span className="font-mono text-xs whitespace-nowrap text-accent">{v.ref}</span>,
    timeIn: <span className="whitespace-nowrap">{clock(truck.enteredAt)}</span>,
    timeOut: onSite
      ? <span className="text-muted-foreground">—</span>
      : <span className="whitespace-nowrap">{clock(truck.exitedAt)}</span>,
    enteredBy: (
      <span className="whitespace-nowrap">{officerName(truck.enteredByFirstName, truck.enteredBySurname) || '—'}</span>
    ),
    exitedBy: (
      <span className="whitespace-nowrap">{officerName(truck.exitedByFirstName, truck.exitedBySurname) || '—'}</span>
    ),
    onSite: onSite
      ? <span className="flex items-center gap-1.5 whitespace-nowrap text-warning"><Clock className="size-3" />On site</span>
      : <span className="whitespace-nowrap text-muted-foreground">{timeOnSite(truck)}</span>,
    status: onSite
      ? <Badge className="bg-warning/15 text-warning border-warning/30 font-normal">On site</Badge>
      : <Badge className="bg-success/15 text-success border-success/30 font-normal">Cleared</Badge>,
  }

  return (
    <TableRow className={cn(onSite && 'bg-warning/5 hover:bg-warning/10')}>
      {GATE_COLUMNS.map((c) => (
        <TableCell key={c.key} className={cn(GATE_NUMERIC.has(c.key) && 'text-right')}>
          {cells[c.key] ?? <span className="whitespace-nowrap">{v[c.key] ?? '—'}</span>}
        </TableCell>
      ))}
    </TableRow>
  )
}
