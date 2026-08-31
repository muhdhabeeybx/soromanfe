import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { FileSpreadsheet, Loader2, Mail, RefreshCw, Send, X } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { PageEmpty } from '#/components/PageEmpty'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { useToast } from '#/lib/hooks/useToast'
import { routeGuard } from '#/lib/route-guard'
import { naira } from '#/routes/pfi/-pfi-utils'
import { ALL_TYPES, REPORTS, STATUS_TONE, allFields, reportValue, type ReportType } from '#/routes/my-report/-report-config'
import { fetchDailyReportsForDate, type DailyReportRow } from './-hub-data'
import { exportReportsHub, emailReportsHub } from './-export'

export const Route = createFileRoute('/admin-reports/')({
  beforeLoad: () => routeGuard('/admin-reports'),
  component: AdminReportsPage,
})

const money = (v: unknown) => naira(Number(v ?? 0))
const num = (v: unknown) => Number(v ?? 0).toLocaleString()

/** Structured fields (price bands, top customers) render as a compact
 * summary string rather than a raw JSON dump — money/num can't touch them. */
const formatPriceBands = (v: unknown) => (
  Array.isArray(v) && v.length
    ? (v as Array<{ price: unknown; litres: unknown }>).map((b) => `${money(b.price)}×${num(b.litres)}L`).join('; ')
    : ''
)
const formatTopCustomers = (v: unknown) => (
  Array.isArray(v) && v.length
    ? (v as Array<{ name?: string; litres: unknown }>).map((c) => `${c.name || '—'} (${num(c.litres)}L)`).join(', ')
    : ''
)

type LocationGroup = { type: ReportType; rows: DailyReportRow[] }

