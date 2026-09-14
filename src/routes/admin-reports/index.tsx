import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, Mail, RefreshCw, Send, X } from 'lucide-react'

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
import {
  fetchDailyReportsForDate, checkSourceFor, useLiveActuals, varianceOf, variancesOn,
  SYSTEM_CHECKED_FIELDS,
  type CheckSource, type DailyReportRow, type SystemActuals,
} from './-hub-data'
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


function AdminReportsPage() {
  const toast = useToast()
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  const [selectedDate, setSelectedDate] = useState(today)
  const [locationFilter, setLocationFilter] = useState('all')
  const [pfiFilter, setPfiFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<ReportType | 'all'>('all')
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
      // Roles in the five reports' fixed order, not alphabetical — the page,
      // the workbook and this dropdown all read in the same sequence.
      roles: ALL_TYPES.filter((t) => rows.some((r) => r.reportType === t)),
    }
  }, [rows])

  /**
   * A live system read for every batch on the page.
   *
   * Reports filed before snapshots existed carry none, and without this the
   * whole history reads "not checked" — true, but useless. The live read fills
   * those in and is labelled as checked now rather than on the day, since it
   * is today's book being compared against an older sheet.
   */
  const pfiNumbers = useMemo(
    () => [...new Set(rows.map((r) => (r.pfiNumber || '').trim()).filter(Boolean))].sort(),
    [rows],
  )
  const live = useLiveActuals(selectedDate, pfiNumbers)

  const filtered = useMemo(
    () => rows.filter(
      (r) => (locationFilter === 'all' || r.location === locationFilter)
        && (pfiFilter === 'all' || r.pfiNumber === pfiFilter)
        && (roleFilter === 'all' || r.reportType === roleFilter),
    ),
    [rows, locationFilter, pfiFilter, roleFilter],
  )

  /**
   * Role first, in the five reports' fixed order — the page's whole shape.
   *
   * Location used to be the outer grouping, which scattered a role's sheets
   * across every block on the page. Comparing one sales manager against
   * another meant reading six sections; now they are one table, and the
   * outlier sits beside its peers.
   */
  const sections = useMemo(
    () => ALL_TYPES
      .map((type) => ({ type, rows: filtered.filter((r) => r.reportType === type) }))
      .filter((g) => g.rows.length > 0),
    [filtered],
  )

  // Each figure is scoped to the roles that actually own it — summing
  // litresSold across a security officer's rows would silently add zeros,
  // but summing totalSalesAmount across every role would add nonsense.
  const summary = useMemo(() => {
    let litres = 0
    let sales = 0
    let commission = 0
    let trucksExited = 0
    // Sheets that disagree with the system, and sheets nobody could check.
    // Counted apart: an unchecked report is not a clean one.
    let withVariance = 0
    let unchecked = 0
    const locations = new Set<string>()
    for (const r of filtered) {
      const keys = allFields(REPORTS[r.reportType]).map((f) => f.key)
      const src = checkSourceFor(r, live)
      if (!src) unchecked++
      else if (variancesOn(src, keys, (k) => reportValue(r, k)).length) withVariance++
      litres += Number(r.litresSold || 0)
      if (r.reportType === 'sales_manager' || r.reportType === 'product_manager') {
        sales += Number(r.totalSalesAmount || 0)
      }
      if (r.reportType === 'commissions') commission += Number(r.amountPaid || 0)
      if (r.reportType === 'security_gate') trucksExited += Number(r.truckCount || 0)
      locations.add(r.location?.trim() || 'Unknown')
    }
    return { litres, sales, commission, trucksExited, withVariance, unchecked, locations: locations.size, count: filtered.length }
  }, [filtered, live])

  const hasFilters = locationFilter !== 'all' || pfiFilter !== 'all' || roleFilter !== 'all'
  const clearFilters = () => { setLocationFilter('all'); setPfiFilter('all'); setRoleFilter('all') }

  /**
   * Download a slice of the day — one location, or one role inside it.
   *
   * The same builder as the main button, given fewer rows: a per-role sheet
   * has to be the same sheet, or the depot manager and the person who sent it
   * are reading two documents that disagree. The filter labels ride along so
   * the filename says what is inside it.
   */
  const [downloading, setDownloading] = useState<string | null>(null)
  const downloadSubset = async (
    subset: DailyReportRow[],
    scope: { location?: string; pfi?: string; key: string },
  ) => {
    if (!subset.length) return
    setDownloading(scope.key)
    try {
      await exportReportsHub(subset, {
        date: selectedDate,
        location: scope.location ?? locationFilter,
        pfi: scope.pfi ?? pfiFilter,
      }, live)
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setDownloading(null)
    }
  }

  const handleExport = async () => {
    if (!filtered.length) return
    setExporting(true)
    try {
      await exportReportsHub(filtered, { date: selectedDate, location: locationFilter, pfi: pfiFilter }, live)
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

      <StatCardGrid count={7}>
        <StatCard label="Reports filed" value={num(summary.count)} tone="neutral" />
        <StatCard label="Locations reporting" value={num(summary.locations)} tone="neutral" />
        <StatCard label="Total litres" value={num(summary.litres)} tone="blue" />
        <StatCard label="Total sales" value={money(summary.sales)} tone="green" />
        <StatCard label="Commission paid" value={money(summary.commission)} tone="amber" />
        <StatCard label="Trucks exited" value={num(summary.trucksExited)} tone="neutral" />
        <StatCard
          label="With a discrepancy"
          value={num(summary.withVariance)}
          tone={summary.withVariance > 0 ? 'red' : 'green'}
          description={summary.unchecked > 0 ? `${summary.unchecked} not checked` : undefined}
        />
      </StatCardGrid>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Filters</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEmailDialogOpen(true)} disabled={!filtered.length}>
              <Mail data-icon="inline-start" />
              Email report
            </Button>
            {/* WhatsApp is switched off. The email now carries the workbook
                itself, so there is one way the day goes out and one thing it
                says. The dialog below is line-commented, not deleted. */}
            <Button size="sm" onClick={handleExport} disabled={!filtered.length || exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
              Download report
            </Button>
          </div>
        </div>
        <div className={cn(PANEL_BODY, 'space-y-4')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <NativeSelect
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as ReportType | 'all')}
            >
              <option value="all">All roles</option>
              {options.roles.map((t) => (
                <option key={t} value={t}>{REPORTS[t].roleLabel}</option>
              ))}
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
              {roleFilter !== 'all' && (
                <FilterChip onClear={() => setRoleFilter('all')}>{REPORTS[roleFilter].roleLabel}</FilterChip>
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
        sections.map(({ type, rows: roleRows }) => (
          <RoleSection
            key={type}
            type={type}
            rows={roleRows}
            live={live}
            onDownload={downloadSubset}
            downloading={downloading}
          />
        ))
      )}

      <EmailReportDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        rows={filtered}
        opts={{ date: selectedDate, location: locationFilter, pfi: pfiFilter }}
        live={live}
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
  open, onOpenChange, rows, opts, live,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rows: DailyReportRow[]
  opts: { date: string; location: string; pfi: string }
  live: Map<string, SystemActuals>
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
      const res = await emailReportsHub(rows, opts, recipients, live)
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

type DownloadFn = (
  subset: DailyReportRow[],
  scope: { location?: string; pfi?: string; key: string },
) => void

/**
 * One role, every sheet filed for it, ordered by batch.
 *
 * Role first, location second — deliberately reversed from how this page used
 * to read. Grouping by location put one sales sheet beside one security sheet
 * and one commissions sheet, which is the arrangement that makes a role's
 * figures impossible to compare: to see whether the sales managers agreed with
 * each other you had to read six blocks and hold them in your head. Every
 * sales sheet in one table, sorted by batch, puts the outlier next to its
 * peers where it is obvious. Location is a column and a filter instead.
 */
function RoleSection({
  type, rows, live, onDownload, downloading,
}: {
  type: ReportType
  rows: DailyReportRow[]
  live: Map<string, SystemActuals>
  onDownload: DownloadFn
  downloading: string | null
}) {
  const def = REPORTS[type]
  const fields = allFields(def)
  const key = `role:${type}`

  // PFI first, then location — so the same batch's sheets sit together even
  // when two locations filed against it.
  const ordered = useMemo(() => [...rows].sort((a, b) => (
    (a.pfiNumber || '').localeCompare(b.pfiNumber || '')
      || (a.location || '').localeCompare(b.location || '')
  )), [rows])

  const checks = useMemo(
    () => new Map(ordered.map((r) => [r.id, checkSourceFor(r, live)])),
    [ordered, live],
  )

  const offCount = ordered.filter(
    (r) => variancesOn(checks.get(r.id) ?? null, fields.map((f) => f.key), (k) => reportValue(r, k)).length > 0,
  ).length
  const uncheckedCount = ordered.filter((r) => !checks.get(r.id)).length

  return (
    <section className={PANEL}>
      <div
        className={cn(PANEL_RAIL, 'border-l-[3px]')}
        style={{ borderLeftColor: `#${def.color}` }}
      >
        <span className="text-xs font-semibold uppercase" style={{ color: `#${def.color}` }}>
          {def.roleLabel}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {ordered.length} report{ordered.length === 1 ? '' : 's'}
          </span>
          {offCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-amber-600 dark:text-amber-500">
              <AlertTriangle className="size-2.5" />
              {offCount} with a discrepancy
            </span>
          )}
          {uncheckedCount > 0 && (
            <span className="text-[10px] whitespace-nowrap text-muted-foreground/60">
              {uncheckedCount} not checked
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={() => onDownload(ordered, { key })}
            disabled={downloading !== null}
          >
            {downloading === key ? <Loader2 className="animate-spin" /> : <Download data-icon="inline-start" />}
            This role
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PFI</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Submitted by</TableHead>
              <TableHead>Status</TableHead>
              {fields.map((f) => [
                <TableHead
                  key={f.key}
                  className={f.type === 'money' || f.type === 'number' ? 'text-right' : undefined}
                >
                  {f.label}
                </TableHead>,
                // Its own column, not a second line inside the filed one. Two
                // numbers stacked in one cell read as one figure with a
                // footnote; side by side they read as a comparison, which is
                // what they are.
                SYSTEM_CHECKED_FIELDS.has(f.key) ? (
                  <TableHead
                    key={`${f.key}:sys`}
                    className="border-l border-foreground/10 text-right text-muted-foreground"
                  >
                    System
                  </TableHead>
                ) : null,
              ])}
              <TableHead>System check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((r) => {
              const src = checks.get(r.id) ?? null
              const off = variancesOn(src, fields.map((f) => f.key), (k) => reportValue(r, k))
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.pfiNumber || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.location?.trim() || '—'}</TableCell>
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
                    const systemValue = src?.fields[f.key]
                    const cellOff = varianceOf(src, f.key, v)
                    const isStructured = f.type === 'priceBands' || f.type === 'topCustomers'
                    const display = f.type === 'priceBands' ? formatPriceBands(v)
                      : f.type === 'topCustomers' ? formatTopCustomers(v)
                        : null
                    const empty = display != null ? display === '' : (v == null || v === '')
                    return [
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
                        {/* The system's own figure, under every figure it can
                            speak to — not only the ones that disagree. Seeing
                            "sys 21,925,484" under a matching 21,925,484 is what
                            makes the amber one mean something; a page that shows
                            the comparison only when it fails leaves a reader
                            unable to tell a checked figure from an unchecked
                            one. */}
                      </TableCell>,
                      SYSTEM_CHECKED_FIELDS.has(f.key) ? (
                        <TableCell
                          key={`${f.key}:sys`}
                          className={cn(
                            'border-l border-foreground/10 text-right whitespace-nowrap',
                            cellOff
                              ? 'font-medium text-amber-600 dark:text-amber-500'
                              : 'text-muted-foreground',
                          )}
                          title={cellOff
                            ? `Filed ${cellOff.typed.toLocaleString()}, system ${cellOff.system.toLocaleString()}`
                            : undefined}
                        >
                          {systemValue == null
                            ? '—'
                            : f.type === 'money' ? money(systemValue) : num(systemValue)}
                        </TableCell>
                      ) : null,
                    ]
                  })}
                  <TableCell className="max-w-xs">
                    <SystemCheckCell src={src} off={off} fields={fields} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

/** The verdict in words, so a reader never has to scan the row to find it. */
function SystemCheckCell({
  src, off, fields,
}: {
  src: CheckSource
  off: Array<{ key: string; off: { typed: number; system: number; diff: number } }>
  fields: Array<{ key: string; label: string }>
}) {
  if (!src) {
    return <span className="text-xs whitespace-nowrap text-muted-foreground/60">Not checked</span>
  }
  if (!off.length) {
    return (
      <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-emerald-600 dark:text-emerald-500">
        <Check className="size-3" />
        Agrees
        {src.when === 'now' && <span className="text-muted-foreground/60">(checked now)</span>}
      </span>
    )
  }
  return (
    <div className="space-y-0.5">
      {off.slice(0, 3).map((x) => {
        const label = fields.find((f) => f.key === x.key)?.label ?? x.key
        return (
          <p key={x.key} className="text-xs text-amber-600 dark:text-amber-500">
            {label} {x.off.diff > 0 ? 'over' : 'under'} by {Math.abs(x.off.diff).toLocaleString()}
          </p>
        )
      })}
      {off.length > 3 && (
        <p className="text-[10px] text-muted-foreground">+{off.length - 3} more</p>
      )}
      {src.when === 'now' && (
        <p
          className="text-[10px] text-muted-foreground/60"
          title="This report was filed before the system kept its own copy, so it is being checked against today's book rather than the day's."
        >
          checked now, not on the day
        </p>
      )}
    </div>
  )
}

// WhatsApp, switched off at the user's request — the email carries the
// workbook now. Line-commented rather than deleted: the server route, the
// template and the number-normalising service are all untouched, so this
// comes back by uncommenting and re-adding one button.
//
// const WA_RECIPIENTS_KEY = 'reports-hub-whatsapp-recipients'
// /** Anything that could be a phone number. The server does the real parsing. */
// const PHONE_RE = /^[+\d][\d\s()-]{6,24}$/
//
// /**
//  * Send the day as a WhatsApp message.
//  *
//  * Numbers persist in this browser, like the email list does, because the same
//  * three or four managers get it every time and retyping them is how a nightly
//  * habit stops being nightly.
//  *
//  * Nothing is sent until "Send" is pressed, and the result is reported per
//  * number — a send that reached two of five and said "sent" would leave the
//  * desk believing somebody was told something they never saw.
//  */
// function WhatsappReportDialog({
//   open, onOpenChange, opts,
// }: {
//   open: boolean
//   onOpenChange: (o: boolean) => void
//   opts: { date: string }
// }) {
//   const [numbers, setNumbers] = useState<string[]>(() => {
//     try {
//       const raw = localStorage.getItem(WA_RECIPIENTS_KEY)
//       return raw ? (JSON.parse(raw) as string[]) : []
//     } catch {
//       return []
//     }
//   })
//   const [draft, setDraft] = useState('')
//   const [sending, setSending] = useState(false)
//   /** What the last preview resolved to. Cleared whenever the list changes. */
//   const [preview, setPreview] = useState<WhatsappReportResult['data'] | null>(null)
//   const toast = useToast()
//
//   const addNumber = () => {
//     const value = draft.trim().replace(/,$/, '')
//     if (!value) return
//     if (!PHONE_RE.test(value)) {
//       toast.error(`"${value}" doesn't look like a phone number`)
//       return
//     }
//     setNumbers((n) => (n.includes(value) ? n : [...n, value]))
//     setDraft('')
//     setPreview(null)
//   }
//   const removeNumber = (value: string) => {
//     setNumbers((n) => n.filter((x) => x !== value))
//     setPreview(null)
//   }
//
//   const runPreview = async () => {
//     if (!numbers.length) return
//     setSending(true)
//     try {
//       const res = await whatsappReportsHub(opts, numbers, true)
//       setPreview(res.data ?? null)
//     } catch (err) {
//       toast.error(getErrorMessage(err))
//     } finally {
//       setSending(false)
//     }
//   }
//
//   const send = async () => {
//     if (!numbers.length) return
//     setSending(true)
//     try {
//       const res = await whatsappReportsHub(opts, numbers)
//       localStorage.setItem(WA_RECIPIENTS_KEY, JSON.stringify(numbers))
//       const failed = res.data?.failed ?? []
//       const sent = res.data?.sent ?? []
//
//       if (!sent.length) {
//         // Nothing went. The server says why in one sentence — a switched-off
//         // channel, a bad template, an unreachable number — and repeating it
//         // once per recipient would bury the one thing worth reading.
//         toast.error(res.message)
//       } else if (failed.length) {
//         // Named, not counted: "3 failed" tells nobody which manager to ring.
//         toast.warning(
//           `${res.message}. Not delivered: ${failed.map((f) => `${f.to} (${f.error})`).join('; ')}`,
//         )
//       } else {
//         toast.success(res.message)
//       }
//       if (sent.length) onOpenChange(false)
//     } catch (err) {
//       toast.error(getErrorMessage(err))
//     } finally {
//       setSending(false)
//     }
//   }
//
//   return (
//     <Dialog open={open} onOpenChange={onOpenChange}>
//       <DialogContent className="sm:max-w-lg">
//         <DialogHeader>
//           <DialogTitle>Send the day as a WhatsApp message</DialogTitle>
//           <DialogDescription>
//             A short text summary of {format(new Date(`${opts.date}T00:00:00`), 'd MMM yyyy')} —
//             volume, value and each location. No attachment.
//           </DialogDescription>
//         </DialogHeader>
//
//         <div className="space-y-3">
//           {numbers.length > 0 && (
//             <div className="flex flex-wrap gap-1.5">
//               {numbers.map((value) => (
//                 <span
//                   key={value}
//                   className="inline-flex items-center gap-1 rounded-full border border-foreground/15 bg-muted/50 px-2.5 py-1 text-xs"
//                 >
//                   {value}
//                   <button
//                     type="button" onClick={() => removeNumber(value)}
//                     className="text-muted-foreground hover:text-destructive"
//                     aria-label={`Remove ${value}`}
//                   >
//                     <X className="size-3" />
//                   </button>
//                 </span>
//               ))}
//             </div>
//           )}
//
//           <div className="flex gap-2">
//             <Input
//               value={draft}
//               onChange={(e) => setDraft(e.target.value)}
//               onKeyDown={(e) => {
//                 if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addNumber() }
//               }}
//               placeholder="08031234567"
//               inputMode="tel"
//             />
//             <Button type="button" variant="outline" onClick={addNumber}>Add</Button>
//           </div>
//           <p className="text-xs text-muted-foreground">
//             0803…, +234803… or 234803… all work. Numbers are remembered on this device.
//           </p>
//
//           {/*
//             What Meta will actually receive.
//
//             A template send fails outright if the number of parameters does not
//             match the body approved in the console, and the failure comes back
//             as a code per recipient rather than anything readable. Showing the
//             resolved {{1}}, {{2}}, … lets the two be compared before a send
//             rather than after one that reached nobody.
//           */}
//           {preview && (
//             <div className="space-y-2 rounded-lg border border-foreground/15 bg-muted/30 p-3">
//               <p className={cn(MICRO, 'text-muted-foreground')}>
//                 {preview.channel === 'template'
//                   ? `Template "${preview.templateName}" · ${preview.parameters?.length ?? 0} parameter${preview.parameters?.length === 1 ? '' : 's'}`
//                   : 'Plain text — no template'}
//               </p>
//               {preview.channel === 'template' ? (
//                 <ol className="space-y-1">
//                   {(preview.parameters ?? []).map((value, i) => (
//                     <li key={i} className="flex gap-2 text-xs">
//                       <span className="shrink-0 font-mono text-muted-foreground">{`{{${i + 1}}}`}</span>
//                       <span className="break-words">{value}</span>
//                     </li>
//                   ))}
//                 </ol>
//               ) : (
//                 <p className="whitespace-pre-wrap text-xs">{preview.body}</p>
//               )}
//               <p className="text-xs text-muted-foreground">
//                 If this does not match the body Meta approved, the send will be rejected —
//                 set WHATSAPP_REPORT_TEMPLATE_PARAMS to reorder or change the fields.
//               </p>
//             </div>
//           )}
//         </div>
//
//         <DialogFooter>
//           <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
//           <Button variant="outline" onClick={runPreview} disabled={!numbers.length || sending}>
//             Preview
//           </Button>
//           <Button onClick={send} disabled={!numbers.length || sending}>
//             {sending ? <Loader2 className="animate-spin" /> : <Send data-icon="inline-start" />}
//             Send to {numbers.length || 'no one'}
//           </Button>
//         </DialogFooter>
//       </DialogContent>
//     </Dialog>
//   )
// }
