import { useState, useMemo, useCallback } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '#/components/ui/table'
import {
  ArrowLeft, Truck, CheckCircle2,
  Trash2, Loader2, ShieldAlert, FileText,
  Tag, Pencil, X, Download, Droplets, Split,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useDeliveryInventoryList, useUpdateDeliveryInventory, useDeleteDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useDeliverySalesList, useDeleteDeliverySale } from '#/lib/hooks/useDeliverySales'
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
import { LoadQuantity, ShareList, SplitBadge } from '#/components/LoadSplit'
import type { DeliveryInventory, DeliverySale, DeliveryCustomer } from '#/lib/types'
import type { Pfi } from '#/lib/hooks/usePfis'

import { OffloadDialog } from '#/components/delivery-operations/OffloadDialog'
import { EditRecordDialog } from '#/components/delivery-operations/EditRecordDialog'
import { DeleteConfirmDialog } from '#/components/delivery-operations/DeleteConfirmDialog'
import { BulkAssignDialog } from '#/components/delivery-operations/BulkAssignDialog'
import { BulkDeleteDialog } from '#/components/delivery-operations/BulkDeleteDialog'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/delivery-operations/allocation-details')({
  beforeLoad: () => routeGuard('/delivery-operations'),
  validateSearch: (search: Record<string, unknown>) => ({
    code: (search.code as string) || '',
  }),
  component: AllocationDetailsPage,
})

