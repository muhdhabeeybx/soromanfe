import { useState, useMemo, useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SummaryCards, type SummaryCard } from '#/components/SummaryCards'
import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '#/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '#/components/ui/select'
import {
  // FileText and ChevronDown went unused with the PFI summary table and the
  // filters toggle; both are needed again if that block is uncommented.
  Plus, Search, Download, Truck, Wallet, FileSpreadsheet,
  TrendingUp, Banknote, Building2,
  Calendar as CalendarIcon, X, Users, Tag,
  ChevronRight, ChevronLeft, SlidersHorizontal,
  Loader2, Landmark, ArrowLeftRight, Pencil, Trash2, Split,
} from 'lucide-react'
import { useDeliverySalesList } from '#/lib/hooks/useDeliverySales'
import { useDeliveryInventoryList } from '#/lib/hooks/useDeliveryInventory'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { usePfiList, type Pfi } from '#/lib/hooks/usePfis'
import { useLedgerGroups } from '#/lib/hooks/useLedgerGroups'
import { useSalesLedgerFilters } from '#/lib/hooks/useSalesLedgerFilters'
import { useToast } from '#/lib/hooks/useToast'
import type { DeliverySale, DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import {
  RecordPaymentDialog, QuickPaymentDialog, RowSetupDialog, TransferOverpaymentDialog,
  type LoadSummary,
  EditEntryDialog, DeleteConfirmDialog,
  type LedgerGroup,
} from '#/components/sales-ledger/SalesLedgerDialogs'
import {
  toNum, fmt, fmtQty, normalizeCycleDate, getCycleKey, safeFormatDate,
  getCodeTheme, idKey, entityId, type TimePreset,
} from '#/lib/sales-ledger-utils'
import { useBankAccountPicker, formatBankLabel, BANK_ACCOUNT_USAGE } from '#/lib/bank-accounts'
import { ScopedBankAccountsDialog } from '#/components/ScopedBankAccountsDialog'
import { routeGuard } from '#/lib/route-guard'
import {
  exportSalesLedgerExcel, exportSalesLedgerPdf,
  exportDailyPaymentsExcel, exportDailyPaymentsPdf,
  // Shared with the export so the day blocks on screen and the day blocks in
  // the file are the same grouping, totalled the same way.
  groupPaymentsByDay,
  type SalesLedgerFilters,
} from './-sales-ledger-export'

export const Route = createFileRoute('/sales-ledger/')({
  beforeLoad: () => routeGuard('/sales-ledger'),
  component: SalesLedgerDashboard,
})

function SalesLedgerDashboard() {
  // Every account, active or not — an export must still name the account a
  // historical payment went into.
  const { accounts: bankAccounts } = useBankAccountPicker()
  const navigate = useNavigate()
  const toast = useToast()

  // ── Queries ───
  const POLL_INTERVAL = 30_000
  const { data: rawSales = [], isLoading: salesLoading } = useDeliverySalesList({ refetchInterval: POLL_INTERVAL })
  const { data: rawInventory = [], isLoading: inventoryLoading } = useDeliveryInventoryList({ refetchInterval: POLL_INTERVAL })
  const { data: rawCustomers, isLoading: customersLoading } = useDeliveryCustomerList()
  const { data: rawPfis } = usePfiList()

  const allSales: DeliverySale[] = useMemo(() =>
    Array.isArray(rawSales) ? rawSales : [], [rawSales])
  const allLoadings: DeliveryInventory[] = useMemo(() =>
    Array.isArray(rawInventory) ? rawInventory : [], [rawInventory])
  const customers: DeliveryCustomer[] = useMemo(() => {
    if (!rawCustomers) return []
    if (Array.isArray(rawCustomers)) return rawCustomers
    return rawCustomers.customers || []
  }, [rawCustomers])
  const pfis: Pfi[] = useMemo(() => {
    if (!rawPfis) return []
    if (Array.isArray(rawPfis)) return rawPfis
    return rawPfis.pfis || []
  }, [rawPfis])

  // ── Lookup Maps ────────────────────────────────────────────────────
  // Keyed by string under both spellings of the id. The ids are numbers at
  // runtime, so a map built on the raw value answered nothing when looked up
  // with the string a <select> or a search param carries — every customer
  // read as unresolved, and with it every filling station read as a normal
  // customer. See idKey in sales-ledger-utils.
  const customerMap = useMemo(() => {
    const m = new Map<string, DeliveryCustomer>()
    customers.forEach(c => {
      if (c._id != null) m.set(idKey(c._id), c)
      if (c.id != null) m.set(idKey(c.id), c)
    })
    return m
  }, [customers])

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    pfis.forEach(p => m.set(idKey(p._id), p))
    return m
  }, [pfis])

  // ── Ledger Groups (shared computation) ────────────────────────────
  const { ledgerGroups, cycleCustomerRateMap } = useLedgerGroups({
    allSales, allLoadings, customerMap, pfiMap,
  })

  // ── Trip Codes (localStorage) ──────────────────────────────────────
  const [tripCodes, setTripCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_trip_codes') || '[]') } catch { return [] }
  })
  const [saleTripMap, setSaleTripMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_sale_trip_map') || '{}') } catch { return {} }
  })
  const [newTripCodeInput, setNewTripCodeInput] = useState('')

  useEffect(() => { localStorage.setItem('dsl_trip_codes', JSON.stringify(tripCodes)) }, [tripCodes])
  useEffect(() => { localStorage.setItem('dsl_sale_trip_map', JSON.stringify(saleTripMap)) }, [saleTripMap])

  useEffect(() => {
    if (!allLoadings.length) return
    const codes = allLoadings.map(l => (l.allocationCode || '').trim().toUpperCase()).filter(Boolean)
    if (!codes.length) return
    setTripCodes(prev => {
      const merged = Array.from(new Set([...prev, ...codes])).sort()
      return merged.join(',') === prev.join(',') ? prev : merged
    })
  }, [allLoadings])

  // ── Filters ────────────────────────────────────────────────────────
  const {
    timePreset, customFrom, setCustomFrom, customTo, setCustomTo,
    searchQuery, setSearchQuery, activeView, setActiveView,
    truckFilter, setTruckFilter, customerFilter, setCustomerFilter,
    customerTypeFilter, setCustomerTypeFilter, tripCodeFilter, setTripCodeFilter,
    dateRange, handlePresetChange, clearAllFilters, hasActiveFilters,
    filteredLedgerGroups, filteredSales,
    uniqueTruckNumbers, uniqueCustomerOptions, periodLabel,
  } = useSalesLedgerFilters({
    ledgerGroups, allSales, allLoadings, customers, customerMap, tripCodes, saleTripMap,
  })

  // ── Pagination ─────────────────────────────────────────────────────
  //
  // The whole list, by default. Fifteen rows a page meant the totals in the
  // footer described one page while the summary cards above described the
  // filter — two sets of figures on one screen that never agreed. Paging is
  // still there for anyone who wants it.
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number | 'all'>('all')

  useEffect(() => {
    setCurrentPage(1)
  }, [
    activeView, searchQuery, timePreset, customFrom, customTo,
    truckFilter, customerFilter, customerTypeFilter, tripCodeFilter,
  ])

  const pageOffset = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize
  const takePage = useCallback(<T,>(list: T[]): T[] => (
    pageSize === 'all' ? list : list.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  ), [pageSize, currentPage])

  const paginatedLedgerGroups = useMemo(
    () => takePage(filteredLedgerGroups), [filteredLedgerGroups, takePage])

  const paginatedSales = useMemo(
    () => takePage(filteredSales), [filteredSales, takePage])

  const renderPaginationFooter = (
    totalCount: number,
    totalPaidSum: number,
    itemLabel: string
  ) => {
    const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalCount / pageSize))
    const startItem = totalCount > 0 ? pageOffset + 1 : 0
    const endItem = pageSize === 'all' ? totalCount : Math.min(currentPage * pageSize, totalCount)

    return (
      <div className="border-t border-border bg-muted/50 px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-normal">Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(val === 'all' ? 'all' : Number(val))
                setCurrentPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[72px] bg-background text-xs">
                <SelectValue placeholder={String(pageSize)} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span>
            Showing <strong className="text-foreground">{startItem}</strong>–<strong className="text-foreground">{endItem}</strong> of <strong className="text-foreground">{totalCount}</strong> {itemLabel} · <span className="font-normal text-muted-foreground">{periodLabel}</span>
          </span>
          <span className="hidden sm:inline text-muted-foreground/40">|</span>
          <span className="font-normal">
            Total Paid: <strong className="text-accent">{fmt(totalPaidSum)}</strong>
          </span>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1 text-muted-foreground border-border bg-card hover:bg-muted"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            >
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .map((p, idx, arr) => {
                const showEllipsis = idx > 0 && p - arr[idx - 1] > 1
                return (
                  <div key={p} className="flex items-center">
                    {showEllipsis && <span className="px-1 text-xs text-muted-foreground">...</span>}
                    <Button
                      variant={currentPage === p ? 'default' : 'outline'}
                      size="sm"
                      className={`size-8 p-0 text-xs font-semibold ${
 currentPage === p
 ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary '
 : 'bg-card text-foreground border-border hover:bg-muted'
 }`}
                      onClick={() => setCurrentPage(p)}
                    >
                      {p}
                    </Button>
                  </div>
                )
              })}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1 text-muted-foreground border-border bg-card hover:bg-muted"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    )
  }


  // ── Totals ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let totalExpected = 0, totalPaid = 0, totalQty = 0, totalOutstanding = 0, totalOverpaid = 0
    let fullyPaidCount = 0, pendingPaymentCount = 0, soldCount = 0, withBalanceCount = 0, notSoldCount = 0
    const uniqueTrucks = new Set<string>()
    const codeSummaries: Record<string, { code: string; qty: number; expected: number; paid: number; balance: number; trucksCount: number; fullyPaidCount: number; pendingCount: number; soldCount: number; withBalanceCount: number; notSoldCount: number; truckSet: Set<string> }> = {}

    tripCodes.forEach(code => {
      codeSummaries[code] = { code, qty: 0, expected: 0, paid: 0, balance: 0, trucksCount: 0, fullyPaidCount: 0, pendingCount: 0, soldCount: 0, withBalanceCount: 0, notSoldCount: 0, truckSet: new Set() }
    })

    filteredLedgerGroups.forEach(group => {
      if (group.truckNumber) uniqueTrucks.add(group.truckNumber)
      totalExpected += Math.max(0, toNum(group.expected))
      totalPaid += toNum(group.totalPaid)
      const bal = toNum(group.balance)
      const isExpectedPositive = toNum(group.expected) > 0
      const isLoadedTruck = !!group.truckNumber
      const isFullyPaid = isExpectedPositive && bal <= 0
      const hasPaymentEntered = toNum(group.totalPaid) > 0
      const hasNoPayout = group.payments.length === 0 || !hasPaymentEntered
      const hasBalanceWithPayment = hasPaymentEntered && bal > 0

      if (isLoadedTruck) {
        if (isFullyPaid) { fullyPaidCount += 1; soldCount += 1 } else { pendingPaymentCount += 1 }
        if (hasNoPayout) notSoldCount += 1
        else if (hasBalanceWithPayment) withBalanceCount += 1
      }
      if (bal > 0) totalOutstanding += bal
      else if (bal < 0) totalOverpaid += Math.abs(bal)

      const code = (group.code || '').trim().toUpperCase()
      if (codeSummaries[code]) {
        const s = codeSummaries[code]
        s.expected += Math.max(0, toNum(group.expected))
        s.paid += toNum(group.totalPaid)
        s.balance += bal
        if (group.truckNumber) s.truckSet.add(group.truckNumber)
        if (isLoadedTruck) {
          if (isFullyPaid) { s.fullyPaidCount += 1; s.soldCount += 1 } else s.pendingCount += 1
          if (hasNoPayout) s.notSoldCount += 1
          else if (hasBalanceWithPayment) s.withBalanceCount += 1
        }
      }
    })

    const qtyCountedCycles = new Set<string>()
    ledgerGroups.forEach(group => {
      const matchesDate = !dateRange.from && !dateRange.to ? true : true // already filtered
      if (!matchesDate) return
      const cycleKey = getCycleKey(group.truckNumber, group.dateLoaded)
      const isOrphan = group.key.startsWith('sale:')
      const alreadyCounted = isOrphan && qtyCountedCycles.has(cycleKey)
      const qty = (!isOrphan || !alreadyCounted) ? Math.max(0, toNum(group.quantity)) : 0
      if (cycleKey && (!isOrphan || !alreadyCounted)) qtyCountedCycles.add(cycleKey)
      totalQty += qty
      const code = (group.code || '').trim().toUpperCase()
      if (codeSummaries[code]) codeSummaries[code].qty += isOrphan ? 0 : Math.max(0, toNum(group.quantity))
    })

    const codeSummariesList = Object.values(codeSummaries).map(s => ({ ...s, trucksCount: s.truckSet.size }))

    return {
      totalExpected, totalPaid, totalQty,
      totalOutstanding, totalOverpaid,
      truckCount: uniqueTrucks.size,
      fullyPaidCount, pendingPaymentCount, soldCount, withBalanceCount, notSoldCount,
      codeSummaries: codeSummariesList,
    }
  }, [filteredLedgerGroups, ledgerGroups, tripCodes, dateRange])

  const summaryCards = useMemo((): SummaryCard[] => {
    const netBalance = totals.totalOutstanding - totals.totalOverpaid
    return [
      { title: 'Qty Sold (Ltrs)', value: totals.totalQty > 0 ? totals.totalQty.toLocaleString() : '0', icon: <Truck className="size-5" />, tone: 'neutral' },
      { title: 'Expected Revenue', value: fmt(totals.totalExpected), icon: <TrendingUp className="size-5" />, tone: 'neutral' },
      { title: 'Total Paid', value: fmt(totals.totalPaid), icon: <Banknote className="size-5" />, tone: 'green' },
      { title: 'Outstanding', value: totals.totalOutstanding > 0 ? fmt(totals.totalOutstanding) : '₦0', icon: <Wallet className="size-5" />, tone: totals.totalOutstanding > 0 ? 'red' : 'green' },
      { title: 'Overpaid', value: totals.totalOverpaid > 0 ? fmt(totals.totalOverpaid) : '₦0', icon: <Banknote className="size-5" />, tone: totals.totalOverpaid > 0 ? 'blue' : 'neutral' },
      { title: 'Net Balance', value: netBalance <= 0 ? (netBalance < 0 ? `+${fmt(Math.abs(netBalance))}` : '₦0') : fmt(netBalance), icon: <TrendingUp className="size-5" />, tone: netBalance <= 0 ? 'blue' : 'red' },
    ]
  }, [totals])

  // ── Loaded trucks for dialog ───────────────────────────────────────
  //
  // Every allocation, settled or not. This used to hide an offloaded truck
  // whose cycle was fully paid, but the summary it consulted only ever
  // accumulated payments and left expected at zero, so the test never fired
  // and no truck was ever hidden. Correcting the figure would have started
  // hiding trucks instead — and a payment keyed against a settled cycle is a
  // correction someone still has to be able to make.
  const loadedTrucks = useMemo(() => {
    return allLoadings.filter(t => !!(t.truckNumber || t.truckId)).sort((a, b) => {
      const truckA = (a.truckNumber || '').toUpperCase()
      const truckB = (b.truckNumber || '').toUpperCase()
      if (truckA !== truckB) return truckA.localeCompare(truckB)
      return normalizeCycleDate(b.dateAllocated || '').localeCompare(normalizeCycleDate(a.dateAllocated || ''))
    })
  }, [allLoadings])

  /**
   * What each truck has already been sold, for the Record Payment dialog.
   *
   * Built from the ledger's own rows so the dialog and the table behind it
   * cannot disagree about how much of a truck is still free.
   */
  const loadSummaries = useMemo(() => {
    const map = new Map<string, LoadSummary>()
    ledgerGroups.forEach(g => {
      if (g.loadingId == null) return
      const key = idKey(g.loadingId)
      let entry = map.get(key)
      if (!entry) {
        entry = {
          total: g.loadQuantity,
          assigned: g.loadAssigned,
          unassigned: g.loadUnassigned,
          shareCount: g.shareCount,
          customerIds: new Set<string>(),
          shareByCustomer: new Map<string, number>(),
        }
        map.set(key, entry)
      }
      // Only customers with sales against them. A loading carries a customer
      // id before anything has been sold, and treating that as volume already
      // assigned would exempt the first row on a fresh truck from the check
      // that it fits.
      if (g.customerId && g.payments.length > 0) {
        entry.customerIds.add(g.customerId)
        entry.shareByCustomer.set(g.customerId, g.quantity)
      }
    })
    return map
  }, [ledgerGroups])

  // ── Trip Code Management ───────────────────────────────────────────
  const addTripCode = () => {
    const code = newTripCodeInput.trim().toUpperCase().replace(/\s+/g, '-')
    if (!code) { toast.error('Enter a code first'); return }
    if (tripCodes.includes(code)) { toast.error(`Code "${code}" already exists`); return }
    setTripCodes(prev => [...prev, code].sort())
    setNewTripCodeInput('')
    toast.success(`Trip code "${code}" created`)
  }

  const deleteTripCode = (code: string) => {
    const isInventoryCode = allLoadings.some(l => (l.allocationCode || '').trim().toUpperCase() === code)
    if (isInventoryCode) { toast.error(`Cannot delete "${code}" — assigned to inventory records`); return }
    setTripCodes(prev => prev.filter(c => c !== code))
    setSaleTripMap(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(k => { if (next[k] === code) delete next[k] })
      return next
    })
    if (tripCodeFilter === code) setTripCodeFilter('all')
    toast.success(`Trip code "${code}" deleted`)
  }

  // ── Dialog State ───────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bankAccountsOpen, setBankAccountsOpen] = useState(false)
  // The row the three row-level dialogs act on. One target, because only one
  // of them is ever open.
  const [quickTarget, setQuickTarget] = useState<LedgerGroup | null>(null)
  const [quickPaymentOpen, setQuickPaymentOpen] = useState(false)
  const [rowSetupOpen, setRowSetupOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  // Editing and deleting act on one payment, not on the truck-cycle, so they
  // carry their own target rather than sharing quickTarget.
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<DeliverySale | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { ids: string[]; loadingId?: string; mode: 'entry' | 'truck'; label: string } | null
  >(null)
  const [assignMode, setAssignMode] = useState(false)

  const openPaymentDialog = (inAssignMode = false) => {
    setAssignMode(inAssignMode)
    setDialogOpen(true)
  }

  // ── Exports ─────────────────────────────────────────────────────────
  //
  // Both of these were bare CSVs: no separators, no currency, dates as text,
  // and a ledger row's payments flattened into unlabelled repeats. They are
  // styled workbooks and PDFs now — see -sales-ledger-export.ts.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const exportFilters = useMemo((): SalesLedgerFilters => ({
    periodLabel,
    search: searchQuery,
    truck: truckFilter,
    customer: customerFilter === 'all'
      ? 'all'
      : (uniqueCustomerOptions.find(c => c.id === customerFilter)?.name || customerFilter),
    code: tripCodeFilter,
  }), [periodLabel, searchQuery, truckFilter, customerFilter, uniqueCustomerOptions, tripCodeFilter])

  const runExport = useCallback(async (kind: 'excel' | 'pdf') => {
    const isLedger = activeView === 'ledger'
    if (isLedger ? !filteredLedgerGroups.length : !filteredSales.length) return
    setExporting(kind)
    try {
      if (isLedger) {
        if (kind === 'excel') await exportSalesLedgerExcel(filteredLedgerGroups, exportFilters, bankAccounts)
        else await exportSalesLedgerPdf(filteredLedgerGroups, exportFilters, bankAccounts)
      } else {
        if (kind === 'excel') await exportDailyPaymentsExcel(filteredSales, exportFilters, bankAccounts)
        else await exportDailyPaymentsPdf(filteredSales, exportFilters, bankAccounts)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }, [activeView, filteredLedgerGroups, filteredSales, exportFilters, bankAccounts, toast])

  const isLoading = salesLoading || inventoryLoading || customersLoading

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery Sales Ledger"
        description="Manage loaded trucks and track incremental payments."
        actions={
          // Two rows on a phone, one on a desktop — four buttons in a single
          // non-wrapping row ran off the side of the screen.
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex gap-2">
              <Button
                className="flex-1 gap-2 bg-accent hover:bg-accent/80 sm:flex-none"
                onClick={() => openPaymentDialog()}
              >
                <Plus className="size-4" /> Record Payment
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2 sm:flex-none"
                onClick={() => setBankAccountsOpen(true)}
              >
                <Landmark className="size-4" />
                <span className="hidden sm:inline">Bank Accounts</span>
                <span className="sm:hidden">Banks</span>
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2 sm:flex-none"
                onClick={() => runExport('excel')}
                disabled={exporting !== null || (activeView === 'ledger' ? filteredLedgerGroups.length === 0 : filteredSales.length === 0)}
              >
                {exporting === 'excel'
                  ? <Loader2 className="size-4 animate-spin" />
                  : <FileSpreadsheet className="size-4" />}
                <span className="hidden sm:inline">Export Excel</span>
                <span className="sm:hidden">Excel</span>
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2 sm:flex-none"
                onClick={() => runExport('pdf')}
                disabled={exporting !== null || (activeView === 'ledger' ? filteredLedgerGroups.length === 0 : filteredSales.length === 0)}
              >
                {exporting === 'pdf'
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Download className="size-4" />}
                <span className="hidden sm:inline">Export PDF</span>
                <span className="sm:hidden">PDF</span>
              </Button>
            </div>
          </div>
        }
      />

      {/* ═══ FILTER PANEL ═══ */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search truck, customer, PFI, payer…" className="pl-9 h-10 text-sm" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button title="Clear search" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-250 ease-luxe">
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Time Period */}
          <div className="flex flex-wrap gap-1.5">
            {(['today', 'yesterday', 'week', 'month', 'year', 'all', 'custom'] as TimePreset[]).map(tp => (
              <button
                key={tp}
                type="button"
                onClick={() => handlePresetChange(tp)}
                className={`px-3 py-1.5 text-xs font-normal rounded-lg border transition-all ${timePreset === tp
 ? 'bg-primary text-primary-foreground border-primary '
 : 'bg-card text-muted-foreground border-border hover:border-foreground/40 hover:bg-muted'
 }`}
              >
                {tp === 'all' ? 'All Time' : tp === 'custom' ? 'Custom' : tp.charAt(0).toUpperCase() + tp.slice(1)}
              </button>
            ))}
          </div>

          {timePreset === 'custom' && (
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 w-[160px]" /></div>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 w-[160px]" /></div>
            </div>
          )}

          {/* The filters are the page's controls, not a feature of it. Behind
              a toggle they were a thing to remember existed, and the toggle
              itself carried an "Active" badge to say something was hidden —
              which is the shape of a problem, not a solution. */}
          <div className="border-t border-border pt-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              Filters
            </span>
          </div>

          {(
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Truck className="size-3 text-muted-foreground" /> Truck
                </Label>
                <Select value={truckFilter} onValueChange={setTruckFilter}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Trucks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Trucks</SelectItem>
                    {uniqueTruckNumbers.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Users className="size-3 text-muted-foreground" /> Customer
                </Label>
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {uniqueCustomerOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Building2 className="size-3 text-muted-foreground" /> Customer Type
                </Label>
                <Select value={customerTypeFilter} onValueChange={(v) => setCustomerTypeFilter(v as any)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal Customers</SelectItem>
                    <SelectItem value="filling_station">Filling Stations</SelectItem>
                    <SelectItem value="all">All Types</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {tripCodes.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <Tag className="size-3 text-muted-foreground" /> PFI Code
                  </Label>
                  <Select value={tripCodeFilter} onValueChange={setTripCodeFilter}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All PFI Codes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All PFI Codes</SelectItem>
                      {tripCodes.map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Active Filter Chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {truckFilter !== 'all' && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Truck: {truckFilter}
                  <button onClick={() => setTruckFilter('all')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
                </Badge>
              )}
              {customerFilter !== 'all' && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Customer: {uniqueCustomerOptions.find(c => c.id === customerFilter)?.name || customerFilter}
                  <button onClick={() => setCustomerFilter('all')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
                </Badge>
              )}
              {/* Only a departure from the default is worth a chip. "Normal"
                  is how the page opens, so labelling it would put a filter
                  chip on an unfiltered view. */}
              {customerTypeFilter !== 'normal' && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Type: {customerTypeFilter === 'filling_station' ? 'Filling Stations' : 'All Types'}
                  <button onClick={() => setCustomerTypeFilter('normal')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
                </Badge>
              )}
              {tripCodeFilter !== 'all' && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Code: {tripCodeFilter}
                  <button onClick={() => setTripCodeFilter('all')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
                </Badge>
              )}
              {searchQuery && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Search: "{searchQuery}"
                  <button onClick={() => setSearchQuery('')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
                </Badge>
              )}
              <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-destructive font-normal transition-colors underline underline-offset-2 duration-250 ease-luxe">
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ PFI CODE MANAGEMENT ═══ */}
      {/* {tripCodes.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 shrink-0">
                <Tag className="size-3 text-muted-foreground" /> PFI Codes
              </span>
              {tripCodes.map(code => {
                const count = filteredLedgerGroups.filter(g => g.code === code).length
                return (
                  <span key={code} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setTripCodeFilter(prev => prev === code ? 'all' : code)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${tripCodeFilter === code
 ? 'bg-foreground text-background border-border '
 : 'bg-muted/10 text-foreground dark:text-muted-foreground border-border/20 hover:bg-muted/20'
 }`}
                    >
                      {code}{count > 0 ? ` · ${count}` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTripCode(code)}
                      title={`Delete ${code}`}
                      className="text-muted-foreground/50 hover:text-destructive transition-colors p-0.5 rounded duration-250 ease-luxe"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                )
              })}
              <span className="inline-flex items-center gap-1 ml-1">
                <input
                  placeholder="+ new code"
                  className="h-7 px-2 text-xs rounded-lg border border-dashed border-border bg-transparent text-foreground focus:outline-none focus:border-border focus:ring-1 focus:ring-ring w-24 uppercase transition-all duration-250 ease-luxe"
                  value={newTripCodeInput}
                  onChange={e => setNewTripCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTripCode() } }}
                />
                <button type="button" onClick={addTripCode} className="text-xs text-muted-foreground hover:text-foreground font-semibold transition-colors duration-250 ease-luxe">
                  Add
                </button>
              </span>
            </div>
          </div>
        </div>
      )} */}

      {/* ═══ VIEW SWITCHER ═══ */}
      <div className="flex items-center gap-1 bg-card rounded-lg border border-border p-1 w-fit">
        <button
          onClick={() => setActiveView('ledger')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${activeView === 'ledger'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:bg-muted hover:text-foreground'
 }`}
        >
          <Truck className="size-3.5" /> Sales Ledger
        </button>
        <button
          onClick={() => setActiveView('daily')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${activeView === 'daily'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:bg-muted hover:text-foreground'
 }`}
        >
          <CalendarIcon className="size-3.5" /> Daily Payments
          {filteredSales.length > 0 && (
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold leading-none ${activeView === 'daily' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
 }`}>
              {filteredSales.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══ SUMMARY CARDS ═══ */}
      <SummaryCards cards={summaryCards} />

      {/* ═══ PFI SUMMARY TABLE — commented out ═══

          A per-code breakdown of qty, expected, paid and balance. Taken out
          on request: the ledger below already answers the same questions per
          truck, and the summary was showing every allocation code the data
          has ever carried — including closed ones like PFI-14B and PFI-19B
          from April and May — so the page opened on a wall of settled history
          before reaching the rows anyone was looking for.

          Kept rather than deleted: totals.codeSummaries is still computed and
          the PFI Code filter still uses those codes, so this only needs
          uncommenting to come back.

        {activeView === 'ledger' && totals.codeSummaries.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 uppercase">
        <FileText className="size-4 text-muted-foreground" /> PFI Summary
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Payment status breakdown by PFI allocation code.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
        <span className="inline-flex items-center rounded-md bg-accent/10 px-2.5 py-1 text-accent ring-1 ring-inset ring-accent/20 gap-1.5">
        <span className="size-1.5 rounded-full bg-accent"></span> Sold: <strong>{totals.soldCount}</strong>
        </span>
        <span className="inline-flex items-center rounded-md bg-warning/10 px-2.5 py-1 text-warning ring-1 ring-inset ring-warning/20 gap-1.5">
        <span className="size-1.5 rounded-full bg-warning"></span> With Balance: <strong>{totals.withBalanceCount}</strong>
        </span>
        <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-muted-foreground ring-1 ring-inset ring-border gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground/60"></span> Not Sold: <strong>{totals.notSoldCount}</strong>
        </span>
        </div>
        </div>
        </div>
        <div className="overflow-x-auto">
        <Table className="text-xs">
        <TableHeader>
        <TableRow className="bg-muted/60 hover:bg-muted/60">
        <TableHead className="font-semibold text-muted-foreground w-[160px]">PFI Code</TableHead>
        <TableHead className="font-semibold text-muted-foreground w-[140px]">Qty Loaded</TableHead>
        <TableHead className="font-semibold text-muted-foreground w-[100px] text-center">Fully Paid</TableHead>
        <TableHead className="font-semibold text-muted-foreground w-[110px] text-center">With Balance</TableHead>
        <TableHead className="font-semibold text-muted-foreground w-[100px] text-center">Not Sold</TableHead>
        <TableHead className="font-semibold text-muted-foreground text-right w-[150px]">Expected Revenue</TableHead>
        <TableHead className="font-semibold text-accent text-right w-[140px]">Total Paid</TableHead>
        <TableHead className="font-semibold text-destructive text-right w-[150px]">Balance</TableHead>
        </TableRow>
        </TableHeader>
        <TableBody>
        {totals.codeSummaries.map(s => {
        const hasOutstanding = s.balance > 0; const isOverpaid = s.balance < 0
        return (
        <TableRow key={s.code || 'unassigned'} className="hover:bg-muted/50 bg-card">
        <TableCell className="font-semibold text-foreground uppercase whitespace-nowrap">{s.code || 'UNASSIGNED'}</TableCell>
        <TableCell className="font-semibold text-foreground whitespace-nowrap">{s.qty > 0 ? `${s.qty.toLocaleString()} Ltrs` : '—'}</TableCell>
        <TableCell className="text-center">
        <span className="inline-flex items-center justify-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/20">{s.soldCount}</span>
        </TableCell>
        <TableCell className="text-center">
        <span className="inline-flex items-center justify-center rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/20">{s.withBalanceCount}</span>
        </TableCell>
        <TableCell className="text-center">
        <span className="inline-flex items-center justify-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border">{s.notSoldCount}</span>
        </TableCell>
        <TableCell className="text-right font-semibold text-foreground whitespace-nowrap tabular-nums">{s.expected > 0 ? fmt(s.expected) : '—'}</TableCell>
        <TableCell className="text-right font-semibold text-accent whitespace-nowrap tabular-nums">{s.paid > 0 ? fmt(s.paid) : '—'}</TableCell>
        <TableCell className={`text-right font-semibold whitespace-nowrap ${hasOutstanding ? 'text-destructive' : isOverpaid ? 'text-muted-foreground' : 'text-accent'}`}>
        {s.balance === 0 ? '₦0' : isOverpaid ? `+${fmt(Math.abs(s.balance))}` : fmt(s.balance)}
        </TableCell>
        </TableRow>
        )
        })}
        </TableBody>
        </Table>
        </div>
        </div>
        )}
      */}

      {/* ═══ LEDGER TABLE ═══ */}
      {activeView === 'ledger' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLedgerGroups.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto size-16 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Truck className="size-8 text-muted-foreground/60" />
              </div>
              <p className="text-foreground font-semibold text-base">No sales ledger rows found</p>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                {ledgerGroups.length > 0
                  ? 'Try adjusting your filters or date range.'
                  : 'Allocate trucks in inventory or click "Record Payment" to create the first row.'}
              </p>
              {ledgerGroups.length > 0 && hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={clearAllFilters}>
                  <X className="size-3.5" /> Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="font-semibold text-muted-foreground w-12 text-center sticky top-0 bg-muted/90 backdrop-blur-sm">S/N</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">PFI Code</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Truck No.</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Customer</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Destination</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Quantity</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Rate</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Expected</TableHead>
                    {/* The three below belong to a payment, not to the load.
                        They used to be written into the Customer, Destination
                        and Rate cells of the sub-row, which put a payer's name
                        under a "Customer" heading and a bank under
                        "Destination" — different things sharing a column. */}
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Date Paid</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payer</TableHead>
                    <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Paid Into</TableHead>
                    <TableHead className="font-semibold text-accent text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payment</TableHead>
                    <TableHead className="font-semibold text-destructive text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Balance</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-center whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Status</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    let serial = pageOffset
                    const rows: React.ReactNode[] = []
                    // Whether a row is one share of a split truck is a fact
                    // about the load, carried on the group itself. Counting
                    // sibling rows in the current result instead meant a filter
                    // that matched only one customer dropped the badge, and the
                    // row went back to looking like a whole truck.
                    const renderedMultiLoadings = new Set<number>()

                    paginatedLedgerGroups.forEach(group => {
                      const theme = getCodeTheme(group.code)
                      const isMultiCustGroup = group.isSplitLoad
                      const isFirstInMultiGroup = isMultiCustGroup && group.loadingId != null && !renderedMultiLoadings.has(group.loadingId)
                      if (isMultiCustGroup && group.loadingId != null) renderedMultiLoadings.add(group.loadingId)
                      serial += 1
                      const isFullyPaid = group.balance <= 0 && group.expected > 0

                      rows.push(
                        <TableRow
                          key={`${group.key}-main`}
                          className={`cursor-pointer hover:bg-muted/70 border-b border-border border-l-[3px] transition-colors group ${isMultiCustGroup ? 'border-l-blue-500 bg-muted/10' : (theme ? theme.row : 'border-l-transparent')
 }`}
                          onClick={() => navigate({
                            to: '/sales-ledger/details',
                            search: {
                              key: group.key,
                              loadingId: group.loadingId ? String(group.loadingId) : '',
                              truckNumber: group.truckNumber,
                              dateLoaded: group.dateLoaded,
                              customerId: group.customerId || '',
                              code: group.code || '',
                            },
                          })}
                        >
                          <TableCell className="text-muted-foreground text-center text-xs">{serial}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {group.allocationCode ? (
                              <span className="text-sm font-semibold text-foreground">{group.allocationCode}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground whitespace-nowrap">
                            {isMultiCustGroup && !isFirstInMultiGroup ? (
                              <div className="flex items-center gap-1 pl-2 text-muted-foreground">
                                <span className="text-muted-foreground font-semibold text-base leading-none">↳</span>
                                <span className="text-xs text-muted-foreground">same truck</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Truck className="size-3.5 text-warning" />
                                {group.truckNumber || '—'}
                                {isMultiCustGroup && (
                                  <span className="ml-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                    <Split className="size-3" />
                                    Split · {group.shareCount} customers
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground uppercase whitespace-nowrap text-xs">{group.customerName || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs uppercase whitespace-nowrap">{group.location || '—'}</TableCell>
                          {/* This customer's volume, and — where the truck was
                              shared — what it is a share of. A bare "30,000 L"
                              on a 45,000 L truck is the number that started
                              this: correct for the row, wrong for the load. */}
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs tabular-nums">
                            {group.quantity > 0 ? (
                              <div className="flex flex-col items-end">
                                <span>{fmtQty(group.quantity)} L</span>
                                {isMultiCustGroup && group.loadQuantity > 0 && (
                                  <span className="text-xs text-muted-foreground/70">of {fmtQty(group.loadQuantity)} L</span>
                                )}
                              </div>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs tabular-nums">{group.rate > 0 ? fmt(group.rate) : '—'}</TableCell>
                          <TableCell className="text-right font-normal text-foreground whitespace-nowrap text-xs tabular-nums">{group.expected > 0 ? fmt(group.expected) : '—'}</TableCell>
                          {/* Date paid, payer and account are per-payment —
                              the main row is the load, and has none. */}
                          <TableCell />
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right font-semibold text-accent whitespace-nowrap text-xs tabular-nums">{fmt(toNum(group.totalPaid))}</TableCell>
                          <TableCell className={`text-right font-semibold whitespace-nowrap text-xs ${group.balance > 0 ? 'text-destructive' : group.balance < 0 ? 'text-muted-foreground' : group.expected > 0 ? 'text-accent' : 'text-muted-foreground'}`}>
                            {/* An overpayment reads as a plain positive figure
                                with a plus. Brackets are accountancy for a
                                negative, and this is money in hand, not owed. */}
                            {group.expected > 0 ? (group.balance === 0 ? '₦0' : group.balance > 0 ? fmt(group.balance) : `+${fmt(Math.abs(group.balance))}`) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            {group.payments.length === 0 ? (
                              <Badge variant="outline" className="text-xs font-semibold text-warning bg-warning/10 border-warning/20">
                                No payment
                              </Badge>
                            ) : isFullyPaid ? (
                              <Badge className="text-xs font-semibold bg-accent/10 text-accent border-accent/20">
                                Fully Paid
                              </Badge>
                            ) : (
                              <Badge className="text-xs font-semibold bg-destructive/10 text-destructive border-destructive/20">
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                          {/* Everything the detail page offers, on the row
                              itself — the whole point of opening that page was
                              usually one of these three. stopPropagation
                              because the row itself navigates. */}
                          {/* Labelled buttons, each in its own colour. Three
                              grey icons side by side said nothing about what
                              they did or which was the consequential one. */}
                          <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                className="h-7 gap-1 bg-accent px-2 text-xs hover:bg-accent/80"
                                onClick={() => { setQuickTarget(group); setQuickPaymentOpen(true) }}
                              >
                                <Plus className="size-3" />
                                Payment
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => { setQuickTarget(group); setRowSetupOpen(true) }}
                              >
                                <SlidersHorizontal className="size-3" />
                                Setup
                              </Button>
                              {/* Only where there is actually a surplus to move. */}
                              {group.balance < 0 && (
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 bg-blue-600 px-2 text-xs text-white hover:bg-blue-700"
                                  title={`Move the ${fmt(Math.abs(group.balance))} overpayment`}
                                  onClick={() => { setQuickTarget(group); setTransferOpen(true) }}
                                >
                                  <ArrowLeftRight className="size-3" />
                                  Move
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )

                      // Every payment on the row, in the order it came in,
                      // each carrying the balance it left behind. A row's
                      // Payment cell is a total; these are what it is made of.
                      let running = 0
                      group.payments.forEach((sale, payIdx) => {
                        const amount = toNum(sale.paymentAmount)
                        running += amount
                        const balanceAfter = group.expected - running
                        rows.push(
                          <TableRow
                            key={`${group.key}-pay-${sale._id || sale.id || payIdx}`}
                            className="bg-muted/25 border-b border-border/50 text-xs hover:bg-muted/40"
                          >
                            {/* S/N, PFI code and truck belong to the load. The
                                marker sits under the truck so the payment
                                reads as hanging off the row above it. */}
                            <TableCell />
                            <TableCell />
                            <TableCell className="whitespace-nowrap pl-4 text-muted-foreground/70">↳</TableCell>
                            {/* Customer, destination, quantity, rate and
                                expected are the load's, and a payment has none
                                of them. Left empty rather than filled with the
                                payment's own fields, which is what put a
                                payer's name under a "Customer" heading. */}
                            <TableCell colSpan={5} className="whitespace-nowrap text-right">
                              {sale.transferCounterparty && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900">
                                  <ArrowLeftRight className="size-3" />
                                  {amount < 0 ? 'moved to' : 'moved from'} {sale.transferCounterparty}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {safeFormatDate(sale.dateOfPayment || sale.dateLoaded, 'dd MMM yy')}
                            </TableCell>
                            <TableCell className="whitespace-nowrap uppercase text-muted-foreground">
                              {sale.payerName || '—'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatBankLabel(bankAccounts, sale.bank) || '—'}
                            </TableCell>
                            {/* A transfer out is money leaving this truck, so
                                it carries a minus rather than brackets — the
                                sign is the plain way to say it. */}
                            <TableCell className={`text-right font-semibold whitespace-nowrap tabular-nums ${amount < 0 ? 'text-blue-700 dark:text-blue-400' : 'text-accent'}`}>
                              {amount === 0 ? '—' : amount < 0 ? `-${fmt(Math.abs(amount))}` : fmt(amount)}
                            </TableCell>
                            <TableCell className={`text-right whitespace-nowrap tabular-nums ${balanceAfter > 0 ? 'text-destructive/80' : 'text-muted-foreground'}`}>
                              {group.expected > 0
                                ? (balanceAfter === 0 ? '₦0' : balanceAfter > 0 ? fmt(balanceAfter) : `+${fmt(Math.abs(balanceAfter))}`)
                                : ''}
                            </TableCell>
                            {/* No status here. Every sub-row read "Pending" or
                                "Confirmed" about the deposit, which is a
                                different question from the one the Status
                                column answers on the row above — whether the
                                truck is paid off. Two meanings, one heading. */}
                            <TableCell />
                            {/* Correcting a mistyped payment meant opening the
                                truck's own page to find the same row again.
                                Same two dialogs that page uses, so an entry
                                edits identically wherever it is found. */}
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="outline"
                                  className="h-6 gap-1 border-border px-1.5 text-xs"
                                  title="Edit this payment"
                                  onClick={() => { setEditTarget(sale); setEditOpen(true) }}
                                >
                                  <Pencil className="size-3" /> Edit
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="h-6 gap-1 border-destructive/30 px-1.5 text-xs text-destructive hover:bg-destructive/10"
                                  title="Delete this payment"
                                  onClick={() => {
                                    setDeleteTarget({
                                      ids: [entityId(sale)],
                                      mode: 'entry',
                                      label: `${group.truckNumber} — ${fmt(Math.abs(amount))}`,
                                    })
                                    setDeleteOpen(true)
                                  }}
                                >
                                  <Trash2 className="size-3" />
                                  <span className="sr-only">Delete this payment</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    })
                    return rows
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
          {/* Footer & Pagination */}
          {!isLoading && filteredLedgerGroups.length > 0 && renderPaginationFooter(
            filteredLedgerGroups.length,
            filteredLedgerGroups.reduce((s, g) => s + toNum(g.totalPaid), 0),
            'entries'
          )}
        </div>
      )}

      {/* ═══ DAILY PAYMENTS VIEW ═══ */}
      {activeView === 'daily' && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto size-16 rounded-xl bg-muted flex items-center justify-center mb-4">
                <CalendarIcon className="size-8 text-muted-foreground/60" />
              </div>
              <p className="text-foreground font-semibold text-base">No payment entries found</p>
              <p className="text-sm text-muted-foreground mt-1.5">Try adjusting your filters or date range.</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={clearAllFilters}>
                  <X className="size-3.5" /> Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableHead className="font-semibold text-muted-foreground w-[48px] text-center sticky top-0 bg-muted/90 backdrop-blur-sm">S/N</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Date Paid</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Truck No.</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Customer</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Destination</TableHead>
                      {/* Volume, Rate and Expected are gone. This is a list of
                          payments, and those three belong to the load: a truck
                          paid in four instalments printed its 33,000 L and its
                          full expected value on all four lines, which reads as
                          four loads and four invoices. The Ledger tab is where
                          a load's own figures live. */}
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payer</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Paid Into</TableHead>
                      <TableHead className="font-semibold text-accent text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Amount Paid</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Entered By</TableHead>
                      <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Day blocks, each closed by its own total. A flat list
                        of payments cannot be read as days without counting
                        rows, and "what came in on Tuesday" is the question
                        this tab exists for. Grouped within the page, so a
                        day split across two pages totals what is on each. */}
                    {groupPaymentsByDay(paginatedSales).flatMap((dayGroup) => {
                      const dayRows = dayGroup.rows.map((sale) => {
                      const customerName = sale.customerName || customerMap.get(idKey(sale.customerId))?.name || '—'
                      const datePaid = sale.dateOfPayment || sale.dateLoaded
                      const serial = pageOffset + paginatedSales.indexOf(sale) + 1
                      return (
                        <TableRow
                          key={sale._id || sale.id}
                          className="cursor-pointer hover:bg-muted/70 border-b border-border transition-colors duration-250 ease-luxe"
                          onClick={() => navigate({
                            to: '/sales-ledger/details',
                            search: {
                              truckNumber: sale.truckNumber,
                              dateLoaded: sale.dateLoaded || '',
                              customerId: idKey(sale.customerId),
                              code: sale.allocationCode || '',
                            },
                          })}
                        >
                          <TableCell className="text-muted-foreground text-center text-xs">{serial}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">{safeFormatDate(datePaid)}</TableCell>
                          <TableCell className="font-semibold text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Truck className="size-3 text-warning" />
                              {sale.truckNumber || '—'}
                            </div>
                          </TableCell>
                          <TableCell className="font-normal text-foreground uppercase whitespace-nowrap text-xs">{customerName}</TableCell>
                          <TableCell className="text-muted-foreground uppercase whitespace-nowrap text-xs">{sale.location || '—'}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs uppercase">
                            {sale.payerName || '—'}
                            {sale.transferCounterparty && (
                              <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900">
                                <ArrowLeftRight className="size-3" />
                                transfer
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {formatBankLabel(bankAccounts, sale.bank) || '—'}
                          </TableCell>
                          {/* Signed, because a transfer out is a real row on
                              this list and showing it as a dash would hide
                              money leaving. */}
                          <TableCell className={`text-right font-semibold whitespace-nowrap text-xs tabular-nums ${toNum(sale.paymentAmount) < 0 ? 'text-blue-700 dark:text-blue-400' : 'text-accent'}`}>
                            {toNum(sale.paymentAmount) === 0
                              ? '—'
                              : toNum(sale.paymentAmount) < 0
                                ? `-${fmt(Math.abs(toNum(sale.paymentAmount)))}`
                                : fmt(toNum(sale.paymentAmount))}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{sale.enteredBy || '—'}</TableCell>
                          {/* stopPropagation: the row navigates to the truck. */}
                          <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm" variant="outline"
                                className="h-6 gap-1 border-border px-1.5 text-xs"
                                title="Edit this payment"
                                onClick={() => { setEditTarget(sale); setEditOpen(true) }}
                              >
                                <Pencil className="size-3" /> Edit
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                className="h-6 gap-1 border-destructive/30 px-1.5 text-xs text-destructive hover:bg-destructive/10"
                                title="Delete this payment"
                                onClick={() => {
                                  setDeleteTarget({
                                    ids: [entityId(sale)],
                                    mode: 'entry',
                                    label: `${sale.truckNumber || 'Payment'} — ${fmt(Math.abs(toNum(sale.paymentAmount)))}`,
                                  })
                                  setDeleteOpen(true)
                                }}
                              >
                                <Trash2 className="size-3" />
                                <span className="sr-only">Delete this payment</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                      })

                      return [
                        ...dayRows,
                        <TableRow key={`day-${dayGroup.day}`} className="bg-muted/60 hover:bg-muted/60 border-b-2 border-border">
                          <TableCell />
                          <TableCell className="whitespace-nowrap text-xs font-semibold" colSpan={6}>
                            {dayGroup.day
                              ? `${safeFormatDate(dayGroup.day)} — ${dayGroup.totals.count} ${dayGroup.totals.count === 1 ? 'payment' : 'payments'}`
                              : `No date recorded — ${dayGroup.totals.count} payments`}
                            {/* Only worth saying when some of the day's money
                                moved between trucks rather than coming in. */}
                            {dayGroup.totals.transferred !== 0 && (
                              <span className="ml-2 font-normal text-blue-700 dark:text-blue-400">
                                incl. {fmt(dayGroup.totals.transferred)} moved between trucks
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-accent whitespace-nowrap tabular-nums">
                            {fmt(dayGroup.totals.paid)}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                        </TableRow>,
                      ]
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Footer & Pagination */}
              {!isLoading && filteredSales.length > 0 && renderPaginationFooter(
                filteredSales.length,
                filteredSales.reduce((s, p) => s + toNum(p.paymentAmount), 0),
                'payments'
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ DIALOGS ═══ */}
      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trucks={loadedTrucks}
        customers={customers}
        customerMap={customerMap}
        tripCodes={tripCodes}
        cycleCustomerRateMap={cycleCustomerRateMap}
        getCycleKey={getCycleKey}
        normalizeCycleDate={normalizeCycleDate}
        assignMode={assignMode}
        loadSummaries={loadSummaries}
      />

      <QuickPaymentDialog
        open={quickPaymentOpen}
        onOpenChange={setQuickPaymentOpen}
        target={quickTarget}
      />

      <RowSetupDialog
        open={rowSetupOpen}
        onOpenChange={setRowSetupOpen}
        target={quickTarget}
        customers={customers}
        customerMap={customerMap}
        tripCodes={tripCodes}
      />

      {/* Destinations come from the whole filtered ledger, not the page:
          the truck a surplus should go to is very often not on screen. */}
      <TransferOverpaymentDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        source={quickTarget}
        candidates={filteredLedgerGroups}
      />

      <EditEntryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        target={editTarget}
        tripCodes={tripCodes}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        target={deleteTarget}
      />

      <ScopedBankAccountsDialog
        open={bankAccountsOpen}
        onOpenChange={setBankAccountsOpen}
        usage={BANK_ACCOUNT_USAGE.truckSales}
        title="Truck Sales Bank Accounts"
        description="The accounts offered when recording a truck sale payment or a station remittance. Only the accounts ticked here appear in those dropdowns."
      />
    </div>
  )
}