function AdminReportsPage() {
  const toast = useToast()
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  const [selectedDate, setSelectedDate] = useState(today)
  const [locationFilter, setLocationFilter] = useState('all')
  const [pfiFilter, setPfiFilter] = useState('all')
  const [exporting, setExporting] = useState(false)
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)

  const {
    data: rows = [], isLoading, isFetching, isError, error, refetch,
  } = useQuery({
    queryKey: ['daily-reports-hub', selectedDate],
    queryFn: () => fetchDailyReportsForDate(selectedDate),
  })

  // Filter choices come from the day's own data, not a separate lookup — an
  // empty dropdown accurately says "nobody filed from anywhere else today".
  const options = useMemo(() => {
    const uniq = (v: (string | undefined)[]) => [...new Set(v.filter((x): x is string => !!x))].sort()
    return {
      locations: uniq(rows.map((r) => r.location?.trim())),
      pfis: uniq(rows.map((r) => r.pfiNumber?.trim())),
    }
  }, [rows])

  const filtered = useMemo(
    () => rows.filter(
      (r) => (locationFilter === 'all' || r.location === locationFilter)
        && (pfiFilter === 'all' || r.pfiNumber === pfiFilter),
    ),
    [rows, locationFilter, pfiFilter],
  )

  // Location (alphabetical, blank -> "Unknown") -> role, in the five reports'
  // fixed order, empty roles dropped -> rows.
  const sections = useMemo(() => {
    const byLocation = new Map<string, DailyReportRow[]>()
    for (const r of filtered) {
      const loc = r.location?.trim() || 'Unknown'
      if (!byLocation.has(loc)) byLocation.set(loc, [])
      byLocation.get(loc)!.push(r)
    }
    const locations = [...byLocation.keys()].sort((a, b) => (
      a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : a.localeCompare(b)
    ))
    return locations.map((location) => ({
      location,
      groups: ALL_TYPES
        .map((type) => ({ type, rows: byLocation.get(location)!.filter((r) => r.reportType === type) }))
        .filter((g): g is LocationGroup => g.rows.length > 0),
    }))
  }, [filtered])

  // Each figure is scoped to the roles that actually own it — summing
  // litresSold across a security officer's rows would silently add zeros,
  // but summing totalSalesAmount across every role would add nonsense.
  const summary = useMemo(() => {
    let litres = 0
    let sales = 0
    let commission = 0
    let trucksExited = 0
    const locations = new Set<string>()
    for (const r of filtered) {
      litres += Number(r.litresSold || 0)
      if (r.reportType === 'sales_manager' || r.reportType === 'product_manager') {
        sales += Number(r.totalSalesAmount || 0)
      }
      if (r.reportType === 'commissions') commission += Number(r.amountPaid || 0)
      if (r.reportType === 'security_gate') trucksExited += Number(r.truckCount || 0)
      locations.add(r.location?.trim() || 'Unknown')
    }
    return { litres, sales, commission, trucksExited, locations: locations.size, count: filtered.length }
  }, [filtered])

  const hasFilters = locationFilter !== 'all' || pfiFilter !== 'all'
  const clearFilters = () => { setLocationFilter('all'); setPfiFilter('all') }

  const handleExport = async () => {
    if (!filtered.length) return
    setExporting(true)
    try {
      await exportReportsHub(filtered, { date: selectedDate, location: locationFilter, pfi: pfiFilter })
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Reports hub"
        description="Every daily return filed by staff, grouped by location."
        actions={(
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
            Refresh
          </Button>
        )}
      />

      <StatCardGrid count={6}>
        <StatCard label="Reports filed" value={num(summary.count)} tone="neutral" />
        <StatCard label="Locations reporting" value={num(summary.locations)} tone="neutral" />
        <StatCard label="Total litres" value={num(summary.litres)} tone="blue" />
        <StatCard label="Total sales" value={money(summary.sales)} tone="green" />
        <StatCard label="Commission paid" value={money(summary.commission)} tone="amber" />
        <StatCard label="Trucks exited" value={num(summary.trucksExited)} tone="neutral" />
      </StatCardGrid>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Filters</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEmailDialogOpen(true)} disabled={!filtered.length}>
              <Mail data-icon="inline-start" />
              Email report
            </Button>
            <Button size="sm" onClick={handleExport} disabled={!filtered.length || exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
              Download report
            </Button>
          </div>
        </div>
        <div className={cn(PANEL_BODY, 'space-y-4')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex gap-1.5">
              <Button
                variant={selectedDate === today ? 'default' : 'outline'} size="sm" className="flex-1"
                onClick={() => setSelectedDate(today)}
              >
                Today
              </Button>
              <Button
                variant={selectedDate === yesterday ? 'default' : 'outline'} size="sm" className="flex-1"
                onClick={() => setSelectedDate(yesterday)}
              >
                Yesterday
              </Button>
            </div>
            <Input
              type="date" value={selectedDate} max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <NativeSelect value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="all">All locations</option>
              {options.locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </NativeSelect>
            <NativeSelect value={pfiFilter} onChange={(e) => setPfiFilter(e.target.value)}>
              <option value="all">All PFIs</option>
              {options.pfis.map((p) => <option key={p} value={p}>{p}</option>)}
            </NativeSelect>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {locationFilter !== 'all' && (
                <FilterChip onClear={() => setLocationFilter('all')}>{locationFilter}</FilterChip>
              )}
              {pfiFilter !== 'all' && (
                <FilterChip onClear={() => setPfiFilter('all')}>{pfiFilter}</FilterChip>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {filtered.length} of {rows.length} report{rows.length === 1 ? '' : 's'} shown
            </span>
          </div>
        </div>
      </section>

      {isLoading ? (
        <PageLoader message="Loading reports…" />
      ) : isError ? (
        <PageError message={getErrorMessage(error)} onRetry={() => refetch()} />
      ) : sections.length === 0 ? (
        <PageEmpty
          title="No reports filed"
          description={`Nobody filed a report for ${format(new Date(`${selectedDate}T00:00:00`), 'd MMM yyyy')}.`}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
        />
      ) : (
        sections.map(({ location, groups }) => (
          <LocationSection key={location} location={location} groups={groups} />
        ))
      )}

      <EmailReportDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        rows={filtered}
        opts={{ date: selectedDate, location: locationFilter, pfi: pfiFilter }}
      />
    </div>
  )
}

const RECIPIENTS_KEY = 'reports-hub-email-recipients'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Whoever ran the Hub last time is usually who runs it today — the recipient
 * list is remembered locally so it isn't retyped every morning, but nothing
 * is sent until "Send" is pressed.
 */
function EmailReportDialog({
  open, onOpenChange, rows, opts,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rows: DailyReportRow[]
  opts: { date: string; location: string; pfi: string }
}) {
  const toast = useToast()
  const [recipients, setRecipients] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECIPIENTS_KEY)
      return saved ? (JSON.parse(saved) as string[]) : []
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const addRecipient = () => {
    const email = draft.trim().replace(/,$/, '')
    if (!email) return
    if (!EMAIL_RE.test(email)) {
      toast.error(`"${email}" doesn't look like an email address`)
      return
    }
    setRecipients((r) => (r.includes(email) ? r : [...r, email]))
    setDraft('')
  }
  const removeRecipient = (email: string) => setRecipients((r) => r.filter((e) => e !== email))

  const send = async () => {
    if (!recipients.length) return
    setSending(true)
    try {
      const res = await emailReportsHub(opts, recipients)
      toast.success(res.message)
      localStorage.setItem(RECIPIENTS_KEY, JSON.stringify(recipients))
      onOpenChange(false)
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email report</DialogTitle>
          <DialogDescription>
            {rows.length} report{rows.length === 1 ? '' : 's'} for {format(new Date(`${opts.date}T00:00:00`), 'd MMM yyyy')}
            {opts.location !== 'all' && ` · ${opts.location}`}
            {opts.pfi !== 'all' && ` · ${opts.pfi}`} — sent as a readable summary of the day, covering every
            depot. For the spreadsheet, use "Download report".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className={cn(MICRO, 'block text-muted-foreground')}>Recipients</label>
          {recipients.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recipients.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full border border-foreground/15 py-0.5 pr-1.5 pl-2.5 text-xs"
                >
                  {email}
                  <button
                    type="button" onClick={() => removeRecipient(email)}
                    className="rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <X className="size-3" />
                    <span className="sr-only">Remove {email}</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              autoFocus
              placeholder="name@company.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addRecipient() }
              }}
            />
            <Button type="button" variant="outline" onClick={addRecipient} disabled={!draft.trim()}>
              Add
            </Button>
          </div>
          <p className="text-xs leading-tight text-muted-foreground/70">
            Type an address and press Enter — add as many as you need.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={send} disabled={!recipients.length || sending}>
            {sending ? <Loader2 className="animate-spin" /> : <Send data-icon="inline-start" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-foreground/15 py-0.5 pr-1.5 pl-2.5 text-xs text-muted-foreground">
      {children}
      <button
        type="button" onClick={onClear}
        className="rounded-full p-0.5 hover:bg-foreground/10"
      >
        <X className="size-3" />
        <span className="sr-only">Clear</span>
      </button>
    </span>
  )
}

function LocationSection({ location, groups }: { location: string; groups: LocationGroup[] }) {
  const total = groups.reduce((s, g) => s + g.rows.length, 0)
  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <span className={cn(MICRO, 'text-muted-foreground')}>{location}</span>
        <span className="text-xs text-muted-foreground">{total} report{total === 1 ? '' : 's'}</span>
      </div>
      <div className="divide-y divide-foreground/10">
        {groups.map((g) => <RoleTable key={g.type} type={g.type} rows={g.rows} />)}
      </div>
    </section>
  )
}

function RoleTable({ type, rows }: { type: ReportType; rows: DailyReportRow[] }) {
  const def = REPORTS[type]
  const fields = allFields(def)
  return (
    <div>
      <div
        className="flex items-center gap-2 border-l-[3px] px-6 py-2.5"
        style={{ borderColor: `#${def.color}` }}
      >
        <span className="text-xs font-semibold uppercase" style={{ color: `#${def.color}` }}>
          {def.roleLabel}
        </span>
        <span className="text-xs text-muted-foreground">· {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PFI</TableHead>
              <TableHead>Submitted by</TableHead>
              <TableHead>Status</TableHead>
              {fields.map((f) => (
                <TableHead
                  key={f.key}
                  className={f.type === 'money' || f.type === 'number' ? 'text-right' : undefined}
                >
                  {f.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{r.pfiNumber || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{r.submittedByName || '—'}</TableCell>
                <TableCell>
                  <StatusChip
                    tone={STATUS_TONE[r.status] ?? 'inert'}
                    title={r.status === 'rejected' ? r.reviewComment || undefined : undefined}
                  >
                    {r.status}
                  </StatusChip>
                </TableCell>
                {fields.map((f) => {
                  // reportValue, not r[f.key]: the commission report's two
                  // outstanding figures postdate the rows that still have to
                  // state them, and those work out from what the row carries.
                  const v = reportValue(r, f.key)
                  const isStructured = f.type === 'priceBands' || f.type === 'topCustomers'
                  const display = f.type === 'priceBands' ? formatPriceBands(v)
                    : f.type === 'topCustomers' ? formatTopCustomers(v)
                      : null
                  const empty = display != null ? display === '' : (v == null || v === '')
                  return (
                    <TableCell
                      key={f.key}
                      className={cn(
                        f.type === 'money' || f.type === 'number' ? 'text-right' : undefined,
                        (f.key === 'remarks' || isStructured) && 'max-w-xs truncate',
                      )}
                      title={(f.key === 'remarks' || isStructured) && !empty ? (display ?? String(v)) : undefined}
                    >
                      {empty
                        ? '—'
                        : display != null
                          ? display
                          : f.type === 'money' ? money(v) : f.type === 'number' ? num(v) : String(v)}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
