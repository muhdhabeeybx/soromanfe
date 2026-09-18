import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format, parseISO, startOfMonth, subDays } from 'date-fns'
import {
  Banknote, Droplets, FileSpreadsheet, FileText, Loader2, Pencil, RotateCcw,
  Scale, TrendingDown, TrendingUp, X,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { useDepotsForFilter, usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import {
  useCfoReport, useSaveCfoEntry, useResetCfoEntry, verifiableShare, unitsOf,
  CFO_OVERRIDE_FIELDS,
  type CfoDay, type CfoRow, type CfoOverrideField, type CfoEntryPayload,
} from '#/lib/hooks/useCfoReport'
import {
  CFO_CORE_COLUMNS, CFO_NUMERIC, cfoRowValues, cfoTotalValues, cfoDisplay,
  quantityAcrossUnits, unitShort, drawnDownShare, moneyState, MONEY_STATE_LABEL,
  rowRemark, nairaCompact,
} from './-cfo-columns'
import { exportCfoReportExcel, exportCfoReportPdf, type CfoExportFilters } from './-cfo-report-export'

export const Route = createFileRoute('/cfo-report/')({
  beforeLoad: () => routeGuard('/cfo-report'),
  component: CfoReportPage,
})

const ALL = ''
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * The ranges this report is actually read over.
 *
 * Deliberately not the shared DATE_PRESETS: two of those are "This Year" and
 * "All Time", and this document is one block per day. A year is 365 blocks
 * and all time is a request the server refuses — offering either would be
 * offering a button that does not work.
 */
const RANGES: Array<{ value: string; label: string; resolve: () => { from: string; to: string } }> = [
  { value: 'today', label: 'Today', resolve: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
  {
    value: 'yesterday',
    label: 'Yesterday',
    resolve: () => ({ from: iso(subDays(new Date(), 1)), to: iso(subDays(new Date(), 1)) }),
  },
  {
    value: 'week',
    label: 'Last 7 days',
    resolve: () => ({ from: iso(subDays(new Date(), 6)), to: iso(new Date()) }),
  },
  {
    value: 'month',
    label: 'This month',
    resolve: () => ({ from: iso(startOfMonth(new Date())), to: iso(new Date()) }),
  },
]

type FilterOption = { id?: string | number; _id?: string; name?: string; pfiNumber?: string; locationId?: string | number | null }
const idOf = (x: FilterOption) => String(x?.id ?? x?._id ?? '')

/**
 * Money in full, and money at a glance — both from -cfo-columns, so the page
 * and the two exports cannot format the same figure two ways.
 *
 * Kobo appears only where there is kobo: 5 rows in the whole book carry any,
 * and a forced ".00" on three money columns is noise at ₦32bn scale.
 */
const ngn = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const ngnShort = (n: number) => nairaCompact(n)

/**
 * The CFO report.
 *
 * Depot sales per PFI, one block per day: what the cargo started with, what
 * has gone off it, what went today, what is left, what that came to, what
 * reached the bank, and the gap between the last two.
 *
 * Every figure is computed — see Sman-Backend/services/cfoReport.service.js
 * for the full account of each column — and every figure except the two
 * derived ones can be corrected in place. A corrected cell is marked and
 * still carries what the system said, because a report that can be edited and
 * does not say where is not an audit document.
 */
function CfoReportPage() {
  const [range, setRange] = useState('today')
  const initial = RANGES[0].resolve()
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [locationId, setLocationId] = useState(ALL)
  const [pfiId, setPfiId] = useState(ALL)
  const [includeAll, setIncludeAll] = useState(false)
  const [editing, setEditing] = useState<CfoRow | null>(null)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  /**
   * The server caps the range at 366 days, and a rejected request arrives as
   * "Request failed with status code 400" — which on a page of date controls
   * reads as a broken report rather than as a range that is too wide. Caught
   * here so the page can say what is actually wrong, and the request is not
   * sent at all.
   */
  const rangeDays =
    dateFrom && dateTo
      ? Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1
      : 0
  const rangeTooWide = rangeDays > 366

  const { data, isLoading, isError, error, refetch, isFetching } = useCfoReport(
    {
      dateFrom,
      dateTo,
      depotId: locationId || undefined,
      pfiId: pfiId || undefined,
      includeAll,
    },
    !rangeTooWide,
  )

  const { data: depots = [] } = useDepotsForFilter()
  const { data: pfiData } = usePfiList({ limit: 500 })
  const pfis: PfiWithFinancials[] = useMemo(() => pfiData?.pfis || [], [pfiData])
  const pfiOptions = useMemo(
    () => (locationId ? pfis.filter((p) => String(p.locationId ?? '') === String(locationId)) : pfis),
    [pfis, locationId],
  )

  const applyRange = (value: string) => {
    setRange(value)
    const preset = RANGES.find((r) => r.value === value)
    if (!preset) return
    const next = preset.resolve()
    setDateFrom(next.from)
    setDateTo(next.to)
  }

  const days = data?.days || []
  const totals = data?.totals
  const meta = data?.meta
  const hasRows = days.some((d) => d.rows.length > 0)

  const selectedDepot = useMemo(() => depots.find((d) => idOf(d) === locationId), [depots, locationId])
  const selectedPfi = useMemo(() => pfis.find((p) => idOf(p) === pfiId), [pfis, pfiId])

  const periodLabel =
    dateFrom === dateTo
      ? format(parseISO(dateFrom), 'd MMMM yyyy')
      : `${format(parseISO(dateFrom), 'd MMM yyyy')} — ${format(parseISO(dateTo), 'd MMM yyyy')}`

  const exportFilters: CfoExportFilters = {
    periodLabel,
    locationName: selectedDepot?.name || 'All locations',
    pfiNumber: selectedPfi?.pfiNumber || 'All PFIs',
    includeAll,
  }

  const runExport = async (kind: 'excel' | 'pdf') => {
    if (!data || !hasRows) return
    setExporting(kind)
    try {
      if (kind === 'excel') await exportCfoReportExcel(data, exportFilters)
      else await exportCfoReportPdf(data, exportFilters)
    } finally {
      setExporting(null)
    }
  }

  const hasFilters = !!(locationId || pfiId || includeAll || range !== 'today')
  const clearFilters = () => {
    setLocationId(ALL); setPfiId(ALL); setIncludeAll(false); applyRange('today')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Finance"
        title="CFO report"
        description="Depot sales per PFI, day by day — stock drawn down, value invoiced, and whether the money is in the bank."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runExport('excel')} disabled={!hasRows || exporting !== null}>
              {exporting === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => runExport('pdf')} disabled={!hasRows || exporting !== null}>
              {exporting === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText data-icon="inline-start" />}
              PDF
            </Button>
          </div>
        }
      />

      {/* Two across rather than four: at four, each figure is squeezed into a
          quarter-width tile and "₦82,136,400,000" has to be abbreviated past
          the point of being checkable. */}
      {!isLoading && !isError && totals && (
        <StatCardGrid count={4} className="grid-cols-1 sm:grid-cols-2">
          <StatCard
            icon={<Droplets />}
            label="Volume sold in period"
            value={
              Object.entries(totals.periodByUnit || {})
                .filter(([, v]) => v !== 0)
                .map(([unit, v]) => `${Math.round(v).toLocaleString('en-NG')} ${unitShort(unit)}`)
                .join(' · ') || '0'
            }
            description={`${totals.rows} PFI${totals.rows === 1 ? '' : 's'} on the closing day`}
          />
          <StatCard
            icon={<Scale />}
            label="Stock balance"
            value={quantityAcrossUnits(totals, (u) => u.stockBalance)}
            description={`of ${quantityAcrossUnits(totals, (u) => u.initialQty)} landed`}
          />
          <StatCard
            icon={<Banknote />}
            label="Bank inflow confirmed"
            value={ngnShort(totals.bankInflow)}
            description={`against ${ngnShort(totals.salesValue)} invoiced`}
          />
          {/* The only card that can be either way, so the only one that is
              allowed to be red or green. See report-theme. */}
          <StatCard
            tone={totals.surplusDeficit < 0 ? 'red' : 'green'}
            icon={totals.surplusDeficit < 0 ? <TrendingDown /> : <TrendingUp />}
            label={totals.surplusDeficit < 0 ? 'Deficit' : 'Surplus'}
            value={ngnShort(totals.surplusDeficit)}
            description={totals.surplusDeficit < 0 ? 'Owed on sales already booked' : 'Held beyond what was invoiced'}
          />
        </StatCardGrid>
      )}

      <FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => applyRange(r.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                range === r.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            aria-label="From date"
            max={dateTo}
            onChange={(e) => { setDateFrom(e.target.value); setRange('custom') }}
            className="w-40"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            aria-label="To date"
            min={dateFrom}
            onChange={(e) => { setDateTo(e.target.value); setRange('custom') }}
            className="w-40"
          />
        </div>
        <NativeSelect
          className="w-44"
          value={locationId}
          aria-label="Location"
          onChange={(e) => { setLocationId(e.target.value); setPfiId(ALL) }}
        >
          <option value={ALL}>All locations</option>
          {depots.map((d) => <option key={idOf(d)} value={idOf(d)}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect
          className="w-48"
          value={pfiId}
          aria-label="PFI"
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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--accent)]"
            checked={includeAll}
            onChange={(e) => setIncludeAll(e.target.checked)}
          />
          Include PFIs not trading
        </label>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      {rangeTooWide ? (
        <PageEmpty
          icon={<Scale />}
          title="That range is too wide"
          description={`This report is one block per day, so it is limited to 366 days. You have asked for ${rangeDays.toLocaleString('en-NG')}.`}
        />
      ) : isLoading ? (
        <PageLoader message="Building the report…" />
      ) : isError ? (
        <PageError message={(error as Error)?.message || 'Failed to load'} onRetry={() => refetch()} />
      ) : !hasRows ? (
        <PageEmpty
          icon={<Scale />}
          title="No PFIs trading in this period"
          description={
            includeAll
              ? 'No PFI had started trading by these dates. Try widening the range.'
              : 'Try widening the date range, clearing a filter, or ticking “Include PFIs not trading”.'
          }
        />
      ) : (
        <div className="space-y-6">
          {isFetching && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Refreshing…
            </div>
          )}
          {days.map((d) => (
            <DaySection key={d.date} day={d} onEdit={setEditing} />
          ))}
        </div>
      )}

      {meta && hasRows && <ReportNotes meta={meta} />}

      {/* Keyed on the cell being corrected, so moving to another row
          remounts the form with that row's values. The alternative — an
          effect that copies the row into state — is a cascading render and
          leaves whatever was half-typed in the boxes if it ever misses. */}
      {editing && (
        <EditRowDialog
          key={`${editing.pfiId}|${editing.date}`}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * One day's block: a heading that names the date, the table, and a total row
 * closing it off.
 *
 * Every day in the range gets a block, including the quiet ones. A silent gap
 * reads as a page that failed to load; "No PFIs trading on this date" is
 * an answer.
 */
function DaySection({ day, onEdit }: { day: CfoDay; onEdit: (row: CfoRow) => void }) {
  const { values: totalValues, unit } = cfoTotalValues(day.totals, 'Day total')
  const units = unitsOf(day.totals)

  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium">{format(parseISO(day.date), 'EEEE, d MMMM yyyy')}</span>
          <span className={cn(MICRO, 'text-muted-foreground')}>
            {day.rows.length} PFI{day.rows.length === 1 ? '' : 's'}
          </span>
        </div>
        {day.rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Sold today: {quantityAcrossUnits(day.totals, (u) => u.dayVolume)}
          </span>
        )}
      </div>

      {day.rows.length === 0 ? (
        <div className={cn(PANEL_BODY, 'text-sm text-muted-foreground')}>
          No PFIs trading on this date.
        </div>
      ) : (
        <div className={cn(PANEL_BODY, 'overflow-x-auto p-0')}>
          <Table>
            <TableHeader>
              <TableRow>
                {CFO_CORE_COLUMNS.map((c) => (
                  <TableHead
                    key={c.key}
                    className={cn(
                      c.key === 'sn' && 'w-10',
                      CFO_NUMERIC.has(c.key) && 'text-right',
                      'whitespace-nowrap',
                    )}
                  >
                    {c.header}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {day.rows.map((row, i) => (
                <CfoTableRow key={row.pfiId} row={row} index={i} onEdit={onEdit} />
              ))}

              {/* The day's total, tinted rather than bordered — a tint means
                  "this is a total", which is the only thing it ever means. */}
              <TableRow className="bg-muted/50 font-medium">
                {CFO_CORE_COLUMNS.map((c) => {
                  const value = totalValues[c.key]
                  return (
                    <TableCell
                      key={c.key}
                      className={cn(CFO_NUMERIC.has(c.key) && 'text-right tabular-nums', 'whitespace-nowrap')}
                    >
                      {value === null ? (
                        // Litres and kilogrammes have no sum. The per-unit
                        // figures are stated under the table instead.
                        <span className="text-muted-foreground">—</span>
                      ) : c.kind === 'signed' ? (
                        <Signed value={Number(value)} />
                      ) : (
                        cfoDisplay(c, value, unit || 'Litres')
                      )}
                    </TableCell>
                  )
                })}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>

          {units.length > 1 && (
            <div className="border-t border-foreground/15 px-6 py-3 text-xs text-muted-foreground">
              Quantities are not totalled across units.{' '}
              {units.map((u) => {
                const q = day.totals.byUnit[u]
                return (
                  <span key={u} className="mr-4">
                    <span className="font-medium text-foreground">{unitShort(u)}</span>
                    {' — sold today '}
                    {Math.round(q.dayVolume).toLocaleString('en-NG')}
                    {', balance '}
                    {Math.round(q.stockBalance).toLocaleString('en-NG')}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Money that carries meaning in its sign, coloured the same way everywhere. */
function Signed({ value }: { value: number }) {
  const text =
    value < 0
      ? `(₦${Math.abs(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
      : ngn(value)
  return (
    <span className={cn('whitespace-nowrap', value < 0 ? 'text-destructive' : value > 0 ? 'text-success' : '')}>
      {text}
    </span>
  )
}

/**
 * One PFI on one day.
 *
 * A corrected cell is marked and carries what the system said in its title,
 * so the row can be read as a correction rather than as an unexplained figure.
 */
function CfoTableRow({ row, index, onEdit }: { row: CfoRow; index: number; onEdit: (row: CfoRow) => void }) {
  const values = cfoRowValues(row, index)
  const share = verifiableShare(row)
  const drawn = drawnDownShare(row)
  const state = moneyState(row)
  const remark = rowRemark(row)

  return (
    <TableRow className={cn(row.edited.length > 0 && 'bg-blue-50/40 dark:bg-blue-950/20')}>
      {CFO_CORE_COLUMNS.map((c) => {
        const corrected = !!c.field && row.edited.includes(c.field)
        const content =
          c.kind === 'signed' ? (
            <span className="inline-flex flex-col items-end gap-1">
              <Signed value={Number(values[c.key])} />
              {/*
                The state in a word as well as a colour. Red and green are the
                palette's reserved pair for signed money, and a reader who
                cannot tell them apart — or who printed this in mono — gets
                nothing from the colour alone.
              */}
              <StatusChip
                fill="solid"
                tone={state === 'deficit' ? 'destructive' : state === 'surplus' ? 'accent' : 'inert'}
                className="text-[10px]"
              >
                {MONEY_STATE_LABEL[state]}
              </StatusChip>
            </span>
          ) : c.key === 'pfi' ? (
            <span className="whitespace-nowrap font-mono text-xs">{row.pfiNumber}</span>
          ) : c.key === 'stockBalance' ? (
            /*
              The figure, with how drawn down the PFI is drawn underneath it.
              One hue on a muted track, never red or green: a cargo that has
              sold out is a success, and colouring an empty tank like a loss
              would say the opposite of what happened. The number above is the
              bar's label, so it carries none of its own.
            */
            <span className="block">
              <span className="whitespace-nowrap">
                {cfoDisplay(c, values[c.key], row.productUnit)}
              </span>
              {drawn !== null && (
                <span
                  className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-foreground/10"
                  role="img"
                  aria-label={`${Math.round(drawn * 100)}% of this PFI has been sold`}
                  title={`${Math.round(drawn * 100)}% sold · ${cfoDisplay(c, values[c.key], row.productUnit)} left of ${Math.round(row.initialQty).toLocaleString('en-NG')} ${unitShort(row.productUnit)}`}
                >
                  <span
                    className="block h-full rounded-full bg-accent/70"
                    style={{ width: `${Math.max(drawn * 100, drawn > 0 ? 2 : 0)}%` }}
                  />
                </span>
              )}
            </span>
          ) : c.key === 'remarks' ? (
            /*
              A remark the row wrote about itself is muted and italic; one a
              person typed is neither. On a document people sign off, a
              generated sentence that looks like a colleague's is worse than
              an empty cell.
            */
            <span
              className={cn('block max-w-[30ch]', remark.auto && 'italic text-muted-foreground')}
              title={remark.auto ? `${remark.text}\n\nGenerated from this row's own figures. Nobody typed this.` : remark.text}
            >
              {remark.text}
            </span>
          ) : c.key === 'bankInflow' && share !== null && share < 0.999 ? (
            // How much of this money an external auditor could tie to a bank
            // statement. The rest is legacy wallet-era money and transfers
            // between orders — real, recorded, and not checkable.
            <span className="whitespace-nowrap">
              {cfoDisplay(c, values[c.key], row.productUnit)}
              <span className="block text-[11px] text-muted-foreground">
                {Math.round(share * 100)}% bank-backed
              </span>
            </span>
          ) : (
            <span className="whitespace-nowrap">{cfoDisplay(c, values[c.key], row.productUnit)}</span>
          )

        return (
          <TableCell
            key={c.key}
            className={cn(
              CFO_NUMERIC.has(c.key) && 'text-right tabular-nums',
              c.key === 'remarks' && 'align-top',
              corrected && 'font-medium text-blue-700 dark:text-blue-300',
            )}
            title={
              corrected && c.field
                ? `Corrected. System figure: ${cfoDisplay(c, row.computed[c.field], row.productUnit)}${row.updatedByName ? ` · by ${row.updatedByName}` : ''}`
                : undefined
            }
          >
            {content}
          </TableCell>
        )
      })}
      <TableCell className="text-right align-top">
        <Button variant="ghost" size="sm" onClick={() => onEdit(row)} aria-label={`Edit ${row.pfiNumber}`}>
          <Pencil className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
}

/**
 * What this report leaves out, printed under it rather than kept in a ticket.
 *
 * Both figures are money that exists and that the report does not count. A
 * reader laying this beside the audited Finance Report will find exactly
 * these differences, so the page states them itself.
 */
function ReportNotes({ meta }: { meta: NonNullable<ReturnType<typeof useCfoReport>['data']>['meta'] }) {
  return (
    <section className={cn(PANEL, 'border-foreground/10')}>
      <div className={PANEL_RAIL}>
        <span className={cn(MICRO, 'text-muted-foreground')}>How to read this report</span>
      </div>
      <div className={cn(PANEL_BODY, 'space-y-2 text-xs text-muted-foreground')}>
        <p>
          A sale is an order whose payment is confirmed, counted on the day the order was placed —
          the same rule the PFI page and the Finance Report use, so the three reconcile.
          Dates are {meta.timezone} calendar days.
        </p>
        <p>
          <span className="font-medium text-foreground">Stock balance</span> = initial qty −
          cumulative sales volume. <span className="font-medium text-foreground">Surplus / (deficit)</span> =
          bank inflow − sales value. Both are derived from the cells beside them and cannot be typed
          over, so a row always adds up.
        </p>
        <p>
          A <span className="italic">remark set in italics</span> was written by the row from its own
          figures — nobody typed it. Type one and it replaces the generated sentence outright and is
          shown in plain text. The bar under a stock balance shows how much of that PFI has sold.
        </p>
        {meta.partPaidHeld > 0 && (
          <p>
            <span className="font-medium text-foreground">Excluded — part-paid orders:</span>{' '}
            {ngn(meta.partPaidHeld)} across {meta.partPaidOrders} order(s). Counted on neither side:
            not yet a confirmed sale, so neither its litres nor its money appear above.
          </p>
        )}
        {meta.duplicatesExcluded > 0 && (
          <p>
            <span className="font-medium text-foreground">Excluded — duplicate payment rows:</span>{' '}
            {ngn(meta.duplicatesExcluded)} across {meta.duplicateRows} row(s) left by migration 0021.
            The Finance Report is audited against figures that include these and does not move; this
            report reads past them.
          </p>
        )}
      </div>
    </section>
  )
}

// ── Correcting a row ────────────────────────────────────────────────────────

const FIELD_LABELS: Record<CfoOverrideField, string> = {
  initialQty: 'Initial qty',
  cumulativeVolume: 'Cumulative sales volume',
  dayVolume: 'Sales volume for the day',
  salesValue: 'Sales value to date',
  bankInflow: 'Bank inflow confirmed',
}

const QUANTITY_FIELDS = new Set<CfoOverrideField>(['initialQty', 'cumulativeVolume', 'dayVolume'])

/** A typed figure back to a number: commas out, a lone minus is not yet one. */
function parseFigure(text: string): number | null {
  const cleaned = text.replace(/[,\s₦]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * The correction form.
 *
 * Every field opens EMPTY with the system's figure as its placeholder, not
 * pre-filled with it. Pre-filling would make saving a remark silently write
 * five overrides holding today's computed values — which would then never
 * move again as the book changed, and nobody would know the row had been
 * frozen. Empty means "the system's figure stands", which is exactly what the
 * null in the database means.
 *
 * The two derived figures are shown live off whatever is in the form, so the
 * arithmetic is visible while it is being corrected rather than after.
 */
function EditRowDialog({ row, onClose }: { row: CfoRow; onClose: () => void }) {
  const save = useSaveCfoEntry()
  const reset = useResetCfoEntry()
  // Seeded once, from the row this dialog was mounted for. A saved override
  // comes back as text to edit; everything else opens empty, meaning "the
  // system's figure stands".
  const [fields, setFields] = useState<Record<CfoOverrideField, string>>(() => {
    const seed = blankFields()
    for (const f of CFO_OVERRIDE_FIELDS) {
      if (row.edited.includes(f)) seed[f] = String(row[f])
    }
    return seed
  })
  const [remarks, setRemarks] = useState(row.remarks || '')

  const effective = (f: CfoOverrideField) => {
    const typed = parseFigure(fields[f])
    return typed === null ? row.computed[f] : typed
  }
  const stockBalance = effective('initialQty') - effective('cumulativeVolume')
  const surplusDeficit = effective('bankInflow') - effective('salesValue')

  const onSave = () => {
    /**
     * Every override is sent on every save, as a number or as null.
     *
     * Sending only what changed would need this form to track what "changed"
     * means against three sources at once — the computed figure, the saved
     * override, and the text in the box. Sending the whole row makes the
     * request say exactly what the row should be, and an empty box is a null,
     * which is the server's own word for "no correction here".
     */
    const payload: CfoEntryPayload = { reportDate: row.date, pfiId: row.pfiId, remarks }
    for (const f of CFO_OVERRIDE_FIELDS) payload[f] = parseFigure(fields[f])
    save.mutate(payload, { onSuccess: onClose })
  }

  const onReset = () => {
    reset.mutate({ reportDate: row.date, pfiId: row.pfiId }, { onSuccess: onClose })
  }

  const busy = save.isPending || reset.isPending

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row.pfiNumber}</DialogTitle>
          <DialogDescription>
            {row.locationName} · {row.productName} · {format(parseISO(row.date), 'd MMMM yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Leave a field empty to keep the system&apos;s figure. Anything you type is stored against
            this date and stops moving as the book changes.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {CFO_OVERRIDE_FIELDS.map((f) => {
              const systemText = QUANTITY_FIELDS.has(f)
                ? `${Math.round(row.computed[f]).toLocaleString('en-NG')} ${unitShort(row.productUnit)}`
                : ngn(row.computed[f])
              return (
                <div key={f} className="space-y-1.5">
                  <Label htmlFor={`cfo-${f}`}>{FIELD_LABELS[f]}</Label>
                  <Input
                    id={`cfo-${f}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={systemText}
                    value={fields[f]}
                    onChange={(e) => setFields((prev) => ({ ...prev, [f]: e.target.value }))}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">System: {systemText}</span>
                    {fields[f] !== '' && (
                      <button
                        type="button"
                        className="text-[11px] text-accent hover:underline"
                        onClick={() => setFields((prev) => ({ ...prev, [f]: '' }))}
                      >
                        Use system figure
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Derived, and shown moving as the inputs above change — the point
              being that they cannot be typed and never disagree with the row. */}
          <div className="grid gap-3 rounded-lg border border-foreground/15 bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <span className={cn(MICRO, 'text-muted-foreground')}>Stock balance</span>
              <p className="text-sm font-medium">
                {Math.round(stockBalance).toLocaleString('en-NG')} {unitShort(row.productUnit)}
              </p>
              <p className="text-[11px] text-muted-foreground">initial qty − cumulative sales volume</p>
            </div>
            <div>
              <span className={cn(MICRO, 'text-muted-foreground')}>Surplus / (deficit)</span>
              <p className={cn('text-sm font-medium', surplusDeficit < 0 ? 'text-destructive' : 'text-success')}>
                <Signed value={surplusDeficit} />
              </p>
              <p className="text-[11px] text-muted-foreground">bank inflow − sales value to date</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfo-remarks">Remarks</Label>
            <Textarea
              id="cfo-remarks"
              rows={3}
              maxLength={2000}
              placeholder="Anything the figures above do not say on their own."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          {row.updatedByName && row.updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              Last corrected by {row.updatedByName} on{' '}
              {format(new Date(row.updatedAt), 'd MMM yyyy HH:mm')}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {(row.edited.length > 0 || row.remarks) && (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={busy}>
                {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
                Reset to system figures
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={busy}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankFields(): Record<CfoOverrideField, string> {
  return {
    initialQty: '', cumulativeVolume: '', dayVolume: '', salesValue: '', bankInflow: '',
  }
}
