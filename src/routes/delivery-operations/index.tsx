import { Fragment, useState, useMemo, useCallback, useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { FilterBar } from '#/components/FilterBar'
import { NativeSelect } from '#/components/ui/native-select'
import { SummaryCards, type SummaryCard } from '#/components/SummaryCards'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '#/components/ui/table'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '#/components/ui/empty'
import { PANEL, PANEL_RAIL, MICRO } from '#/lib/panel'
// The same formatter the PFI screens use, so a rate reads identically
// wherever it appears — sign before the symbol, two decimals always.
import { naira } from '#/routes/pfi/-pfi-utils'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Plus, Search, Truck, Droplets, CheckCircle2, X, Settings, Wallet,
  ChevronRight, Loader2, Trash2, AlertTriangle, FileSpreadsheet, FileText, RotateCcw,
} from 'lucide-react'
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import {
  useDeliveryInventoryList, useUpdateDeliveryInventory, useDeleteDeliveryBatch,
  useDeliveryBatchStatuses, useSetDeliveryBatchStatus,
} from '#/lib/hooks/useDeliveryInventory'
import { useRoles } from '#/lib/hooks/useRoles'
import { useDeliverySalesList } from '#/lib/hooks/useDeliverySales'
import { usePfiList } from '#/lib/hooks/usePfis'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { useToast } from '#/lib/hooks/useToast'
import { cn } from '#/lib/utils'
import {
  buildTruckIndex, loadMoney, matchSalesByRecord, resolveLoading, shareMoney, STATUS_DISPLAY,
  type LoadMoney, type ResolvedLoading,
} from '#/lib/delivery-records'
import { buildLoadSplit, formatShareList, type LoadSplit } from '#/lib/load-split'
import type { DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import type { Pfi } from '#/lib/hooks/usePfis'

import { ManageCodesDialog } from '#/components/delivery-operations/ManageCodesDialog'
import { NewBatchDialog } from '#/components/delivery-operations/NewBatchDialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { routeGuard } from '#/lib/route-guard'
import {
  exportDeliveryInventoryExcel, exportDeliveryInventoryPdf,
  type DeliveryInventoryFilters, type ExportBatch,
} from './-delivery-inventory-export'

export const Route = createFileRoute('/delivery-operations/')({
  beforeLoad: () => routeGuard('/delivery-operations'),
  component: DeliveryOperationsPage,
})

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

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
  /** What it is worth, what has come in, what is left. */
  money: LoadMoney
}

/**
 * A batch, however it is identified.
 *
 * `records` is empty on a delivery PFI with no trucks on it yet. It is still a
 * batch, and still the thing you open in order to put trucks on it.
 */
interface BatchGroup {
  key: string
  code: string
  records: TruckRecord[]
  /** The PFI behind the code, where there is one. */
  pfi?: Pfi
  /**
   * Closed, or still running.
   *
   * A batch has no row of its own — it is the loads sharing a code — so this
   * comes from delivery_batches, keyed by that code, and a code with no entry
   * there is active. Closing it says the delivery desk is finished with it and
   * deliberately leaves the PFI behind it alone; see migration 0028.
   */
  status: 'active' | 'completed'
  closedAt: string | null
  closedBy: string
}

/**
 * What a batch has on it that a delete must not quietly take away.
 *
 * A truck row is safe to remove while it is only a record that a truck went
 * out. The moment it carries a customer, a rate or a payment it is part of the
 * trading record, and deleting the batch would take a sale and its money with
 * it. Counted rather than merely flagged, so the dialog can say how much.
 */
