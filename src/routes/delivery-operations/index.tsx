import { useState, useMemo, useCallback, useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { FilterBar } from '#/components/FilterBar'
import { NativeSelect } from '#/components/ui/native-select'
import { SummaryCards, type SummaryCard } from '#/components/SummaryCards'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Plus, Search, Download,
  Truck, Droplets, CheckCircle2,
  X, Tag, Settings, Calendar,
  Loader2, Split,
} from 'lucide-react'
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { useDeliveryInventoryList, useUpdateDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useDeliverySalesList } from '#/lib/hooks/useDeliverySales'
import { usePfiList } from '#/lib/hooks/usePfis'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { useToast } from '#/lib/hooks/useToast'
import { cn } from '#/lib/utils'
import {
  buildTruckIndex, matchSalesByRecord, resolveLoading, STATUS_DISPLAY,
  type ResolvedLoading,
} from '#/lib/delivery-records'
import { buildLoadSplit, formatShareList, type LoadSplit } from '#/lib/load-split'
import type { DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import type { Pfi } from '#/lib/hooks/usePfis'

import { ManageCodesDialog } from '#/components/delivery-operations/ManageCodesDialog'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/delivery-operations/')({
  beforeLoad: () => routeGuard('/delivery-operations'),
  component: DeliveryOperationsPage,
})

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const CODE_PALETTE = [
  { header: 'bg-muted', row: 'border-l-sky-300', badge: 'bg-muted text-foreground border-border' },
  { header: 'bg-accent/10', row: 'border-l-emerald-300', badge: 'bg-accent/10 text-accent border-accent/40' },
  { header: 'bg-warning/10', row: 'border-l-orange-300', badge: 'bg-warning/10 text-warning border-warning/40' },
  { header: 'bg-muted', row: 'border-l-violet-300', badge: 'bg-muted text-foreground border-border' },
  { header: 'bg-muted', row: 'border-l-pink-300', badge: 'bg-muted text-foreground border-border' },
  { header: 'bg-warning/10', row: 'border-l-amber-300', badge: 'bg-warning/10 text-warning border-warning/40' },
  { header: 'bg-accent/10', row: 'border-l-teal-300', badge: 'bg-accent/10 text-accent border-accent/40' },
  { header: 'bg-muted', row: 'border-l-indigo-300', badge: 'bg-muted text-foreground border-border' },
]

const getCodeTheme = (code: string) => {
  if (!code) return null
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0
  return CODE_PALETTE[hash % CODE_PALETTE.length]
}

// 'other' is every row whose status is neither loaded nor offloaded — the
// `empty` rows had no filter that could reach them before.
type StatusFilter = 'all' | 'active' | 'delivered' | 'other'

interface TruckRecord extends Omit<DeliveryInventory, keyof ResolvedLoading>, ResolvedLoading {
  depotDisplay: string
  custName: string
  pfiLabel: string
  unitLabel: string
  qty: number
  code: string
  isFillingStation: boolean
  notes: string
  /** Who this load was sold to, and in what shares. */
  split: LoadSplit
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

function DeliveryOperationsPage() {
  const toast = useToast()

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: rawInventory = [], isLoading: isLoadingInventory } = useDeliveryInventoryList()
  // The cards read dates and destinations that only the ledger records for
  // allocations imported without them.
  const { data: allSales = [] } = useDeliverySalesList()
  const { data: pfisData } = usePfiList()
  const { data: trucksData } = useAllocatableTrucks()
  const { data: customersData = [] } = useDeliveryCustomerList()

  const allPfis: Pfi[] = useMemo(() => {
    if (!pfisData) return []
    return Array.isArray(pfisData) ? pfisData : (pfisData.pfis || [])
  }, [pfisData])

  const allTrucks = useMemo(() => {
    if (!trucksData) return []
    return Array.isArray(trucksData) ? trucksData : (trucksData.trucks || [])
  }, [trucksData])

  const allEntries = useMemo((): DeliveryInventory[] => {
    if (!rawInventory) return []
    return Array.isArray(rawInventory) ? rawInventory : []
  }, [rawInventory])