const toNum = (v: string | number | undefined | null): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const fmtMoney = (n: number) => `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

/** Icon per status; labels and colours come from the shared STATUS_DISPLAY. */
const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  loaded: Truck,
  offloaded: CheckCircle2,
  empty: Droplets,
  unknown: Droplets,
}

// The resolved values win wherever they share a name with the raw row — that
// is the whole point of resolving them.
interface TruckRecord extends Omit<DeliveryInventory, keyof ResolvedLoading>, ResolvedLoading {
  /** Aliases the table has always used for the resolved fields. */
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

interface EditTarget {
  id: string
  truckPlate: string
  currentCode: string
  currentPfi: string
  currentDepot: string
  currentDate: string
  currentLocation: string
  currentRate: number
  currentQty: number
  assignedQty: number
  shareCount: number
}

interface EditForm {
  code: string
  pfi: string
  depot: string
  date: string
  location: string
  rate: string
  quantity: string
}

function AllocationDetailsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { code } = Route.useSearch()

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: rawInventory = [], isLoading: isLoadingInventory } = useDeliveryInventoryList()
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
  const deleteInventory = useDeleteDeliveryInventory()
  const deleteSale = useDeleteDeliverySale()

  // ── Lookup Maps ─────────────────────────────────────────────────────────
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

  // ── Enrich entries for this allocation code ─────────────────────────────
  const normalizedCode = (code || '').trim().toUpperCase()

  const codeEntries = useMemo((): DeliveryInventory[] => (
    allEntries.filter(e => {
      if (!(e.truckId || e.truckNumber || e.loadingStatus)) return false
      const entryCode = (e.allocationCode || (e as any).allocation_code || '').trim().toUpperCase()
      if (normalizedCode) return entryCode === normalizedCode
      return !entryCode
    })
  ), [allEntries, normalizedCode])

  /** Each allocation's sales, claimed once — see matchSalesByRecord. */
  const salesByRecord = useMemo(
    () => matchSalesByRecord(codeEntries, allSales), [codeEntries, allSales])

  const truckRecords = useMemo((): TruckRecord[] => {
    return codeEntries
      .map(entry => {
        const truck = truckIndex.find(entry)
        const customer = entry.customerId ? (customerMap.get(entry.customerId) || customerMap.get(Number(entry.customerId)) || customerMap.get(String(entry.customerId))) : null
        const pfi = entry.pfiId ? pfiMap.get(String(entry.pfiId)) : null
        const sales = salesByRecord.get(entry._id || entry.id || '') ?? []
        const resolved = resolveLoading(entry, { truck, customer, pfi, sales })
        const split = buildLoadSplit(entry, sales, customerMap)

        return {
          ...entry,
          ...resolved,
          depotDisplay: resolved.depot,
          custName: resolved.customerName,
          pfiLabel: resolved.batchLabel,
          unitLabel: pfi?.productUnit || 'Litres',
          // The whole truck. `quantity_allocated` on its own reported this
          // batch's KUJ228XC as 30,000 L when 45,000 went out on it, because a
          // split had overwritten the column with one customer's share.
          qty: split.total,
          split,
          code: (entry.allocationCode || (entry as any).allocation_code || '').trim().toUpperCase(),
          isFillingStation: isFillingStation(customer),
          notes: entry.notes || '',
        }
      })
      .sort((a, b) => {
        const dateA = a.dateOffloaded || a.dateLoaded || ''
        const dateB = b.dateOffloaded || b.dateLoaded || ''
        return dateB.localeCompare(dateA)
      })
  }, [codeEntries, truckIndex, customerMap, pfiMap, salesByRecord])

  // ── All matched sales for this allocation ───────────────────────────────
  const allocationSales = useMemo((): DeliverySale[] => {
    if (!normalizedCode) return []
    return allSales.filter(s => {
      if (s.allocationCode && s.allocationCode.toUpperCase() === normalizedCode) return true
      return truckRecords.some(r => {
        const sTruck = (s.truckNumber || '').toUpperCase()
        const iTruck = (r.truckPlate || r.truckNumber || '').toUpperCase()
        const sDate = (s.dateLoaded || '').split('T')[0]
        const iDate = (r.dateAllocated || '').split('T')[0]
        return sTruck && iTruck && sTruck === iTruck && sDate === iDate
      })
    }).sort((a, b) => (a.dateOfPayment || a.dateLoaded || '').localeCompare(b.dateOfPayment || b.dateLoaded || ''))
  }, [allSales, normalizedCode, truckRecords])

  // ── Summary Stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalQty = 0, loadedCount = 0, loadedQty = 0, soldCount = 0, soldQty = 0
    let otherCount = 0, otherQty = 0
    let splitCount = 0, splitCustomers = 0, splitQty = 0, unassignedQty = 0
    truckRecords.forEach(r => {
      totalQty += r.qty
      // Anything that is neither loaded nor offloaded gets its own bucket.
      // It used to fall into "sold", which quietly reported 36 rows carrying
      // the status `empty` as revenue-bearing deliveries.
      if (r.status.key === 'loaded') { loadedCount++; loadedQty += r.qty }
      else if (r.status.key === 'offloaded') { soldCount++; soldQty += r.qty }
      else { otherCount++; otherQty += r.qty }
      if (r.split.isSplit) { splitCount++; splitCustomers += r.split.shares.length; splitQty += r.qty }
      unassignedQty += r.split.unassigned
    })
    return {
      totalQty, loadedCount, loadedQty, soldCount, soldQty, otherCount, otherQty,
      truckCount: truckRecords.length,
      splitCount, splitCustomers, splitQty, unassignedQty,
    }
  }, [truckRecords])

  /** The trucks on this allocation that went to more than one customer. */
  const splitRecords = useMemo(() => truckRecords.filter(r => r.split.isSplit), [truckRecords])

  // ── PFI Breakdown ───────────────────────────────────────────────────────
  const pfiBreakdown = useMemo(() => {
    const map = new Map<string, { pfiId: string; pfiNumber: string; product: string; unit: string; qty: number; truckCount: number }>()
    truckRecords.forEach(r => {
      const pfiId = r.pfiId ? String(r.pfiId) : ''
      if (!pfiId) return
      const existing = map.get(pfiId)
      if (existing) {
        existing.qty += r.qty
        existing.truckCount++
      } else {
        map.set(pfiId, {
          pfiId,
          pfiNumber: r.pfiLabel || '—',
          product: r.product || 'N/A',
          unit: r.unitLabel || 'Litres',
          qty: r.qty,
          truckCount: 1,
        })
      }
    })
    return [...map.values()].sort((a, b) => b.qty - a.qty)
  }, [truckRecords])

  // ── Sales Summary ───────────────────────────────────────────────────────
  const salesSummary = useMemo(() => {
    let totalValue = 0, totalPaid = 0, totalExpenses = 0
    allocationSales.forEach(s => {
      totalValue += toNum(s.salesValue)
      totalPaid += toNum(s.paymentAmount)
      totalExpenses += toNum(s.expensesAmount ?? 0)
    })
    if (totalValue === 0 && truckRecords.length > 0) {
      totalValue = truckRecords.reduce((sum, r) => {
        const rate = toNum(r.rate)
        return sum + (rate > 0 ? rate * r.qty : 0)
      }, 0)
    }
    // Each customer's share counted once. Adding the quantity column across
    // payment rows counted the same litres again for every instalment, which
    // is why Volume Sold could read higher than the trucks ever carried.
    const totalQty = truckRecords.reduce((sum, r) => sum + r.split.assigned, 0)
    return { totalQty, totalValue, totalPaid, totalExpenses, balance: totalValue - (totalPaid + totalExpenses) }
  }, [allocationSales, truckRecords])

  // ── Code theme ──────────────────────────────────────────────────────────
  const theme = normalizedCode ? getCodeTheme(normalizedCode) : null

  // ── Dialog States ───────────────────────────────────────────────────────
  const [offloadTarget, setOffloadTarget] = useState<TruckRecord | null>(null)
  const [offloadDate, setOffloadDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [offloading, setOffloading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ code: '', pfi: '', depot: '', date: '', location: '', rate: '', quantity: '' })
  const [editSaving, setEditSaving] = useState(false)

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkAssignCode, setBulkAssignCode] = useState('')
  const [bulkAssignPfi, setBulkAssignPfi] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [deliveryCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_trip_codes') || '[]') } catch { return [] }
  })

  const allPfiOptions = useMemo(() =>
    allPfis
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1
        return a.pfiNumber.localeCompare(b.pfiNumber)
      })
      .map(p => ({
        id: String((p as any).id ?? p._id),
        label: `${p.pfiNumber} — ${p.productName || 'N/A'} · ${p.locationName || 'N/A'}${p.status === 'finished' ? '  (finished)' : ''}`,
      })),
    [allPfis])

  // ── Handlers ────────────────────────────────────────────────────────────
  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['delivery-inventory'] })
    qc.invalidateQueries({ queryKey: ['delivery-sales'] })
    qc.invalidateQueries({ queryKey: ['pfis'] })
    qc.invalidateQueries({ queryKey: ['trucks'] })
  }, [qc])

  const handleOffload = useCallback(async () => {
    if (!offloadTarget) return
    setOffloading(true)
    try {
      await updateInventory.mutateAsync({
        id: offloadTarget._id || offloadTarget.id || '',
        data: { loadingStatus: 'offloaded', dateOffloaded: offloadDate },
      })
      toast.success(`${offloadTarget.truckPlate} confirmed as sold`)
      setOffloadTarget(null)
      invalidateAll()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update')
    } finally {
      setOffloading(false)
    }
  }, [offloadTarget, offloadDate, invalidateAll])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const targetRecord = truckRecords.find(r => (r._id || r.id) === deleteTarget.id)
      if (targetRecord) {
        const matchedSales = allSales.filter(s => {
          if (s.allocationCode && targetRecord.code && s.allocationCode.toUpperCase() === targetRecord.code) return true
          const sTruck = s.truckNumber || ''
          const iTruck = targetRecord.truckPlate || targetRecord.truckNumber || ''
          const sDate = s.dateLoaded || ''
          const iDate = targetRecord.dateAllocated || ''
          return sTruck && iTruck && sTruck === iTruck && sDate === iDate
        })
        if (matchedSales.length > 0) {
          await Promise.all(matchedSales.map(sale => deleteSale.mutateAsync(sale._id || sale.id || '')))
        }
      }
      await deleteInventory.mutateAsync(deleteTarget.id)
      toast.success('Record deleted')
      setDeleteTarget(null)
      invalidateAll()
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, truckRecords, allSales, invalidateAll])

  const openEditDialog = (r: TruckRecord) => {
    setEditTarget({
      id: r._id || r.id || '',
      truckPlate: r.truckPlate,
      currentCode: r.code,
      currentPfi: r.pfiId ? String(r.pfiId) : '',
      currentDepot: r.depotDisplay,
      currentDate: r.dateAllocated || '',
      currentLocation: r.destination,
      currentRate: toNum(r.rate),
      currentQty: r.qty,
      assignedQty: r.split.assigned,
      shareCount: r.split.shares.length,
    })
    setEditForm({
      code: r.code,
      pfi: r.pfiId ? String(r.pfiId) : '',
      depot: r.depotDisplay,
      date: r.dateAllocated || '',
      location: r.destination,
      rate: toNum(r.rate) > 0 ? String(toNum(r.rate)) : '',
      quantity: r.qty > 0 ? String(r.qty) : '',
    })
  }

  const handleEditSave = useCallback(async () => {
    if (!editTarget) return
    setEditSaving(true)
    try {
      const normalizedEditCode = editForm.code.trim().toUpperCase().replace(/\s+/g, '-')
      const editedQty = toNum(editForm.quantity)
      // A split load's shares are already recorded against their customers, so
      // a total below them would be describing a truck that delivered more
      // than it carried. Refuse rather than store a figure the page will then
      // have to argue with.
      if (editTarget.shareCount > 1 && editedQty > 0 && editedQty < editTarget.assignedQty) {
        toast.error(
          `${fmtQty(editedQty)} L is less than the ${fmtQty(editTarget.assignedQty)} L already assigned to this truck's ${editTarget.shareCount} customers.`,
        )
        return
      }
      await updateInventory.mutateAsync({
        id: editTarget.id,
        data: {
          allocationCode: normalizedEditCode || null,
          pfiId: editForm.pfi ? Number(editForm.pfi) : null,
          depot: editForm.depot.trim() || undefined,
          dateAllocated: editForm.date || undefined,
          location: editForm.location.trim() || undefined,
          rate: editForm.rate ? Number(editForm.rate) : undefined,
          ...(editedQty > 0 ? { quantityAllocated: editedQty } : {}),
        } as any,
      })
      toast.success('Record updated')
      setEditTarget(null)
      invalidateAll()
    } catch (err: any) {
      toast.error(err?.message || 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }, [editTarget, editForm, invalidateAll])

  const handleBulkAssign = useCallback(async () => {
    if (selectedRowIds.size === 0) return
    const isClearCode = bulkAssignCode === '__CLEAR__'
    if (!bulkAssignCode && !bulkAssignPfi) { toast.error('Select a code and/or PFI to assign'); return }
    setBulkAssigning(true)
    try {
      const patch: Record<string, unknown> = {}
      if (isClearCode) patch.allocationCode = null
      else if (bulkAssignCode) patch.allocationCode = bulkAssignCode
      if (bulkAssignPfi) patch.pfiId = Number(bulkAssignPfi)
      await Promise.all([...selectedRowIds].map(id =>
        updateInventory.mutateAsync({ id, data: patch as any })
      ))
      toast.success(`Updated ${selectedRowIds.size} record${selectedRowIds.size !== 1 ? 's' : ''}`)
      setSelectedRowIds(new Set())
      setBulkAssignOpen(false)
      invalidateAll()
    } catch (err: any) {
      toast.error(err?.message || 'Bulk update failed')
    } finally {
      setBulkAssigning(false)
    }
  }, [selectedRowIds, bulkAssignCode, bulkAssignPfi, invalidateAll])

  const handleBulkDelete = useCallback(async () => {
    if (selectedRowIds.size === 0) return
    setBulkDeleting(true)
    try {
      const targetRecords = truckRecords.filter(r => selectedRowIds.has(r._id || r.id || ''))
      const matchedSales = allSales.filter(s => {
        return targetRecords.some(targetRecord => {
          if (s.allocationCode && targetRecord.code && s.allocationCode.toUpperCase() === targetRecord.code) return true
          const sTruck = s.truckNumber || ''
          const iTruck = targetRecord.truckPlate || targetRecord.truckNumber || ''
          const sDate = s.dateLoaded || ''
          const iDate = targetRecord.dateAllocated || ''
          return sTruck && iTruck && sTruck === iTruck && sDate === iDate
        })
      })
      if (matchedSales.length > 0) {
        await Promise.all(matchedSales.map(sale => deleteSale.mutateAsync(sale._id || sale.id || '')))
      }
      await Promise.all([...selectedRowIds].map(id => deleteInventory.mutateAsync(id)))
      toast.success(`Deleted ${selectedRowIds.size} record${selectedRowIds.size !== 1 ? 's' : ''}`)
      setSelectedRowIds(new Set())
      setBulkDeleteOpen(false)
      invalidateAll()
    } catch (err: any) {
      toast.error(err?.message || 'Bulk delete failed')
    } finally {
      setBulkDeleting(false)
    }
  }, [selectedRowIds, truckRecords, allSales, invalidateAll])

  const exportCSV = useCallback(() => {
    if (!truckRecords.length) return
    // Same resolved fields the table shows — an export that reads "—" where
    // the screen above it shows a driver and a rate is worse than no export.
    // A split truck exports as one row carrying the whole load, with its
    // customers, destinations and shares spelled out across three columns —
    // the same three the table shows, so the file and the screen agree.
    const headers = ['S/N', 'Truck', 'Driver', 'PFI / Code', 'Product', 'Depot', 'Customer', 'Destination', 'Quantity', 'Split', 'Customer Split', 'Rate', 'Status', 'Date Loaded', 'Date Sold']
    const rows = truckRecords.map((r, idx) => [
      idx + 1,
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
    a.download = `ALLOCATION-${normalizedCode || 'UNCODED'}-${format(new Date(), 'dd-MM-yyyy')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [truckRecords, normalizedCode])

  // ── Loading / Not Found ─────────────────────────────────────────────────
  const isLoading = isLoadingInventory

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (truckRecords.length === 0) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-card rounded-xl border border-border">
        <ShieldAlert className="size-10 mx-auto text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg">Allocation Not Found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          No truck records found for allocation <strong>{normalizedCode || '(no code)'}</strong>.
        </p>
        <Button onClick={() => navigate({ to: '/delivery-operations' })} className="mt-4 cursor-pointer">
          Back to Delivery Operations
        </Button>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const soldPercent = stats.totalQty > 0 ? Math.round((stats.soldQty / stats.totalQty) * 100) : 0
  const loadedPercent = stats.totalQty > 0 ? Math.round((stats.loadedQty / stats.totalQty) * 100) : 0

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Top Header & Breadcrumb */}
      <div className="bg-card p-5 rounded-xl border border-border/80 space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="size-9 p-0 rounded-xl cursor-pointer hover:bg-muted dark:hover:bg-foreground transition-colors duration-250 ease-luxe"
              onClick={() => navigate({ to: '/delivery-operations' })}
              title="Back to Delivery Operations"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <PageHeader
      eyebrow="Truck Sales"
      title={normalizedCode || 'Unassigned Allocation'}
      actions={
        <>
          <p className="text-muted-foreground text-xs mt-1 flex items-center gap-2">
          <span>{stats.truckCount} {stats.truckCount === 1 ? 'truck' : 'trucks'} allocated</span>
          <span>•</span>
          <span>{pfiBreakdown.length} {pfiBreakdown.length === 1 ? 'PFI' : 'PFIs'} attached</span>
          <span>•</span>
          <span>{fmtQty(stats.totalQty)} Litres Total</span>
          </p>
        </>
      }
    />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2 cursor-pointer h-9 text-xs font-semibold hover:border-border"
              onClick={exportCSV}
              disabled={truckRecords.length === 0}
            >
              <Download className="size-3.5" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="w-full bg-muted h-2 rounded-full overflow-hidden flex">
          <div
            className="bg-accent h-full transition-all duration-500 ease-luxe"
            style={{ width: `${soldPercent}%` }}
            title={`${soldPercent}% Sold`}
          />
          <div
            className="bg-warning h-full transition-all duration-500 ease-luxe"
            style={{ width: `${loadedPercent}%` }}
            title={`${loadedPercent}% In Transit`}
          />
        </div>
      </div>

      {/* Summary Stat Cards */}
      <StatCardGrid count={4}>
        <StatCard
          icon={<Truck />}
          label="Allocated fleet"
          value={stats.truckCount}
          description="Vehicles in dispatch"
        />
        <StatCard
          icon={<Droplets />}
          label="Total volume"
          value={
            <>
              {fmtQty(stats.totalQty)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                {truckRecords[0]?.unitLabel || 'Ltrs'}
              </span>
            </>
          }
          description={
            stats.splitCount > 0
              ? `${stats.splitCount} split across ${stats.splitCustomers} customers`
              : 'Combined capacity'
          }
        />
        <StatCard
          tone="amber"
          icon={<Truck />}
          label="In transit"
          value={
            <>
              {stats.loadedCount}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({fmtQty(stats.loadedQty)} L)
              </span>
            </>
          }
          description={`${loadedPercent}% of allocation`}
        />
        <StatCard
          icon={<CheckCircle2 />}
          label="Quantity sold"
          value={
            <>
              {stats.soldCount}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({fmtQty(stats.soldQty)} L)
              </span>
            </>
          }
          description={`${soldPercent}% completed`}
        />
      </StatCardGrid>

      {/* PFI Breakdown & Financial Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PFI Breakdown */}
        <Card className="border border-border/80">
          <CardHeader className="bg-muted/50 border-b border-border/70 py-3 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="size-4 text-accent" /> PFI Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pfiBreakdown.map(p => {
                const pfiPercent = stats.totalQty > 0 ? Math.round((p.qty / stats.totalQty) * 100) : 0
                return (
                  <div key={p.pfiId} className="p-3 rounded-xl border border-border/70 bg-muted/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-foreground font-mono">{p.pfiNumber}</span>
                      <span className="text-xs font-semibold bg-accent/20 text-accent px-2 py-0.5 rounded">
                        {pfiPercent}% of allocation
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-normal">{p.product}</div>

                    <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                      <div className="bg-accent h-full rounded-full" style={{ width: `${pfiPercent}%` }} />
                    </div>

                    <div className="flex justify-between items-center text-xs pt-1">
                      <span className="text-muted-foreground font-normal">{p.truckCount} {p.truckCount === 1 ? 'truck' : 'trucks'}</span>
                      <span className="font-semibold text-foreground">{fmtQty(p.qty)} {p.unit}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <Card className="border border-border/80">
          <CardHeader className="bg-muted/50 border-b border-border/70 py-3 px-4">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-foreground">
              <span className="flex items-center gap-2">
                <FileText className="size-4 text-accent" /> Financial Summary
              </span>
              {salesSummary.balance === 0 && (
                <span className="text-xs font-semibold bg-accent/20 text-accent px-2 py-0.5 rounded-full border border-accent/30">
                  ✓ Settled
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/60 col-span-1">
              <span className="text-muted-foreground font-normal">Volume Sold</span>
              <span className="font-semibold text-foreground">{salesSummary.totalQty > 0 ? `${fmtQty(salesSummary.totalQty)} L` : '—'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60 col-span-1">
              <span className="text-muted-foreground font-normal">Expected Revenue</span>
              <span className="font-semibold text-foreground">{salesSummary.totalValue > 0 ? fmtMoney(salesSummary.totalValue) : '—'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60 col-span-1">
              <span className="text-muted-foreground font-normal">Total Deposits</span>
              <span className="font-semibold text-accent">{salesSummary.totalPaid > 0 ? fmtMoney(salesSummary.totalPaid) : '—'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60 col-span-1">
              <span className="text-muted-foreground font-normal">Expenses</span>
              <span className="font-semibold text-warning">{salesSummary.totalExpenses > 0 ? fmtMoney(salesSummary.totalExpenses) : '—'}</span>
            </div>
            <div className="flex justify-between items-center py-2 pt-2 col-span-2 bg-muted/60 p-2.5 rounded-lg border border-border">
              <span className="text-foreground font-semibold">Outstanding Balance</span>
              <span className={cn(
                'font-semibold text-sm',
                salesSummary.balance === 0 ? 'text-accent' : salesSummary.balance > 0 ? 'text-destructive' : 'text-muted-foreground'
              )}>
                {salesSummary.balance === 0 ? '✓ ₦0.00' : salesSummary.balance > 0 ? fmtMoney(salesSummary.balance) : `+${fmtMoney(Math.abs(salesSummary.balance))}`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Split loads.
          A truck sold to two customers is the case every quantity on this page
          used to get wrong, so it gets said once, plainly, before the table:
          which trucks were split, into what, and for whom. */}
      {splitRecords.length > 0 && (
        <Card className="border border-blue-500/30">
          <CardHeader className="border-b border-blue-500/20 bg-blue-500/5 px-4 py-3">
            <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
              <span className="flex items-center gap-2">
                <Split className="size-4 text-blue-600 dark:text-blue-400" />
                Split loads ({splitRecords.length})
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {fmtQty(stats.splitQty)} L to {stats.splitCustomers} customers
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {splitRecords.map(r => (
              <div key={`split-${r._id || r.id}`} className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                    <Truck className="size-3 shrink-0 text-accent" />
                    {r.truckPlate}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {fmtQty(r.qty)} {r.unitLabel}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {r.split.shares.map((share, i) => {
                    const pct = r.qty > 0 ? Math.round((share.quantity / r.qty) * 100) : 0
                    return (
                      <div key={share.customerId || i} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate capitalize text-foreground">
                            {share.customerName || 'Unassigned'}
                            {share.destination && (
                              <span className="ml-1 capitalize text-muted-foreground">→ {share.destination}</span>
                            )}
                          </span>
                          <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                            {fmtQty(share.quantity)} L
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                  {r.split.unassigned > 0 && (
                    <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5 text-xs">
                      <span className="italic text-muted-foreground">Not yet assigned</span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-muted-foreground">
                        {fmtQty(r.split.unassigned)} L
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* FULL-WIDTH TRUCK RECORDS SECTION */}
      <div className="w-full space-y-4">
        {/* Bulk Selection Floating Toolbar */}
        {selectedRowIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-foreground text-background rounded-xl border border-border animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="text-xs font-semibold bg-accent text-foreground px-2 py-0.5 rounded-md">
              {selectedRowIds.size}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              truck record{selectedRowIds.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-accent hover:bg-accent/80 text-foreground font-semibold cursor-pointer"
              onClick={() => { setBulkAssignCode(''); setBulkAssignPfi(''); setBulkAssignOpen(true) }}
            >
              <Tag className="size-3.5" /> Assign PFI
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-destructive/20 hover:bg-destructive/30 text-destructive border border-destructive/30 font-semibold cursor-pointer"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" /> Delete Selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1 text-muted-foreground hover:text-white hover:bg-foreground cursor-pointer"
              onClick={() => setSelectedRowIds(new Set())}
            >
              <X className="size-3.5" /> Clear
            </Button>
          </div>
        )}

        {/* Trucks Table Card (FULL WIDTH) */}
        <Card className="w-full overflow-hidden border border-border/80">
          <CardHeader className="bg-muted/50 border-b border-border/70 py-3.5 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Truck className="size-4 text-accent" />
                Truck Records ({truckRecords.length})
              </CardTitle>
              <span className="text-xs text-muted-foreground font-normal">
                {stats.loadedCount} in transit · {stats.soldCount} sold{stats.otherCount > 0 ? ` · ${stats.otherCount} ${STATUS_DISPLAY.empty.label.toLowerCase()}` : ''}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto w-full">
              <Table className="w-full text-sm">
                <TableHeader>
                  <TableRow className="bg-muted/60 border-b border-border text-muted-foreground">
                    <TableHead className="w-[40px] text-center">
                      <input
                        type="checkbox"
                        aria-label="Select all visible rows"
                        className="size-4 rounded border-border accent-primary cursor-pointer"
                        checked={truckRecords.length > 0 && truckRecords.every(r => selectedRowIds.has(r._id || r.id || ''))}
                        onChange={e => {
                          if (e.target.checked) setSelectedRowIds(new Set(truckRecords.map(r => r._id || r.id || '')))
                          else setSelectedRowIds(new Set())
                        }}
                      />
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-[35px] text-center">#</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[110px]">Truck</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[100px]">Quantity</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[100px]">Depot</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[90px]">Product</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[130px]">Customer</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[90px]">Rate(s)</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[120px]">Destination</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[95px]">Status</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[90px]">Date Loaded</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[90px]">Date Sold</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-muted-foreground min-w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {truckRecords.map((r, idx) => {
                    const badge = r.status
                    const Icon = STATUS_ICON[badge.key] ?? Droplets
                    const shares = r.split.shares
                    const recordId = r._id || r.id || ''

                    return (
                      <TableRow
                        key={recordId}
                        className={cn(
                          'hover:bg-muted/60 transition-colors border-l-[3px] text-xs duration-250 ease-luxe',
                          selectedRowIds.has(recordId) ? 'bg-accent/10 border-l-emerald-500' : (theme ? theme.row : 'border-l-transparent')
                        )}
                      >
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            checked={selectedRowIds.has(recordId)}
                            onChange={e => {
                              setSelectedRowIds(prev => {
                                const next = new Set(prev)
                                e.target.checked ? next.add(recordId) : next.delete(recordId)
                                return next
                              })
                            }}
                            className="size-4 rounded border-border accent-primary cursor-pointer"
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-center font-normal">{idx + 1}</TableCell>

                        {/* Truck Plate */}
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-xs text-foreground font-mono flex items-center gap-1">
                              <Truck className="size-3 text-accent shrink-0" />
                              {r.truckPlate}
                            </span>
                            <SplitBadge split={r.split} className="self-start" />
                          </div>
                        </TableCell>

                        {/* Quantity — the whole truck, with the shares it
                            breaks into underneath it on a split load. */}
                        <TableCell>
                          <LoadQuantity split={r.split} unit={r.unitLabel} />
                        </TableCell>

                        {/* Depot */}
                        <TableCell className="text-muted-foreground font-normal">{r.depotDisplay || '—'}</TableCell>

                        {/* Product */}
                        <TableCell>
                          {r.product ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-foreground border border-border">
                              {r.product}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Customer — every buyer on the load, each with the
                            volume that went to them. */}
                        <TableCell>
                          {shares.length > 0 ? (
                            <ShareList split={r.split} />
                          ) : r.custName ? (
                            <span className="text-xs text-foreground font-normal capitalize truncate">{r.custName}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Rates — one line per share, in the same order as
                            the customers beside them, so the two columns can
                            be read across. */}
                        <TableCell>
                          {shares.length > 0 ? (
                            <div className="flex flex-col gap-1 py-0.5">
                              {shares.map((e, i) => (
                                <div key={e.customerId || i} className="flex items-center">
                                  <span className="text-xs text-foreground font-normal font-mono">
                                    {e.rate > 0 ? `₦${e.rate.toLocaleString()}` : '—'}
                                  </span>
                                </div>
                              ))}
                              {r.split.unassigned > 0 && (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          ) : toNum(r.rate) > 0 ? (
                            <span className="text-xs text-foreground font-normal font-mono">
                              ₦{toNum(r.rate).toLocaleString()}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Destination — one line per share, aligned with the
                            customer and rate columns. */}
                        <TableCell>
                          {shares.length > 0 ? (
                            <div className="flex flex-col gap-1 py-0.5">
                              {shares.map((e, i) => (
                                <span key={e.customerId || i} className="text-xs text-foreground capitalize truncate">
                                  {e.destination || r.destination || '—'}
                                </span>
                              ))}
                              {r.split.unassigned > 0 && (
                                <span className="text-xs italic text-muted-foreground">not assigned</span>
                              )}
                            </div>
                          ) : <span className="text-xs text-foreground capitalize truncate">{r.destination || '—'}</span>}
                        </TableCell>

                        {/* Status Badge */}
                        <TableCell>
                          <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border', badge.cls)}>
                            <Icon className="size-3" /> {badge.label}
                          </span>
                        </TableCell>

                        {/* Date Loaded */}
                        <TableCell className="whitespace-nowrap text-foreground text-xs font-normal">
                          {r.dateLoaded
                            ? (() => { try { return format(parseISO(r.dateLoaded), 'dd MMM yyyy') } catch { return r.dateLoaded } })()
                            : '—'}
                        </TableCell>

                        {/* Date Sold */}
                        <TableCell className="whitespace-nowrap text-foreground text-xs font-normal">
                          {r.dateOffloaded ? (() => { try { return format(parseISO(r.dateOffloaded), 'dd MMM yyyy') } catch { return r.dateOffloaded } })() : '—'}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {r.status.key !== 'offloaded' && (
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1 bg-accent hover:bg-accent/80 text-accent-foreground px-2.5 cursor-pointer font-semibold"
                                onClick={() => { setOffloadTarget(r); setOffloadDate(format(new Date(), 'yyyy-MM-dd')) }}
                              >
                                <CheckCircle2 className="size-3" /> Sold
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 px-2 cursor-pointer hover:bg-muted"
                              onClick={() => openEditDialog(r)}
                            >
                              <Pencil className="size-3" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                              title="Delete record"
                              onClick={() => setDeleteTarget({ id: recordId, label: `${r.truckPlate}${r.code ? ` (${r.code})` : ''}` })}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <OffloadDialog
        target={offloadTarget}
        date={offloadDate}
        setDate={setOffloadDate}
        onClose={() => setOffloadTarget(null)}
        onConfirm={handleOffload}
        loading={offloading}
      />

      <EditRecordDialog
        target={editTarget}
        form={editForm}
        setForm={setEditForm}
        deliveryCodes={deliveryCodes}
        allPfiOptions={allPfiOptions}
        pfiMap={pfiMap}
        onClose={() => setEditTarget(null)}
        onSave={handleEditSave}
        loading={editSaving}
      />

      <DeleteConfirmDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
      />

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        count={selectedRowIds.size}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
      />

      <BulkAssignDialog
        open={bulkAssignOpen}
        count={selectedRowIds.size}
        deliveryCodes={deliveryCodes}
        allPfiOptions={allPfiOptions}
        allPfis={allPfis}
        bulkAssignCode={bulkAssignCode}
        bulkAssignPfi={bulkAssignPfi}
        setBulkAssignCode={setBulkAssignCode}
        setBulkAssignPfi={setBulkAssignPfi}
        onClose={() => setBulkAssignOpen(false)}
        onConfirm={handleBulkAssign}
        loading={bulkAssigning}
      />
    </div>
  )
}