function deleteBlockers(records: TruckRecord[]) {
  const sold = records.filter((r) => r.split.shares.length > 0 || r.custName)
  const rated = records.filter((r) => r.rate > 0)
  const paid = records.filter((r) => r.split.shares.some((sh) => sh.totalPaid > 0))
  return {
    sold: sold.length,
    rated: rated.length,
    paid: paid.length,
    blocked: sold.length > 0 || rated.length > 0 || paid.length > 0,
  }
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
  const deleteBatch = useDeleteDeliveryBatch()
  const { data: batchStatuses } = useDeliveryBatchStatuses()
  const setBatchStatus = useSetDeliveryBatchStatus()
  /** The batch a close or reopen has been asked for, awaiting confirmation. */
  const [closingBatch, setClosingBatch] = useState<BatchGroup | null>(null)
  // Deleting a batch takes its whole trading record with it, so it sits behind
  // the same role that gates deleting an order.
  const { isSuperAdmin: canDelete } = useRoles()

  // ── Filters & Search ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [pfiFilter, setPfiFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [codeFilter, setCodeFilter] = useState('')
  /**
   * Active batches or closed ones. Defaults to active: a register whose whole
   * point is what is running should not open on a list that is mostly
   * finished, and the finished ones are one select away.
   */
  const [batchStatusFilter, setBatchStatusFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [customerTypeFilter, setCustomerTypeFilter] = useState<'all' | 'filling_station' | 'normal'>('all')

  // ── Allocation Codes ────────────────────────────────────────────────────
  const [deliveryCodes, setDeliveryCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_trip_codes') || '[]') } catch { return [] }
  })
  const [manageCodesOpen, setManageCodesOpen] = useState(false)
  const [newBatchOpen, setNewBatchOpen] = useState(false)
  /**
   * Which batch is open, by code. One at a time, deliberately: the point of
   * the summary rows is that batches can be compared down a column, and every
   * batch expanded at once is the wall of cards this replaced.
   */
  const [openBatch, setOpenBatch] = useState<string | null>(null)
  /** The batch a delete has been asked for, awaiting confirmation. */
  const [deletingBatch, setDeletingBatch] = useState<BatchGroup | null>(null)

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
      const resolved = resolveLoading(entry, { truck, customer, pfi, sales, customers: customerMap })
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
        // The rate resolved above is the fallback: a share with no rate of its
        // own is still priced by whatever was typed onto the allocation.
        money: loadMoney(split, resolved.rate),
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
  const hasAnyFilter = !!(searchQuery || hasDateFilter || statusFilter !== 'all' || pfiFilter || customerFilter || truckFilter || codeFilter || customerTypeFilter !== 'all' || batchStatusFilter !== 'active')

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
  /**
   * The unit the figures are in, named once in the headers rather than on
   * every cell.
   *
   * Null when the filtered set holds more than one — LPG is in kilograms and
   * fuel in litres, and a column headed "(Litres)" over a mixed list would be
   * wrong about half of it. Then the header stays bare and the cells carry
   * their own unit, which is the only honest way round.
   */
  const pageUnit = useMemo(() => {
    const units = new Set(filtered.map(r => r.unitLabel).filter(Boolean))
    return units.size === 1 ? [...units][0] : null
  }, [filtered])

  /**
   * One row per batch, and a batch is something that has been loaded.
   *
   * Grouped by allocation code over the truck rows — which is also what makes
   * "the batches raised here" true by construction: loading happens on this
   * page, so a batch appears once it has been. A delivery PFI raised in the
   * PFI module carries no loads until somebody adds them here, and until then
   * it belongs to that module rather than to this list.
   *
   * The PFI behind a code is attached where there is one, but never creates a
   * row of its own. It is matched by pfi_id first and by name second, because
   * both links exist in the data — PFI-14B, PFI-19B and PFI-24B carry a pfi_id
   * on their rows while PFI-25C, PFI-36C and PFI-40B are name-only — and it is
   * what lets a batch be deleted as one thing rather than as a pile of rows.
   */
  const grouped = useMemo((): BatchGroup[] => {
    const map = new Map<string, BatchGroup>()
    const norm = (v: string) => v.trim().toUpperCase()

    filtered.forEach(r => {
      const code = r.code || ''
      const key = norm(code)
      const group = map.get(key) ?? {
        key,
        code,
        records: [],
        // Keyed by the same normalised code the register groups on, so
        // "pfi-40b" and "PFI-40B " cannot end up one open and one closed.
        status: (batchStatuses?.[key]?.status ?? 'active') as 'active' | 'completed',
        closedAt: batchStatuses?.[key]?.closedAt ?? null,
        closedBy: batchStatuses?.[key]?.closedBy ?? '',
      }
      group.records.push(r)
      map.set(key, group)
    })

    for (const pfi of allPfis) {
      if (pfi.pfiType !== 'delivery') continue
      const number = String(pfi.pfiNumber || '')
      if (!number) continue
      const byName = map.get(norm(number))
      const match = byName ?? [...map.values()].find(
        (g) => g.records.some((r) => r.pfiId != null && String(r.pfiId) === String(pfi.id)),
      )
      if (match) match.pfi = pfi
    }

    map.forEach(({ records }) => {
      records.sort((x, y) => {
        const dateX = x.dateOffloaded || x.dateLoaded || ''
        const dateY = y.dateOffloaded || y.dateLoaded || ''
        return dateY.localeCompare(dateX)
      })
    })

    /**
     * Z to A by code, not newest first.
     *
     * Batches are looked for by name — somebody has PFI-40B written on a
     * waybill in their hand — and a list ordered by last movement moves a
     * batch every time a truck on it is touched, so the row is never twice in
     * the same place. Codes are compared numerically as well as
     * alphabetically, or PFI-9C would outrank PFI-40B on the strength of its
     * first digit.
     */
    /**
     * The status filter is applied here rather than over the truck rows,
     * because it is a fact about the batch and not about any load on it.
     * Everything downstream — the totals, the export — then describes the
     * same set the table shows.
     */
    const visible = [...map.values()].filter(
      (g) => batchStatusFilter === 'all' || g.status === batchStatusFilter,
    )

    return visible.sort((a, b) =>
      b.code.localeCompare(a.code, undefined, { numeric: true, sensitivity: 'base' }),
    )
  }, [filtered, allPfis, batchStatuses, batchStatusFilter])

  // ═══════════════════════════════════════════════════════════════════════════
  // Derived / Summaries
  // ═══════════════════════════════════════════════════════════════════════════

  const totals = useMemo(() => {
    let unsoldCount = 0, unsoldQty = 0, totalDelivered = 0, deliveredTrips = 0
    let otherCount = 0, otherQty = 0
    let expected = 0, paid = 0, outstanding = 0
    filtered.forEach(r => {
      if (r.status.key === 'loaded') { unsoldCount++; unsoldQty += r.qty }
      else if (r.status.key === 'offloaded') { totalDelivered += r.qty; deliveredTrips++ }
      else { otherCount++; otherQty += r.qty }
      expected += r.money.expected
      paid += r.money.paid
      // Owings only. Netting an overpaid truck against an owing one reports a
      // book that is square when neither of them is.
      if (r.money.balance > 0) outstanding += r.money.balance
    })
    return {
      unsoldCount, unsoldQty, totalDelivered, deliveredTrips, otherCount, otherQty,
      expected, paid, outstanding,
    }
  }, [filtered])

  const summaryCards = useMemo((): SummaryCard[] => [
    {
      title: 'Trucks Unsold',
      value: String(totals.unsoldCount),
      icon: <Truck className="size-5" />,
      tone: totals.unsoldCount > 0 ? 'amber' : 'neutral',
    },
    {
      title: 'Volume Unsold',
      value: `${fmtQty(totals.unsoldQty)} Ltrs`,
      icon: <Droplets className="size-5" />,
      tone: totals.unsoldQty > 0 ? 'amber' : 'neutral',
    },
    {
      title: 'Quantity Sold',
      value: `${fmtQty(totals.totalDelivered)} Ltrs`,
      icon: <CheckCircle2 className="size-5" />,
      tone: 'green',
    },
    // The money the batches are still owed, on the page that lists them —
    // this used to mean opening the sales ledger and filtering it by code.
    {
      title: 'Outstanding',
      value: naira(totals.outstanding),
      icon: <Wallet className="size-5" />,
      tone: totals.outstanding > 0 ? 'amber' : 'green',
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
    // Back to the register's own default, not to "all" — clearing filters
    // should leave the page as it opens, and it opens on what is running.
    setBatchStatusFilter('active')
  }

  /**
   * The table, as a file — one batch row with its trucks underneath it.
   *
   * This was a flat CSV of truck rows with no batch totals and no money on it
   * at all, so the file was the table with its structure and its point taken
   * out. Both writers are handed the same batches this page is showing,
   * filters and all, and the file says which filters those were.
   */
  const exportBatches = useMemo((): ExportBatch[] => grouped.map(({ code, records }) => ({
    code,
    product: [...new Set(records.map(r => r.product).filter(Boolean))].join(', '),
    depot: [...new Set(records.map(r => r.depotDisplay).filter(Boolean))].join(', '),
    dateLoaded: records.reduce((min, r) => {
      const d = r.dateLoaded || ''
      if (!d) return min
      return !min || d < min ? d : min
    }, ''),
    records,
  })), [grouped])

  const exportFilters = useMemo((): DeliveryInventoryFilters => ({
    status: statusFilter === 'all' ? '' : statusFilter === 'active' ? 'Unsold'
      : statusFilter === 'delivered' ? 'Sold' : STATUS_DISPLAY.empty.label,
    truck: truckFilter,
    customer: distinctCustomers.find(([id]) => id === customerFilter)?.[1] || '',
    customerType: customerTypeFilter === 'all' ? ''
      : customerTypeFilter === 'filling_station' ? 'Filling stations' : 'Normal',
    code: codeFilter,
    search: searchQuery,
    dateFrom,
    dateTo,
  }), [statusFilter, truckFilter, customerFilter, customerTypeFilter, codeFilter, searchQuery, dateFrom, dateTo, distinctCustomers])

  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const runExport = useCallback(async (kind: 'excel' | 'pdf') => {
    if (!exportBatches.length) return
    setExporting(kind)
    try {
      if (kind === 'excel') await exportDeliveryInventoryExcel(exportBatches, exportFilters)
      else await exportDeliveryInventoryPdf(exportBatches, exportFilters)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }, [exportBatches, exportFilters, toast])

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
        label: `Status: ${statusFilter === 'active' ? 'Unsold' : statusFilter === 'delivered' ? 'Sold' : STATUS_DISPLAY.empty.label}`,
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
        /*
          One action, not three.

          This header carried Manage Codes, New Batch and Allocate Trucks side
          by side — three doors onto one thing. An allocation code IS a batch:
          naming it is creating the batch, and putting trucks on it is building
          that batch's manifest. Three buttons made them read as three separate
          jobs to be done in an order nobody had written down.

          Creating a batch is now the only entry point, and it opens a dialog
          that can finish the job — code, depot, product, date, the trucks and
          what each one loaded. What it does NOT do is raise a PFI: a batch is
          the code on the loading papers and the loads recorded under it, and
          nothing else holds it together. Everything done to a batch
          afterwards — selling its loads, editing a record — lives on that
          batch's own page, reached by opening it.
        */
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline" className="gap-2 cursor-pointer"
              onClick={() => runExport('excel')}
              disabled={exporting !== null || grouped.length === 0}
            >
              {exporting === 'excel'
                ? <Loader2 className="size-4 animate-spin" />
                : <FileSpreadsheet className="size-4" />}
              Excel
            </Button>
            <Button
              variant="outline" className="gap-2 cursor-pointer"
              onClick={() => runExport('pdf')}
              disabled={exporting !== null || grouped.length === 0}
            >
              {exporting === 'pdf'
                ? <Loader2 className="size-4 animate-spin" />
                : <FileText className="size-4" />}
              PDF
            </Button>
            <Button
              className="gap-2 bg-accent hover:bg-accent/80 text-accent-foreground cursor-pointer"
              onClick={() => setNewBatchOpen(true)}
            >
              <Plus className="size-4" /> New Batch
            </Button>
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
            placeholder="Search truck, batch, product, customer, depot, destination…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <NativeSelect
          className="w-40" aria-label="Filter by status"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="active">Unsold</option>
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
          className="w-44" aria-label="Filter by batch"
          value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}
        >
          <option value="">All batches</option>
          {distinctAllocationCodes.map((code) => <option key={code} value={code}>{code}</option>)}
        </NativeSelect>

        {/* Open or closed. Named for the batch rather than for its loads —
            the select two along filters trucks by where they are, and the two
            would otherwise read as the same question asked twice. */}
        <NativeSelect
          className="w-40" aria-label="Filter by batch status"
          value={batchStatusFilter}
          onChange={(e) => setBatchStatusFilter(e.target.value as 'active' | 'completed' | 'all')}
        >
          <option value="active">Active batches</option>
          <option value="completed">Completed batches</option>
          <option value="all">All batches, any status</option>
        </NativeSelect>

        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}

        {/*
          Renaming and deleting a code, demoted rather than deleted.

          Creating a code is now creating a batch, so that half of this dialog
          is gone from the header. Renaming and deleting are not — a rename
          here cascades to every truck record carrying the code, and it is the
          only way to do either. What it is not is a peer of "New Batch": it is
          housekeeping on an existing list, so it sits with the filters where
          housekeeping belongs, not beside the one thing this page is for.
        */}
        <Button
          variant="ghost" size="sm" className="ml-auto"
          onClick={() => setManageCodesOpen(true)}
        >
          <Settings data-icon="inline-start" />
          Rename or delete codes
        </Button>
      </FilterBar>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <FilterChip key={chip.label} label={chip.label} onClear={chip.clear} />
          ))}
        </div>
      )}

      {/*
        Batches as rows, not as a wall of cards.

        Every batch used to be a full-width card carrying six stacked sections
        — a code badge, a product pill, a "PFI Reference" list, a boxed volume
        figure, status chips and a date footer — in a grid declared
        grid-cols-1 sm:grid-cols-1 lg:grid-cols-1, so one batch filled most of
        a screen and comparing two meant scrolling between them. The card was
        also tinted by a hash of its own code, which put every batch on a
        different background for no reason a reader could act on, and painted
        the product name text-accent on bg-accent/80.

        A batch is a handful of figures. Figures belong in aligned columns:
        the same eight facts, one row each, in the table idiom every other
        list page in the app already uses. Opening a row shows the trucks
        underneath it — the thing the card could never do, because it had no
        room left.
      */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia><Truck /></EmptyMedia>
            <EmptyTitle>{hasAnyFilter ? 'No records match your filters' : 'No truck records yet'}</EmptyTitle>
            <EmptyDescription>
              {hasAnyFilter
                ? 'Try adjusting your search, filters, or date range.'
                : 'Create a batch and tick the trucks that carried it.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {hasAnyFilter ? (
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                <X data-icon="inline-start" /> Clear all filters
              </Button>
            ) : (
              <Button onClick={() => setNewBatchOpen(true)}>
                <Plus data-icon="inline-start" /> New batch
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Batches</span>
            <span className={cn(MICRO, 'text-muted-foreground')}>
              {filtered.length} truck{filtered.length === 1 ? '' : 's'} in {grouped.length} batch{grouped.length === 1 ? '' : 'es'}
            </span>
          </div>

          <Table>
            <TableHeader>
              {/*
                The batch, and the money on it, without opening anything.

                These columns used to be a count and a volume for each of "in
                transit" and "sold" — four columns saying the same two things
                twice — and no money at all, so knowing what a batch was worth
                meant opening it and then opening the ledger. The volumes are
                still a click away in the trucks below; what could not be got
                at any distance was the value, so it takes the width.
              */}
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="w-8" />
                <TableHead className="font-semibold text-muted-foreground">Batch</TableHead>
                <TableHead className="font-semibold text-muted-foreground">Product</TableHead>
                <TableHead className="font-semibold text-muted-foreground">Loaded at</TableHead>
                <TableHead className="font-semibold text-muted-foreground">Date loaded</TableHead>
                <TableHead className="text-right font-semibold text-muted-foreground">Trucks</TableHead>
                <TableHead className="text-right font-semibold text-muted-foreground">
                  Volume{pageUnit ? ` (${pageUnit})` : ''}
                </TableHead>
                <TableHead className="text-right font-semibold text-warning">Unsold</TableHead>
                <TableHead className="text-right font-semibold text-accent">Sold</TableHead>
                <TableHead className="text-right font-semibold text-muted-foreground">Value</TableHead>
                <TableHead className="text-right font-semibold text-accent">Paid</TableHead>
                <TableHead className="text-right font-semibold text-muted-foreground">Balance</TableHead>
                <TableHead className="w-8" />
                <TableHead className="w-8" />
                {canDelete && <TableHead className="w-8" />}
              </TableRow>
            </TableHeader>

            <TableBody>
              {grouped.map(({ key, code, records, pfi, status, closedAt, closedBy }) => {
                const isOpen = openBatch === key
                const isClosed = status === 'completed'
                const unit = records[0]?.unitLabel || pfi?.productUnit || 'Litres'
                const totalQty = records.reduce((s, r) => s + r.qty, 0)

                const loaded = records.filter(r => r.status.key === 'loaded')
                const sold = records.filter(r => r.status.key === 'offloaded')
                // Neither loaded nor sold. Counted separately or the two
                // columns above could read 0 and 0 over a batch of 36 trucks.
                const other = records.filter(r => r.status.key !== 'loaded' && r.status.key !== 'offloaded')

                const products = [...new Set(records.map(r => r.product).filter(Boolean))]
                const depots = [...new Set(records.map(r => r.depotDisplay).filter(Boolean))]
                // When the batch loaded — the earliest of its trucks. A batch
                // that went out over two days is dated by the day it started,
                // not by whichever truck was touched last.
                const loadDate = records.reduce((min, r) => {
                  const d = r.dateLoaded || ''
                  if (!d) return min
                  return !min || d < min ? d : min
                }, '')
                const money = records.reduce((acc, r) => ({
                  expected: acc.expected + r.money.expected,
                  paid: acc.paid + r.money.paid,
                  balance: acc.balance + r.money.balance,
                }), { expected: 0, paid: 0, balance: 0 })

                return (
                  <Fragment key={key}>
                    <TableRow
                      className="cursor-pointer bg-card"
                      onClick={() => setOpenBatch(isOpen ? null : key)}
                    >
                      <TableCell className="pr-0 text-muted-foreground">
                        <ChevronRight className={cn('size-4 transition-transform duration-250 ease-luxe', isOpen && 'rotate-90')} />
                      </TableCell>
                      <TableCell>
                        {/* The name links out; the rest of the row expands.
                            Two things to do with a batch, and clicking the name
                            of it is the one that means "open it". */}
                        <div className="flex items-center gap-2">
                          <Link
                            to="/delivery-operations/allocation-details"
                            search={{ code }}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              'font-semibold uppercase underline-offset-4 hover:underline',
                              // A closed batch is still worth opening — it is
                              // the record of what happened — but it should
                              // not compete with the running ones for
                              // attention while scanning the register.
                              isClosed && 'text-muted-foreground',
                            )}
                          >
                            {code || 'No code'}
                          </Link>
                          {isClosed && (
                            <StatusChip
                              tone="inert"
                              title={
                                closedBy
                                  ? `Closed by ${closedBy}${closedAt ? ` on ${format(parseISO(closedAt), 'dd MMM yyyy')}` : ''}`
                                  : 'Closed'
                              }
                            >
                              Completed
                            </StatusChip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {products.length ? products.join(', ') : '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground" title={depots.join(', ')}>
                        {depots.length ? depots.join(', ') : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {loadDate
                          ? (() => { try { return format(parseISO(loadDate), 'dd MMM yyyy') } catch { return loadDate } })()
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{records.length}</TableCell>
                      {/* The unit rides in the header when the whole page is
                          in one, and on the cell when it is not — this page
                          carries LPG in kilograms as well as fuel in litres,
                          so neither placement is right for both. */}
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtQty(totalQty)}
                        {!pageUnit && <span className="font-normal text-muted-foreground"> {unit}</span>}
                      </TableCell>
                      {/* Counts, with the volume behind each on the cell —
                          the volumes had columns of their own and said the
                          same thing twice, and the money needed the width
                          more than a second copy of the quantity did. */}
                      <TableCell
                        className="text-right tabular-nums"
                        title={loaded.length ? `${fmtQty(loaded.reduce((s, r) => s + r.qty, 0))} ${unit} unsold` : undefined}
                      >
                        {loaded.length
                          ? <span className="font-semibold text-warning">{loaded.length}</span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={sold.length ? `${fmtQty(sold.reduce((s, r) => s + r.qty, 0))} ${unit} sold` : undefined}
                      >
                        {sold.length
                          ? <span className="font-semibold text-accent">{sold.length}</span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      {/* A batch nobody has priced is worth "—", never ₦0:
                          those are different facts and only one of them is
                          about the trading. */}
                      <TableCell className="text-right tabular-nums">
                        {money.expected > 0
                          ? naira(money.expected)
                          : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money.paid > 0
                          ? <span className="text-accent">{naira(money.paid)}</span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money.expected > 0
                          ? <span className={money.balance > 0 ? 'text-destructive' : 'text-accent'}>
                              {naira(money.balance)}
                            </span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="pl-0">
                        {other.length > 0 && (
                          <StatusChip tone="inert" title={`${other.length} ${STATUS_DISPLAY.empty.label.toLowerCase()}`}>
                            {other.length}
                          </StatusChip>
                        )}
                      </TableCell>
                      <TableCell className="pl-0">
                        {/* Closing is not deleting: the batch and everything
                            on it stays exactly where it is, and the register
                            simply stops offering it as work in hand. Which is
                            why it needs no permission check and no blockers —
                            it takes nothing away, and it is reversible from
                            the same button. */}
                        <Button
                          variant="ghost" size="icon-sm"
                          className={isClosed ? 'text-muted-foreground' : 'text-accent hover:bg-accent/10 hover:text-accent'}
                          title={isClosed ? `Reopen ${code || 'this batch'}` : `Close ${code || 'this batch'}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setClosingBatch({ key, code, records, pfi, status, closedAt, closedBy })
                          }}
                        >
                          {isClosed ? <RotateCcw /> : <CheckCircle2 />}
                          <span className="sr-only">{isClosed ? 'Reopen' : 'Close'} {code}</span>
                        </Button>
                      </TableCell>
                      {canDelete && (
                        <TableCell className="pl-0">
                          {/* Offered on every batch and refused inside the
                              dialog rather than hidden here: "why can I not
                              delete this" is a question worth answering, and a
                              missing button answers nothing. */}
                          <Button
                            variant="ghost" size="icon-sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title={`Delete ${code || 'this batch'}`}
                            onClick={(e) => { e.stopPropagation(); setDeletingBatch({ key, code, records, pfi, status, closedAt, closedBy }) }}
                          >
                            <Trash2 />
                            <span className="sr-only">Delete {code}</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>

                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={canDelete ? 15 : 14} className="bg-muted/30 p-0">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="pl-12 font-semibold text-muted-foreground">Truck</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Driver</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Customer</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Destination</TableHead>
                                <TableHead className="text-right font-semibold text-muted-foreground">
                                  Quantity{pageUnit ? ` (${pageUnit})` : ''}
                                </TableHead>
                                <TableHead className="text-right font-semibold text-muted-foreground">Rate</TableHead>
                                <TableHead className="text-right font-semibold text-muted-foreground">Value</TableHead>
                                <TableHead className="text-right font-semibold text-accent">Paid</TableHead>
                                <TableHead className="text-right font-semibold text-muted-foreground">Balance</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Loaded</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {records.map((r) => {
                                const loadedOn = r.dateLoaded
                                  ? (() => { try { return format(parseISO(r.dateLoaded), 'dd MMM yyyy') } catch { return r.dateLoaded } })()
                                  : '—'
                                const tone = r.status.key === 'offloaded' ? 'accent'
                                  : r.status.key === 'loaded' ? 'warning' : 'inert'

                                return (
                                  <Fragment key={r._id || r.id}>
                                    <TableRow className="hover:bg-muted/50">
                                      <TableCell className="pl-12 font-semibold">{r.truckPlate || '—'}</TableCell>
                                      <TableCell className="text-muted-foreground">{r.driverName || '—'}</TableCell>
                                      {/* On a split load the truck's own row
                                          holds the whole truck — its total,
                                          its status, its date — and each
                                          customer gets a row of its own
                                          beneath. Naming a count here instead
                                          ("2 customers") put the answer behind
                                          a second click on a page whose entire
                                          job is to say who has what. */}
                                      <TableCell
                                        className="max-w-[200px] truncate"
                                        title={r.split.isSplit ? formatShareList(r.split) : r.custName}
                                      >
                                        {r.split.isSplit
                                          ? <span className="text-muted-foreground">Split across {r.split.shares.length}</span>
                                          : (r.custName || <span className="text-muted-foreground/50">Unassigned</span>)}
                                      </TableCell>
                                      <TableCell className="max-w-[160px] truncate text-muted-foreground" title={r.destination}>
                                        {r.split.isSplit ? '' : (r.destination || '—')}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {fmtQty(r.qty)}
                                        {!pageUnit && <span className="font-normal text-muted-foreground"> {r.unitLabel}</span>}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums text-muted-foreground">
                                        {r.split.isSplit ? '' : r.rate > 0 ? naira(r.rate) : '—'}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {r.money.expected > 0
                                          ? naira(r.money.expected)
                                          : <span className="text-muted-foreground/50">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">
                                        {r.money.paid > 0
                                          ? <span className="text-accent">{naira(r.money.paid)}</span>
                                          : <span className="text-muted-foreground/50">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums">
                                        {r.money.expected > 0
                                          ? <span className={r.money.balance > 0 ? 'text-destructive' : 'text-accent'}>
                                              {naira(r.money.balance)}
                                            </span>
                                          : <span className="text-muted-foreground/50">—</span>}
                                      </TableCell>
                                      <TableCell><StatusChip tone={tone}>{r.status.label}</StatusChip></TableCell>
                                      <TableCell className="text-muted-foreground">{loadedOn}</TableCell>
                                    </TableRow>

                                    {/* Same row, same columns, same type — a
                                        share is a line of this truck's load,
                                        not a different kind of thing that
                                        needs its own styling to prove it. The
                                        left rule is what says these belong to
                                        the truck above rather than sitting
                                        beside it. */}
                                    {r.split.isSplit && r.split.shares.map((share, i) => (
                                      <TableRow key={`${r._id || r.id}-${i}`} className="hover:bg-muted/50">
                                        <TableCell />
                                        <TableCell />
                                        <TableCell className="max-w-[200px] truncate border-l-2 border-foreground/15 pl-3">
                                          {share.customerName || <span className="text-muted-foreground/50">Unassigned</span>}
                                        </TableCell>
                                        <TableCell className="max-w-[160px] truncate text-muted-foreground" title={share.destination}>
                                          {share.destination || '—'}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                          {fmtQty(share.quantity)}
                                          {!pageUnit && <span className="text-muted-foreground"> {r.unitLabel}</span>}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums text-muted-foreground">
                                          {share.rate > 0 ? naira(share.rate) : '—'}
                                        </TableCell>
                                        {(() => {
                                          // Priced exactly as the truck above
                                          // is, so the shares add up to it.
                                          const m = shareMoney(share, r.rate)
                                          return (
                                            <>
                                              <TableCell className="text-right tabular-nums">
                                                {m.expected > 0
                                                  ? naira(m.expected)
                                                  : <span className="text-muted-foreground/50">—</span>}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums">
                                                {m.paid > 0
                                                  ? <span className="text-accent">{naira(m.paid)}</span>
                                                  : <span className="text-muted-foreground/50">—</span>}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums">
                                                {m.expected > 0
                                                  ? <span className={m.balance > 0 ? 'text-destructive' : 'text-accent'}>
                                                      {naira(m.balance)}
                                                    </span>
                                                  : <span className="text-muted-foreground/50">—</span>}
                                              </TableCell>
                                            </>
                                          )
                                        })()}
                                        <TableCell />
                                        <TableCell />
                                      </TableRow>
                                    ))}

                                    {/* Loaded but sold to nobody yet. Shown as
                                        a share because that is what it is —
                                        the part of the truck still to be
                                        assigned — and leaving it out made the
                                        shares fail to add up to the truck. */}
                                    {r.split.isSplit && r.split.unassigned > 0 && (
                                      <TableRow className="hover:bg-muted/50">
                                        <TableCell />
                                        <TableCell />
                                        <TableCell className="border-l-2 border-foreground/15 pl-3 text-muted-foreground/50">
                                          Unassigned
                                        </TableCell>
                                        <TableCell />
                                        <TableCell className="text-right tabular-nums text-muted-foreground">
                                          {fmtQty(r.split.unassigned)}
                                          {!pageUnit && <span> {r.unitLabel}</span>}
                                        </TableCell>
                                        <TableCell />
                                        <TableCell />
                                        <TableCell />
                                        <TableCell />
                                        <TableCell />
                                        <TableCell />
                                      </TableRow>
                                    )}
                                  </Fragment>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Dialogs */}
      <NewBatchDialog
        open={newBatchOpen}
        onOpenChange={setNewBatchOpen}
        existingCodes={deliveryCodes}
      />

      {/* ── Closing a batch, and reopening it ──────────────────────────── */}
      <Dialog
        open={closingBatch !== null}
        onOpenChange={(open) => { if (!open && !setBatchStatus.isPending) setClosingBatch(null) }}
      >
        <DialogContent className="max-w-lg">
          {(() => {
            const batch = closingBatch
            if (!batch) return null
            const closing = batch.status !== 'completed'
            // Worth saying out loud before closing: a batch with trucks still
            // out, or money still owed, is usually not finished. Stated, never
            // blocked — the desk knows things the register does not, and a
            // close is undone with the same button.
            const unsold = batch.records.filter((r) => r.status.key !== 'offloaded').length
            const owed = batch.records.reduce((sum, r) => sum + r.money.balance, 0)

            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {closing ? `Close ${batch.code || 'this batch'}?` : `Reopen ${batch.code || 'this batch'}?`}
                  </DialogTitle>
                  <DialogDescription>
                    {closing
                      ? 'The batch and every truck, sale and payment on it stay exactly as they are. It moves out of the active list, and you can reopen it at any time.'
                      : 'The batch goes back to the active list. Nothing else about it changes.'}
                  </DialogDescription>
                </DialogHeader>

                {closing && (unsold > 0 || owed > 0.005) && (
                  <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {unsold > 0 && (
                        <>This batch still has <strong>{unsold} truck{unsold === 1 ? '' : 's'}</strong> not marked sold. </>
                      )}
                      {owed > 0.005 && (
                        <><strong>{naira(owed)}</strong> is still owed on it. </>
                      )}
                      You can close it anyway.
                    </span>
                  </div>
                )}

                {!closing && batch.closedBy && (
                  <p className="text-sm text-muted-foreground">
                    Closed by {batch.closedBy}
                    {batch.closedAt ? ` on ${format(parseISO(batch.closedAt), 'dd MMM yyyy')}` : ''}.
                  </p>
                )}

                {/* The PFI is deliberately left alone, and the dialog says so
                    rather than letting somebody discover it. Finishing a PFI
                    moves the finance report's stock summary, so it is a
                    decision taken on the PFI itself. */}
                {batch.pfi && (
                  <p className="text-xs text-muted-foreground">
                    {batch.pfi.pfiNumber} stays {batch.pfi.status === 'finished' ? 'finished' : 'as it is'} on the PFI
                    register — closing a batch here does not change its PFI.
                  </p>
                )}

                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={setBatchStatus.isPending}
                    onClick={() => setClosingBatch(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={setBatchStatus.isPending}
                    onClick={async () => {
                      await setBatchStatus.mutateAsync({
                        code: batch.code,
                        status: closing ? 'completed' : 'active',
                      })
                      setClosingBatch(null)
                    }}
                  >
                    {setBatchStatus.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                    {closing ? 'Close batch' : 'Reopen batch'}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Deleting a whole batch ─────────────────────────────────────── */}
      <Dialog
        open={deletingBatch !== null}
        onOpenChange={(open) => { if (!open && !deleteBatch.isPending) setDeletingBatch(null) }}
      >
        <DialogContent className="max-w-lg">
          {(() => {
            const batch = deletingBatch
            if (!batch) return null
            const blockers = deleteBlockers(batch.records)
            const qty = batch.records.reduce((sum, r) => sum + r.qty, 0)
            const unit = batch.records[0]?.unitLabel || batch.pfi?.productUnit || 'Litres'

            return (
              <>
                <DialogHeader>
                  <DialogTitle>Delete {batch.code || 'this batch'}?</DialogTitle>
                  <DialogDescription>
                    {blockers.blocked
                      ? 'This batch has been traded, so it cannot be deleted from here.'
                      : `This removes the batch and every truck record under it${batch.pfi ? ', including its PFI, its manifest and its locations' : ''}. It cannot be undone.`}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Truck records</span>
                      <span className="font-semibold tabular-nums">{fmtQty(batch.records.length)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-muted-foreground">Volume</span>
                      <span className="font-semibold tabular-nums">{fmtQty(qty)} {unit}</span>
                    </div>
                    {/* Only where there is one. Batches are codes and their
                        loads now; a PFI behind one means it was raised in the
                        PFI module, and that it goes too is worth saying. */}
                    {batch.pfi && (
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-muted-foreground">PFI</span>
                        <span className="font-semibold">{batch.pfi.pfiNumber}</span>
                      </div>
                    )}
                  </div>

                  {/* Named one by one, because "cannot delete" without saying
                      what is in the way is a dead end rather than an answer. */}
                  {blockers.blocked && (
                    <div className="space-y-1.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="size-3.5" />
                        Already traded
                      </p>
                      {blockers.sold > 0 && <p>{blockers.sold} load{blockers.sold === 1 ? '' : 's'} assigned to a customer.</p>}
                      {blockers.rated > 0 && <p>{blockers.rated} load{blockers.rated === 1 ? '' : 's'} carry a rate.</p>}
                      {blockers.paid > 0 && <p>{blockers.paid} load{blockers.paid === 1 ? '' : 's'} have payments recorded against them.</p>}
                      <p className="pt-1 text-muted-foreground">
                        Clear the sales and payments on those loads first — deleting the batch
                        would take that money record with it.
                      </p>
                    </div>
                  )}

                  {!blockers.blocked && batch.pfi && (
                    <p className="text-xs text-muted-foreground">
                      If any order is assigned to this PFI the server will refuse, and nothing
                      is deleted — the PFI goes first precisely so that failure costs nothing.
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={deleteBatch.isPending}
                    onClick={() => setDeletingBatch(null)}
                  >
                    {blockers.blocked ? 'Close' : 'Keep it'}
                  </Button>
                  {!blockers.blocked && (
                    <Button
                      variant="destructive"
                      disabled={deleteBatch.isPending}
                      onClick={async () => {
                        await deleteBatch.mutateAsync({
                          pfiId: batch.pfi?.id != null ? Number(batch.pfi.id) : null,
                          inventoryIds: batch.records
                            .map((r) => String(r._id || r.id || ''))
                            .filter(Boolean),
                          label: batch.code || 'Batch',
                        })
                        setDeletingBatch(null)
                        setOpenBatch(null)
                      }}
                    >
                      {deleteBatch.isPending && <Loader2 className="animate-spin" />}
                      Delete permanently
                    </Button>
                  )}
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

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
