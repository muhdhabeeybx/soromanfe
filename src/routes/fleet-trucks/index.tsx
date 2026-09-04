import { useMemo, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { isWithinInterval } from 'date-fns'
import {
  Plus, Pencil, Trash2, Search, Truck, Activity, Wallet,
  FileSpreadsheet, ArrowUpDown, AlertTriangle, ChevronRight,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageEmpty } from '#/components/PageEmpty'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { TruckDialog } from '#/components/TruckDialog'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  useFleetTrucks, useFleetLedger, useDeleteTruck,
  parseStatus, isExpired, STATUS_RATINGS, type FleetTruck,
} from '#/lib/hooks/useFleet'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/fleet-trucks/')({
  beforeLoad: () => routeGuard('/fleet-trucks'),
  component: FleetDirectoryPage,
})

const ALL = 'all'
const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`
type SortKey = 'debits' | 'credits' | 'balance'

function FleetDirectoryPage() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState<DatePreset>('all')
  const [search, setSearch] = useState('')
  const [loadStatus, setLoadStatus] = useState(ALL)
  const [condition, setCondition] = useState(ALL)
  const [capacity, setCapacity] = useState(ALL)
  const [sortBy, setSortBy] = useState<SortKey>('balance')
  const [desc, setDesc] = useState(true)
  const [editing, setEditing] = useState<FleetTruck | null | 'new'>(null)
  const [deleting, setDeleting] = useState<FleetTruck | null>(null)

  const { data: trucks = [], isLoading } = useFleetTrucks()
  const { data: entries = [] } = useFleetLedger()
  const removeTruck = useDeleteTruck()

  const range = useMemo(() => resolveRange(preset), [preset])

  /**
   * Money per truck, rolled up client-side — there is no per-truck aggregate
   * endpoint. Expenses add to debits, income to credits; balance is the
   * difference. Trucks with no entries default to zero.
   */
  const money = useMemo(() => {
    const map = new Map<number, { debits: number; credits: number }>()
    for (const e of entries) {
      if (range && !isWithinInterval(new Date(e.entry_date), { start: range.from, end: range.to })) continue
      const row = map.get(e.truck_id) ?? { debits: 0, credits: 0 }
      const amount = Number(e.amount || 0)
      if (e.entry_type === 'expense') row.debits += amount
      else row.credits += amount
      map.set(e.truck_id, row)
    }
    return map
  }, [entries, range])

  /**
   * Lifetime trip counts, deliberately ignoring the date filter — trip totals
   * are a property of the truck, not of the period being reviewed.
   */
  const lifetime = useMemo(() => {
    const map = new Map<number, number>()
    for (const e of entries) map.set(e.truck_id, (map.get(e.truck_id) ?? 0) + 1)
    return map
  }, [entries])

  const capacities = useMemo(
    () => [...new Set(trucks.map((t) => t.maxCapacity).filter(Boolean))].sort(),
    [trucks],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const joined = trucks.map((t) => {
      const m = money.get(t.id) ?? { debits: 0, credits: 0 }
      return {
        truck: t,
        ...m,
        balance: m.credits - m.debits,
        trips: lifetime.get(t.id) ?? 0,
        status: parseStatus(t.truckStatus),
      }
    })

    const filtered = joined.filter((r) => {
      if (loadStatus !== ALL && String(r.truck.isActive) !== loadStatus) return false
      if (condition !== ALL && r.status.rating !== condition) return false
      if (capacity !== ALL && String(r.truck.maxCapacity) !== capacity) return false
      if (!q) return true
      return [r.truck.plateNumber, r.truck.driverName, r.truck.truckStatus]
        .some((f) => String(f ?? '').toLowerCase().includes(q))
    })

    filtered.sort((a, b) => (desc ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy]))
    return filtered
  }, [trucks, money, lifetime, search, loadStatus, condition, capacity, sortBy, desc])

  const totals = useMemo(() => {
    const active = rows.filter((r) => r.debits > 0 || r.credits > 0).length
    const cost = rows.reduce((s, r) => s + r.debits, 0)
    return { trucks: trucks.length, active, avgCost: rows.length ? cost / rows.length : 0 }
  }, [rows, trucks])

  const openTruck = (id: number) =>
    navigate({ to: '/fleet-trucks/details', search: { id: String(id) } })

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setDesc((d) => !d)
    else { setSortBy(key); setDesc(true) }
  }

  const exportSummary = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Fleet summary')
    ws.columns = [
      { header: 'Truck No.', key: 'plate', width: 18 },
      { header: 'Status', key: 'status', width: 22 },
      { header: 'Capacity', key: 'cap', width: 14 },
      { header: 'Driver', key: 'driver', width: 24 },
      { header: 'Contact', key: 'phone', width: 18 },
      { header: 'Debits', key: 'debits', width: 16 },
      { header: 'Credits', key: 'credits', width: 16 },
      { header: 'Balance', key: 'balance', width: 16 },
    ]
    ws.getRow(1).font = { bold: true }
    rows.forEach((r) => ws.addRow({
      plate: r.truck.plateNumber, status: r.truck.truckStatus || r.status.rating,
      cap: r.truck.maxCapacity ?? '', driver: r.truck.driverName,
      phone: r.truck.driverPhone ?? '', debits: r.debits, credits: r.credits, balance: r.balance,
    }))
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    const a = document.createElement('a')
    a.href = url; a.download = 'fleet-summary.xlsx'; a.click()
    URL.revokeObjectURL(url)
  }

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={cn('text-right', className)}>
      <button
        type="button" onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 outline-none hover:text-foreground focus-visible:underline"
      >
        {label}
        <ArrowUpDown className={cn('size-3', sortBy === k ? 'opacity-100' : 'opacity-40')} />
      </button>
    </TableHead>
  )

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
      eyebrow="Transport"
      title="Fleet"
      description="At-a-glance truck performance — debits, credits, and balance per truck. Open a truck for its people, papers and full ledger."
      actions={
        <>
          <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportSummary} disabled={!rows.length}>
          <FileSpreadsheet data-icon="inline-start" />
          Export summary
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
          <Plus data-icon="inline-start" />
          Add truck
          </Button>
          </div>
        </>
      }
    />

      <StatCardGrid count={3}>
        <StatCard icon={<Truck />} label="Total trucks" value={totals.trucks} />
        <StatCard
          tone={totals.active > 0 ? 'green' : 'amber'}
          icon={<Activity />} label="Active this period" value={totals.active}
          description={totals.active > 0 ? 'With ledger activity' : 'No activity in range'}
        />
        <StatCard
          tone={totals.avgCost > 0 ? 'red' : 'green'}
          icon={<Wallet />} label="Average cost per truck" value={naira(Math.round(totals.avgCost))}
        />
      </StatCardGrid>

      <section className={PANEL}>
        <div className={PANEL_RAIL}><span className={MICRO}>Filters</span></div>
        <div className={cn(PANEL_BODY, 'space-y-4')}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plate, driver or status…" className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-2">
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

          <div className="grid gap-3 sm:grid-cols-3">
            <NativeSelect value={loadStatus} onChange={(e) => setLoadStatus(e.target.value)}>
              <option value={ALL}>All load statuses</option>
              <option value="true">In service</option>
              <option value="false">Retired</option>
            </NativeSelect>
            <NativeSelect value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value={ALL}>All conditions</option>
              {STATUS_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </NativeSelect>
            <NativeSelect value={capacity} onChange={(e) => setCapacity(e.target.value)}>
              <option value={ALL}>All capacities</option>
              {capacities.map((c) => <option key={String(c)} value={String(c)}>{String(c)}</option>)}
            </NativeSelect>
          </div>
        </div>
      </section>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>{rows.length} truck{rows.length === 1 ? '' : 's'}</span>
        </div>
        {isLoading ? (
          <PageLoader message="Loading fleet…" />
        ) : rows.length === 0 ? (
          <PageEmpty title="No trucks yet" description="Add a truck to start tracking its costs." />
        ) : (
          <div className="px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">S/N</TableHead>
                  <TableHead>Truck No.</TableHead>
                  <TableHead>Status</TableHead>
                  {/* Capacity, driver and contact fold away on small screens. */}
                  <TableHead className="hidden md:table-cell">Capacity</TableHead>
                  <TableHead className="hidden md:table-cell">Driver</TableHead>
                  <TableHead className="hidden md:table-cell">Driver's Contact</TableHead>
                  <SortHead k="debits" label="Debits" className="text-destructive" />
                  <SortHead k="credits" label="Credits" className="text-accent" />
                  <SortHead k="balance" label="Balance" />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const lapsed = isExpired(r.truck.insuranceExpiry) || isExpired(r.truck.roadWorthinessExpiry)
                  return (
                    <TableRow
                      key={r.truck.id}
                      onClick={() => openTruck(r.truck.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-normal">
                        {/* The plate is the way in — a row carries a balance
                            and a driver's name, and everything else about the
                            truck lives one click away. */}
                        <button
                          type="button"
                          onClick={() => openTruck(r.truck.id)}
                          className="group/plate inline-flex items-center gap-1 outline-none transition-colors duration-250 ease-luxe hover:text-accent focus-visible:underline"
                        >
                          {r.truck.plateNumber}
                          <ChevronRight className="size-3 opacity-0 transition-opacity duration-250 ease-luxe group-hover/plate:opacity-100" />
                        </button>
                        {!r.truck.isActive && (
                          <span className="ml-1.5 text-xs text-muted-foreground">retired</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <StatusChip
                            tone={
                              r.status.rating === 'Bad' ? 'destructive'
                                : r.status.rating === 'Fair' ? 'warning' : 'accent'
                            }
                          >
                            {r.status.rating}
                          </StatusChip>
                          {lapsed && (
                            <AlertTriangle className="size-3.5 text-warning" aria-label="Compliance lapsed" />
                          )}
                        </div>
                        {r.status.reason && (
                          <p className="mt-0.5 max-w-[12rem] truncate text-xs text-muted-foreground">
                            {r.status.reason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {r.truck.maxCapacity ?? '—'}
                      </TableCell>
                      <TableCell className="hidden max-w-[12rem] truncate md:table-cell">
                        {r.truck.driverName}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {r.truck.driverPhone || '—'}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {r.debits ? naira(r.debits) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-accent">
                        {r.credits ? naira(r.credits) : '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold',
                          r.balance > 0 && 'text-accent',
                          r.balance < 0 && 'text-destructive',
                          r.balance === 0 && 'text-muted-foreground',
                        )}
                      >
                        {naira(r.balance)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(r.truck)}>
                            <Pencil /><span className="sr-only">Edit {r.truck.plateNumber}</span>
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(r.truck)}>
                            <Trash2 /><span className="sr-only">Remove {r.truck.plateNumber}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <TruckDialog
        truck={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title="Remove this truck?"
        description={
          deleting
            ? `${deleting.plateNumber}. If it carries ledger entries it is retired rather than deleted, so the money history survives.`
            : ''
        }
        variant="destructive"
        confirmLabel="Remove"
        loading={removeTruck.isPending}
        onConfirm={async () => {
          if (deleting) await removeTruck.mutateAsync(deleting.id)
          setDeleting(null)
        }}
      />
    </div>
  )
}