  const allCustomers: DeliveryCustomer[] = useMemo(() => {
    if (!customersData) return []
    return Array.isArray(customersData) ? customersData : (customersData.customers || [])
  }, [customersData])

  // ── Mutations ───────────────────────────────────────────────────────────
  const updateInventory = useUpdateDeliveryInventory()

  // ── Filters & Search ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [pfiFilter, setPfiFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [codeFilter, setCodeFilter] = useState('')
  const [customerTypeFilter, setCustomerTypeFilter] = useState<'all' | 'filling_station' | 'normal'>('all')

  // ── Allocation Codes ────────────────────────────────────────────────────
  const [deliveryCodes, setDeliveryCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_trip_codes') || '[]') } catch { return [] }
  })
  const [manageCodesOpen, setManageCodesOpen] = useState(false)

  // Persist codes
  useEffect(() => {
    localStorage.setItem('dsl_trip_codes', JSON.stringify(deliveryCodes))
  }, [deliveryCodes])

  // Sync codes from inventory
  useEffect(() => {
    if (!allEntries.length) return
    const inventoryCodes = allEntries
      .map(e => (e.allocationCode || '').trim().toUpperCase())
      .filter(Boolean)
    setDeliveryCodes(prev => {
      const merged = Array.from(new Set([...prev, ...inventoryCodes])).sort()
      if (merged.join(',') === prev.join(',')) return prev
      return merged
    })
  }, [allEntries])

  // ═══════════════════════════════════════════════════════════════════════════
  // Lookup Maps
  // ═══════════════════════════════════════════════════════════════════════════

  const truckIndex = useMemo(() => buildTruckIndex(allTrucks), [allTrucks])

  const customerMap = useMemo(() => {
    const m = new Map<string | number, DeliveryCustomer>()
    allCustomers.forEach(c => {
      if (c.id != null) { m.set(c.id, c); m.set(Number(c.id), c); m.set(String(c.id), c) }
      if (c._id != null) { m.set(c._id, c); m.set(String(c._id), c) }
    })
    return m
  }, [allCustomers])

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    allPfis.forEach((p: any) => {
      if (p.id != null) { m.set(String(p.id), p) }
      if (p._id != null) { m.set(String(p._id), p) }
    })
    return m
  }, [allPfis])

  const isFillingStation = (c: DeliveryCustomer | null | undefined): boolean => {
    if (!c) return false
    return c.customerType === 'filling_station'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Enrich entries into TruckRecord[]
  // ═══════════════════════════════════════════════════════════════════════════

  const truckEntries = useMemo(
    () => allEntries.filter(e => !!(e.truckId || e.truckNumber || e.loadingStatus)),
    [allEntries])

  const salesByRecord = useMemo(
    () => matchSalesByRecord(truckEntries, allSales), [truckEntries, allSales])

  const truckRecords = useMemo((): TruckRecord[] => {
    return truckEntries.map(entry => {
      const truck = truckIndex.find(entry)
      const customer = entry.customerId ? (customerMap.get(entry.customerId) || customerMap.get(Number(entry.customerId)) || customerMap.get(String(entry.customerId))) : null
      const pfi = entry.pfiId ? pfiMap.get(String(entry.pfiId)) : null
      const sales = salesByRecord.get(entry._id || entry.id || '') ?? []
      const resolved = resolveLoading(entry, { truck, customer, pfi, sales })
      const split = buildLoadSplit(entry, sales, customerMap)

      return {
        ...entry,
        ...resolved,
        truckPlate: resolved.truckPlate || '—',
        depotDisplay: resolved.depot,
        custName: resolved.customerName,
        pfiLabel: resolved.batchLabel,
        unitLabel: pfi?.productUnit || 'Litres',
        // The whole truck, never one buyer's share of it. `quantity_allocated`
        // alone reported PFI-40B's KUJ228XC as a 30,000 L load when 45,000 left
        // the depot on it — see buildLoadSplit.
        qty: split.total,
        split,
        code: (entry.allocationCode || (entry as any).allocation_code || '').trim().toUpperCase(),
        isFillingStation: isFillingStation(customer),
        notes: entry.notes || '',
      }
    })
  }, [truckEntries, truckIndex, customerMap, pfiMap, salesByRecord])

  // ═══════════════════════════════════════════════════════════════════════════
  // Filtering & Sorting
  // ═══════════════════════════════════════════════════════════════════════════

  const hasDateFilter = !!(dateFrom || dateTo)
  const hasAnyFilter = !!(searchQuery || hasDateFilter || statusFilter !== 'all' || pfiFilter || customerFilter || truckFilter || codeFilter || customerTypeFilter !== 'all')

  const filtered = useMemo(() => {
    let list = [...truckRecords]

    if (statusFilter === 'active') list = list.filter(r => r.status.key === 'loaded')
    if (statusFilter === 'delivered') list = list.filter(r => r.status.key === 'offloaded')
    if (statusFilter === 'other') list = list.filter(r => r.status.key !== 'loaded' && r.status.key !== 'offloaded')
    if (pfiFilter) list = list.filter(r => String(r.pfiId) === pfiFilter)
    if (customerFilter) list = list.filter(r => String(r.customerId) === customerFilter)
    if (codeFilter) list = list.filter(r => r.code === codeFilter)
    if (truckFilter) list = list.filter(r => r.truckPlate === truckFilter)
    if (customerTypeFilter !== 'all') {
      list = list.filter(r => customerTypeFilter === 'filling_station' ? r.isFillingStation : !r.isFillingStation)
    }

    if (dateFrom || dateTo) {
      list = list.filter(r => {
        // dateLoaded is resolved from the ledger where the allocation itself
        // carries none; using the raw column dropped those rows from every
        // date range silently.
        const dateStr = r.dateOffloaded || r.dateLoaded
        if (!dateStr) return false
        try {
          const d = startOfDay(parseISO(dateStr))
          if (dateFrom && dateTo) return isWithinInterval(d, { start: startOfDay(parseISO(dateFrom)), end: endOfDay(parseISO(dateTo)) })
          if (dateFrom) return d >= startOfDay(parseISO(dateFrom))
          if (dateTo) return d <= endOfDay(parseISO(dateTo))
          return true
        } catch { return true }
      })
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(e =>
        (e.truckPlate || '').toLowerCase().includes(q) ||
        (e.driverName || '').toLowerCase().includes(q) ||
        (e.destination || '').toLowerCase().includes(q) ||
        (e.depotDisplay || '').toLowerCase().includes(q) ||
        (e.custName || '').toLowerCase().includes(q) ||
        (e.code || '').toLowerCase().includes(q) ||
        (e.pfiLabel || '').toLowerCase().includes(q) ||
        (e.product || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q)
      )
    }

    return list.sort((a, b) => {
      const dateA = a.dateOffloaded || a.dateLoaded || ''
      const dateB = b.dateOffloaded || b.dateLoaded || ''
      return dateB.localeCompare(dateA)
    })
  }, [truckRecords, statusFilter, pfiFilter, customerFilter, truckFilter, codeFilter, dateFrom, dateTo, searchQuery, customerTypeFilter])

  // Group filtered records by allocation code
  const grouped = useMemo((): [string, TruckRecord[]][] => {
    const map = new Map<string, TruckRecord[]>()
    filtered.forEach(r => {
      const key = r.code || ''
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    })

    map.forEach(records => {
      records.sort((x, y) => {
        const dateX = x.dateOffloaded || x.dateLoaded || ''
        const dateY = y.dateOffloaded || y.dateLoaded || ''
        return dateY.localeCompare(dateX)
      })
    })

    return [...map.entries()].sort(([, recordsA], [, recordsB]) => {
      const maxDateA = recordsA.reduce((max, r) => {
        const d = r.dateOffloaded || r.dateLoaded || ''
        return d > max ? d : max
      }, '')
      const maxDateB = recordsB.reduce((max, r) => {
        const d = r.dateOffloaded || r.dateLoaded || ''
        return d > max ? d : max
      }, '')
      return maxDateB.localeCompare(maxDateA)
    })
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // Derived / Summaries
  // ═══════════════════════════════════════════════════════════════════════════

  const totals = useMemo(() => {
    let activeCount = 0, totalInTransit = 0, totalDelivered = 0, deliveredTrips = 0
    let otherCount = 0, otherQty = 0
    filtered.forEach(r => {
      if (r.status.key === 'loaded') { activeCount++; totalInTransit += r.qty }
      else if (r.status.key === 'offloaded') { totalDelivered += r.qty; deliveredTrips++ }
      else { otherCount++; otherQty += r.qty }
    })
    return { activeCount, totalInTransit, totalDelivered, deliveredTrips, otherCount, otherQty }
  }, [filtered])

  const summaryCards = useMemo((): SummaryCard[] => [
    {
      title: 'Trucks in Transit',
      value: String(totals.activeCount),
      icon: <Truck className="size-5" />,
      tone: totals.activeCount > 0 ? 'amber' : 'neutral',
    },
    {
      title: 'Volume in Transit',
      value: `${fmtQty(totals.totalInTransit)} Ltrs`,
      icon: <Droplets className="size-5" />,
      tone: totals.totalInTransit > 0 ? 'amber' : 'neutral',
    },
    {
      title: 'Quantity Sold',
      value: `${fmtQty(totals.totalDelivered)} Ltrs`,
      icon: <CheckCircle2 className="size-5" />,
      tone: 'green',
    },
  ], [totals])

  const distinctTruckPlates = useMemo(() => {
    const set = new Set<string>()
    truckRecords.forEach(r => { if (r.truckPlate && r.truckPlate !== '—') set.add(r.truckPlate) })
    return [...set].sort()
  }, [truckRecords])

  const distinctCustomers = useMemo(() => {
    const map = new Map<string, string>()
    truckRecords.forEach(r => { if (r.customerId) map.set(String(r.customerId), r.custName) })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [truckRecords])

  const distinctAllocationCodes = useMemo(() => {
    const codes = new Set<string>()
    truckRecords.forEach(r => { if (r.code) codes.add(r.code) })
    const codeOrder = new Map<string, number>()
    deliveryCodes.forEach((c, i) => codeOrder.set(c, i))
    return [...codes].sort((a, b) => {
      const aR = codeOrder.get(a) ?? 10_000
      const bR = codeOrder.get(b) ?? 10_000
      return aR !== bR ? aR - bR : a.localeCompare(b)
    })
  }, [truckRecords, deliveryCodes])

  // ═══════════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const clearAllFilters = () => {
    setSearchQuery('')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
    setPfiFilter('')
    setCustomerFilter('')
    setTruckFilter('')
    setCodeFilter('')
    setCustomerTypeFilter('all')
  }

  const exportCSV = useCallback(() => {
    if (!filtered.length) return
    // A split load has to survive the export too — one row per truck with the
    // whole quantity, and the shares spelled out beside it rather than lost.
    const headers = ['S/N', 'Code', 'Truck', 'Driver', 'PFI / Code', 'Product', 'Depot', 'Customer', 'Destination', 'Quantity', 'Split', 'Customer Split', 'Rate', 'Status', 'Date Loaded', 'Date Sold']
    const rows = filtered.map((r, idx) => [
      idx + 1,
      r.code || '—',
      r.truckPlate,
      r.driverName || '—',
      r.pfiLabel || '—',
      r.product || '—',
      r.depotDisplay || '—',
      r.split.isSplit ? r.split.shares.map(sh => sh.customerName || 'Unassigned').join(' / ') : (r.custName || '—'),
      r.split.isSplit ? r.split.shares.map(sh => sh.destination || '—').join(' / ') : (r.destination || '—'),
      r.qty,
      r.split.isSplit ? `${r.split.shares.length} customers` : 'Whole load',
      formatShareList(r.split) || '—',
      r.rate > 0 ? r.rate : '—',
      r.status.label,
      r.dateLoaded ? (() => { try { return format(parseISO(r.dateLoaded), 'dd/MM/yyyy') } catch { return r.dateLoaded } })() : '',
      r.dateOffloaded ? (() => { try { return format(parseISO(r.dateOffloaded), 'dd/MM/yyyy') } catch { return r.dateOffloaded } })() : '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DELIVERY-OPERATIONS-${format(new Date(), 'dd-MM-yyyy')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  const isLoading = isLoadingInventory

  /**
   * The active filters, as chips. Derived once.
   *
   * This list previously existed twice, character for character — once inside
   * a `.length > 0 &&` test and again inside the `.map` that rendered it. Two
   * copies of the same six entries is one edit away from a row that disagrees
   * with the filters actually applied.
   */
  const activeChips = useMemo(
    () => [
      statusFilter !== 'all' && {
        label: `Status: ${statusFilter === 'active' ? 'In transit' : statusFilter === 'delivered' ? 'Sold' : STATUS_DISPLAY.empty.label}`,
        clear: () => setStatusFilter('all'),
      },
      truckFilter && { label: `Truck: ${truckFilter}`, clear: () => setTruckFilter('') },
      customerFilter && {
        label: `Customer: ${distinctCustomers.find(([id]) => id === customerFilter)?.[1] || customerFilter}`,
        clear: () => setCustomerFilter(''),
      },
      customerTypeFilter !== 'all' && {
        label: `Type: ${customerTypeFilter === 'filling_station' ? 'Filling station' : 'Normal'}`,
        clear: () => setCustomerTypeFilter('all'),
      },
      codeFilter && { label: `Batch: ${codeFilter}`, clear: () => setCodeFilter('') },
      searchQuery && { label: `Search: "${searchQuery}"`, clear: () => setSearchQuery('') },
    ].filter((x): x is { label: string; clear: () => void } => !!x),
    [statusFilter, truckFilter, customerFilter, customerTypeFilter, codeFilter, searchQuery, distinctCustomers],
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        eyebrow="Truck Sales"
        title="Delivery Inventory"
        description="Stock loaded out on trucks, grouped by the batch it came from — what went out, where it went, and what has been sold."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 cursor-pointer" onClick={exportCSV} disabled={filtered.length === 0}>
              <Download className="size-4" /> Export
            </Button>
            <Button variant="outline" className="gap-2 cursor-pointer" onClick={() => setManageCodesOpen(true)}>
              <Settings className="size-4" /> Manage Codes
            </Button>
            <Link to="/delivery-operations/allocate-trucks">
              <Button className="gap-2 bg-accent hover:bg-accent/80 text-accent-foreground cursor-pointer">
                <Plus className="size-4" /> Allocate Trucks
              </Button>
            </Link>
          </div>
        }
      />

      {/* Summary Cards */}
      <SummaryCards cards={summaryCards} />

      {/*
        The same filter bar every other list page uses.

        This was a hand-rolled card holding five bare <select> elements with
        their own sizing, borders and uppercase labels — close to the app's
        controls without being them, which is the kind of near-miss that makes
        a product feel assembled rather than designed. The chip row below it
        was worse: the same six-entry array written out twice, once to test
        whether any chips existed and once to render them, so any edit had to
        be made in both places or the row would disagree with itself.
      */}
      <FilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search truck, PFI, product, customer, depot, destination, code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <NativeSelect
          className="w-40" aria-label="Filter by status"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="active">In transit</option>
          <option value="delivered">Sold</option>
          <option value="other">{STATUS_DISPLAY.empty.label}</option>
        </NativeSelect>

        <NativeSelect
          className="w-40" aria-label="Filter by truck"
          value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}
        >
          <option value="">All trucks</option>
          {distinctTruckPlates.map((plate) => <option key={plate} value={plate}>{plate}</option>)}
        </NativeSelect>

        <NativeSelect
          className="w-48" aria-label="Filter by customer"
          value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
        >
          <option value="">All customers</option>
          {distinctCustomers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </NativeSelect>

        <NativeSelect
          className="w-44" aria-label="Filter by customer type"
          value={customerTypeFilter} onChange={(e) => setCustomerTypeFilter(e.target.value as any)}
        >
          <option value="all">All customer types</option>
          <option value="normal">Normal only</option>
          <option value="filling_station">Filling stations only</option>
        </NativeSelect>

        <NativeSelect
          className="w-44" aria-label="Filter by allocation code"
          value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}
        >
          <option value="">All batches</option>
          {distinctAllocationCodes.map((code) => <option key={code} value={code}>{code}</option>)}
        </NativeSelect>

        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <FilterChip key={chip.label} label={chip.label} onClear={chip.clear} />
          ))}
        </div>
      )}

      {/* Allocation Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-16 text-center">
          <Truck className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground font-normal">
            {hasAnyFilter ? 'No records match your filters' : 'No truck records yet'}
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {hasAnyFilter
              ? 'Try adjusting your search, filters, or date range.'
              : 'Click "Allocate Trucks" to start tracking deliveries.'}
          </p>
          {hasAnyFilter && (
            <Button variant="outline" size="sm" className="mt-3 gap-1.5 cursor-pointer" onClick={clearAllFilters}>
              <X className="size-3.5" /> Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-1 gap-4">
            {grouped.map(([code, records]) => {
              const theme = code ? getCodeTheme(code) : null
              const totalQty = records.reduce((s, r) => s + r.qty, 0)
              const loadedCount = records.filter(r => r.status.key === 'loaded').length
              const soldCount = records.filter(r => r.status.key === 'offloaded').length
              const loadedQty = records.filter(r => r.status.key === 'loaded').reduce((s, r) => s + r.qty, 0)
              const soldQty = records.filter(r => r.status.key === 'offloaded').reduce((s, r) => s + r.qty, 0)
              // Neither loaded nor sold. Without this chip a card could read
              // "36 trucks" over two chips that counted none of them.
              const otherRecords = records.filter(r => r.status.key !== 'loaded' && r.status.key !== 'offloaded')
              const otherQty = otherRecords.reduce((s, r) => s + r.qty, 0)
              const unit = records[0]?.unitLabel || 'Litres'
              // Trucks on this batch sold to more than one customer. Worth
              // saying on the card: the volume above is whole trucks, and a
              // split one is read differently once you open it.
              const splitRecords = records.filter(r => r.split.isSplit)
              const splitQty = splitRecords.reduce((sum, r) => sum + r.qty, 0)

              const distinctPfis = [...new Set(records.map(r => r.pfiLabel).filter(Boolean))]
              const distinctProducts = [...new Set(records.map(r => r.product).filter(Boolean))]
              const distinctDepots = [...new Set(records.map(r => r.depotDisplay).filter(Boolean))]
              const distinctDestinations = [...new Set(records.map(r => r.destination).filter(Boolean))]

              const latestDate = records.reduce((max, r) => {
                const d = r.dateOffloaded || r.dateLoaded || ''
                return d > max ? d : max
              }, '')

              return (
                <Link
                  key={code || '__none__'}
                  to="/delivery-operations/allocation-details"
                  search={{ code }}
                  className="block group"
                >
                  <div className={cn(
                    'bg-card rounded-xl border border-border p-5 transition-all cursor-pointer space-y-3 duration-250 ease-luxe',
                    ' hover:border-accent/40 dark:hover:border-accent hover:-translate-y-0.5',
                    theme && `${theme.header}`
                  )}>
                    {/* Top: Code + Truck Count */}
                    <div className="flex items-start justify-between">
                      {code ? (
                        <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border', theme?.badge || 'bg-muted text-muted-foreground border-border')}>
                          <Tag className="size-3" /> {code}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground border-border">
                          <Tag className="size-3" /> No Code
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground bg-card/90 px-2.5 py-1 rounded-lg border border-border/80">
                        <Truck className="size-3.5 text-accent" />
                        {records.length} {records.length === 1 ? 'truck' : 'trucks'}
                      </span>
                    </div>

                    {/* Product & Depot */}
                    {(distinctProducts.length > 0 || distinctDepots.length > 0) && (
                      <div className="flex items-center justify-between gap-2 text-xs pt-0.5">
                        {distinctProducts.length > 0 && (
                          <span className="font-semibold text-accent bg-accent/80 dark:bg-accent/60 px-2 py-0.5 rounded text-xs">
                            {distinctProducts.join(', ')}
                          </span>
                        )}
                        {distinctDepots.length > 0 && (
                          <span className="truncate text-muted-foreground font-normal text-xs">
                            📍 {distinctDepots.join(', ')}
                          </span>
                        )}
                      </div>
                    )}

                    {/* PFI Reference */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">PFI Reference</div>
                      {distinctPfis.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {distinctPfis.slice(0, 3).map(pfi => (
                            <span key={pfi} className="text-xs font-semibold text-foreground bg-muted/60 px-2 py-0.5 rounded-md border border-border">
                              {pfi}
                            </span>
                          ))}
                          {distinctPfis.length > 3 && (
                            <span className="text-xs text-muted-foreground">+{distinctPfis.length - 3} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Total Quantity / Volume */}
                    <div className="space-y-1.5 bg-muted/80 dark:bg-foreground/60 p-2.5 rounded-lg border border-border/70 dark:border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-normal text-muted-foreground">Total Volume</span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground dark:text-muted-foreground">
                          <Droplets className="size-3.5 text-muted-foreground" />
                          {fmtQty(totalQty)} {unit}
                        </span>
                      </div>
                      {splitRecords.length > 0 && (
                        <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                          <span className="flex items-center gap-1 text-xs font-normal text-blue-700 dark:text-blue-300">
                            <Split className="size-3" />
                            {splitRecords.length} split {splitRecords.length === 1 ? 'load' : 'loads'}
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {fmtQty(splitQty)} {unit} across {splitRecords.reduce((n, r) => n + r.split.shares.length, 0)} customers
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {loadedCount > 0 && (
                        <span className="text-xs font-normal text-warning bg-warning/10 px-2 py-0.5 rounded-full border border-warning/40 dark:border-warning/20">
                          {loadedCount} in transit ({fmtQty(loadedQty)} L)
                        </span>
                      )}
                      {soldCount > 0 && (
                        <span className="text-xs font-normal text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/40 dark:border-accent/20">
                          {soldCount} sold ({fmtQty(soldQty)} L)
                        </span>
                      )}
                      {otherRecords.length > 0 && (
                        <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                          {otherRecords.length} {STATUS_DISPLAY.empty.label.toLowerCase()} ({fmtQty(otherQty)} L)
                        </span>
                      )}
                    </div>

                    {/* Latest Date & Destination Footer */}
                    {latestDate && (
                      <div className="pt-2.5 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="size-3" />
                          {(() => { try { return format(parseISO(latestDate), 'dd MMM yyyy') } catch { return latestDate } })()}
                        </span>
                        {distinctDestinations.length > 0 && (
                          <span className="truncate max-w-[140px] text-xs text-muted-foreground/80 font-normal" title={distinctDestinations.join(', ')}>
                            To: {distinctDestinations[0]} {distinctDestinations.length > 1 ? `+${distinctDestinations.length - 1}` : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground text-right">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''} in {grouped.length} allocation{grouped.length !== 1 ? 's' : ''}
          </p>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Dialogs */}
      <ManageCodesDialog
        open={manageCodesOpen}
        onOpenChange={setManageCodesOpen}
        deliveryCodes={deliveryCodes}
        setDeliveryCodes={setDeliveryCodes}
        truckRecords={truckRecords}
        allEntries={allEntries}
        onRename={async (oldCode, newCode) => {
          const toUpdate = allEntries.filter(e => (e.allocationCode || '').trim().toUpperCase() === oldCode)
          await Promise.all(toUpdate.map(e =>
            updateInventory.mutateAsync({ id: e._id || e.id || '', data: { allocationCode: newCode } as any })
          ))
        }}
        toast={toast}
      />
    </div>
  )
}

/** The same chip the orders register uses, so a filter reads identically. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs uppercase">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-250 ease-luxe outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-2.5" />
        <span className="sr-only">Remove {label} filter</span>
      </button>
    </span>
  )
}
