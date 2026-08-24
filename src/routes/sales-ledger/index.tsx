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
  Plus, Search, Download, Truck, Wallet, FileText,
  TrendingUp, Banknote, Building2,
  Calendar as CalendarIcon, X, Users, Tag,
  ChevronDown, ChevronRight, ChevronLeft, SlidersHorizontal,
  Loader2,
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
  RecordPaymentDialog,
} from '#/components/sales-ledger/SalesLedgerDialogs'
import {
  toNum, fmt, fmtQty, normalizeCycleDate, getCycleKey, safeFormatDate,
  getCodeTheme, type TimePreset,
} from '#/lib/sales-ledger-utils'
import { useBankAccountPicker, formatBankLabel } from '#/lib/bank-accounts'
import { routeGuard } from '#/lib/route-guard'

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
  const customerMap = useMemo(() => {
    const m = new Map<string, DeliveryCustomer>()
    customers.forEach(c => m.set(c._id || c.id || '', c))
    return m
  }, [customers])

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    pfis.forEach(p => m.set(p._id, p))
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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  useEffect(() => {
    setCurrentPage(1)
  }, [
    activeView, searchQuery, timePreset, customFrom, customTo,
    truckFilter, customerFilter, customerTypeFilter, tripCodeFilter,
  ])

  const paginatedLedgerGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredLedgerGroups.slice(start, start + pageSize)
  }, [filteredLedgerGroups, currentPage, pageSize])

  const paginatedSales = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredSales.slice(start, start + pageSize)
  }, [filteredSales, currentPage, pageSize])

  const renderPaginationFooter = (
    totalCount: number,
    totalPaidSum: number,
    itemLabel: string
  ) => {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const startItem = totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0
    const endItem = Math.min(currentPage * pageSize, totalCount)

    return (
      <div className="border-t border-border bg-muted/50 px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-normal">Rows per page:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(val) => {
                setPageSize(Number(val))
                setCurrentPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[72px] bg-background text-xs">
                <SelectValue placeholder={pageSize.toString()} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="15">15</SelectItem>
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

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

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
      const cycleKey = `${(group.truckNumber || '').trim().toUpperCase()}||${(group.dateLoaded || '').split('T')[0]}`
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
  const cyclePaymentSummary = useMemo(() => {
    const map = new Map<string, { totalExpected: number; totalPaid: number }>()
    allSales.forEach(s => {
      const key = getCycleKey(s.truckNumber, s.dateLoaded)
      const existing = map.get(key) || { totalExpected: 0, totalPaid: 0 }
      existing.totalPaid += toNum(s.paymentAmount)
      map.set(key, existing)
    })
    return map
  }, [allSales])

  const loadedTrucks = useMemo(() => {
    return allLoadings.filter(t => {
      if (!(t.truckNumber || (t as any).truckId || (t as any).truck)) return false
      if (t.loadingStatus === 'offloaded') {
        const cycleKey = getCycleKey(t.truckNumber || '', t.dateAllocated || '')
        const cycle = cyclePaymentSummary.get(cycleKey)
        if (cycle) {
          const outstanding = cycle.totalExpected - cycle.totalPaid
          if (outstanding <= 0 && cycle.totalExpected > 0) return false
        }
      }
      return true
    }).sort((a, b) => {
      const truckA = (a.truckNumber || '').toUpperCase()
      const truckB = (b.truckNumber || '').toUpperCase()
      if (truckA !== truckB) return truckA.localeCompare(truckB)
      return normalizeCycleDate(b.dateAllocated || '').localeCompare(normalizeCycleDate(a.dateAllocated || ''))
    })
  }, [allLoadings, cyclePaymentSummary])

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
  const [assignMode, setAssignMode] = useState(false)

  const openPaymentDialog = (_loadingId?: string, inAssignMode = false) => {
    setAssignMode(inAssignMode)
    setDialogOpen(true)
  }

  // ── CSV Export ──────────────────────────────────────────────────────
  const exportExcel = useCallback(() => {
    if (!filteredLedgerGroups.length) return
    const u = (s: string) => (s || '').toUpperCase()
    const safeFmtDate = (d: string | null | undefined): string => safeFormatDate(d, 'dd/MM/yyyy')
    const headers = ['S/N', 'PFI CODE', 'TRUCK NO.', 'CUSTOMER', 'DESTINATION', 'QTY (LTRS)', 'RATE', 'EXPECTED', 'PAYMENT', 'BALANCE', 'PAYER', 'BANK', 'PAYMENT DATE']
    const rows: string[][] = []
    let sn = 0
    filteredLedgerGroups.forEach(group => {
      sn += 1
      if (group.payments.length === 0) {
        rows.push([String(sn), group.code || '', group.truckNumber || '', u(group.customerName || ''), u(group.location || ''), group.quantity > 0 ? String(group.quantity) : '', group.rate > 0 ? String(group.rate) : '', group.expected > 0 ? String(group.expected) : '', '', group.expected > 0 ? String(group.expected) : '', '', '', ''])
      } else {
        let cumulative = 0
        group.payments.forEach((s, idx) => {
          cumulative += toNum(s.paymentAmount)
          const bal = group.expected - cumulative
          rows.push([
            idx === 0 ? String(sn) : '', idx === 0 ? (group.code || '') : '', idx === 0 ? group.truckNumber : '', idx === 0 ? u(group.customerName || '') : '', idx === 0 ? u(group.location || '') : '',
            idx === 0 && group.quantity > 0 ? String(group.quantity) : '', idx === 0 && group.rate > 0 ? String(group.rate) : '', idx === 0 && group.expected > 0 ? String(group.expected) : '',
            toNum(s.paymentAmount) > 0 ? String(toNum(s.paymentAmount)) : '', group.expected > 0 ? (bal === 0 ? 'FULLY PAID' : bal > 0 ? String(bal) : `+${String(Math.abs(bal))}`) : '',
            u(s.payerName || ''), u(formatBankLabel(bankAccounts, s.bank)), safeFmtDate(s.dateOfPayment),
          ])
        })
      }
    })
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'DELIVERY-SALES-LEDGER.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }, [filteredLedgerGroups])

  const exportDailyPayments = useCallback(() => {
    if (!filteredSales.length) return
    const u = (s: string) => (s || '').toUpperCase()
    const safeFmtDate = (d: string | null | undefined): string => safeFormatDate(d, 'dd/MM/yyyy')
    const period = timePreset === 'custom' ? `${customFrom || '?'}_TO_${customTo || '?'}` : timePreset.toUpperCase()
    const headers = ['S/N', 'DATE PAID', 'TRUCK NO.', 'CUSTOMER', 'DESTINATION', 'VOLUME (L)', 'RATE', 'EXPECTED', 'AMOUNT PAID', 'PAYER', 'BANK', 'PHONE', 'ENTERED BY']
    const rows = filteredSales.map((s, idx) => [
      String(idx + 1), safeFmtDate(s.dateOfPayment || s.dateLoaded), u(s.truckNumber),
      u(s.customerName || customerMap.get(String(s.customerId))?.name || ''), u(s.location || ''),
      toNum(s.quantity) > 0 ? String(toNum(s.quantity)) : '', toNum(s.rate) > 0 ? String(toNum(s.rate)) : '',
      toNum(s.salesValue) > 0 ? String(toNum(s.salesValue)) : '', toNum(s.paymentAmount) > 0 ? String(toNum(s.paymentAmount)) : '',
      u(s.payerName || ''), u(formatBankLabel(bankAccounts, s.bank)), s.phoneNumber || '', u(s.enteredBy || ''),
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `DAILY-PAYMENTS-${period}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }, [filteredSales, customerMap, timePreset, customFrom, customTo])

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
          <>
            <Button variant="outline" className="gap-2" onClick={activeView === 'ledger' ? exportExcel : exportDailyPayments} disabled={activeView === 'ledger' ? filteredLedgerGroups.length === 0 : filteredSales.length === 0}>
              <Download className="size-4" />
              <span className="hidden sm:inline">{activeView === 'ledger' ? 'Download Ledger' : 'Download Payments'}</span>
              <span className="sm:hidden">Export</span>
            </Button>
            <Button className="gap-2 bg-accent hover:bg-accent/80" onClick={() => openPaymentDialog()}>
              <Plus className="size-4" /> Record Payment
            </Button>
          </>
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

          {/* Advanced Filters Toggle */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors duration-250 ease-luxe"
            >
              <SlidersHorizontal className="size-3.5" />
              Advanced Filters
              {hasActiveFilters && (
                <Badge className="ml-1 h-5 px-1.5 text-xs bg-primary text-primary-foreground">
                  Active
                </Badge>
              )}
              {showAdvancedFilters ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          </div>

          {/* Collapsible Advanced Filters */}
          {showAdvancedFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="normal">Normal Customers</SelectItem>
                    <SelectItem value="filling_station">Filling Stations</SelectItem>
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
              {customerTypeFilter !== 'all' && (
                <Badge variant="outline" className="gap-1 pr-1 text-xs font-normal">
                  Type: {customerTypeFilter === 'filling_station' ? 'Filling Station' : 'Normal'}
                  <button onClick={() => setCustomerTypeFilter('all')} className="ml-0.5 hover:text-destructive transition-colors duration-250 ease-luxe"><X className="size-2.5" /></button>
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
      {tripCodes.length > 0 && (
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
      )}

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

      {/* ═══ PFI SUMMARY TABLE ═══ */}
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
                      <TableCell className="text-right font-semibold text-foreground whitespace-nowrap">{s.expected > 0 ? fmt(s.expected) : '—'}</TableCell>
                      <TableCell className="text-right font-semibold text-accent whitespace-nowrap">{s.paid > 0 ? fmt(s.paid) : '—'}</TableCell>
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
                    <TableHead className="font-semibold text-accent text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payment</TableHead>
                    <TableHead className="font-semibold text-destructive text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Balance</TableHead>
                    <TableHead className="font-semibold text-muted-foreground text-center whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    let serial = (currentPage - 1) * pageSize
                    const rows: React.ReactNode[] = []
                    const multiCustCounts = new Map<number, number>()
                    filteredLedgerGroups.forEach(g => {
                      if (g.loadingId && g.key.split(':').length === 3) multiCustCounts.set(g.loadingId, (multiCustCounts.get(g.loadingId) ?? 0) + 1)
                    })
                    const multiCustLoadingIds = new Set(Array.from(multiCustCounts.entries()).filter(([, c]) => c > 1).map(([id]) => id))
                    const renderedMultiLoadings = new Set<number>()

                    paginatedLedgerGroups.forEach(group => {
                      const theme = getCodeTheme(group.code)
                      const isMultiCustGroup = group.loadingId != null && multiCustLoadingIds.has(group.loadingId)
                      const isFirstInMultiGroup = isMultiCustGroup && !renderedMultiLoadings.has(group.loadingId!)
                      if (isMultiCustGroup) renderedMultiLoadings.add(group.loadingId!)
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
                                {isFirstInMultiGroup && (
                                  <span className="ml-0.5 text-xs font-semibold text-muted-foreground bg-muted/10 px-1.5 py-0.5 rounded-full border border-border/20 whitespace-nowrap">
                                    {multiCustCounts.get(group.loadingId!)} customers
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground uppercase whitespace-nowrap text-xs">{group.customerName || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs uppercase whitespace-nowrap">{group.location || '—'}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs">{group.quantity > 0 ? `${fmtQty(group.quantity)} L` : '—'}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs">{group.rate > 0 ? fmt(group.rate) : '—'}</TableCell>
                          <TableCell className="text-right font-normal text-foreground whitespace-nowrap text-xs">{group.expected > 0 ? fmt(group.expected) : '—'}</TableCell>
                          <TableCell className="text-right font-semibold text-accent whitespace-nowrap text-xs">{fmt(toNum(group.totalPaid))}</TableCell>
                          <TableCell className={`text-right font-semibold whitespace-nowrap text-xs ${group.balance > 0 ? 'text-destructive' : group.balance < 0 ? 'text-muted-foreground' : group.expected > 0 ? 'text-accent' : 'text-muted-foreground'}`}>
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
                        </TableRow>
                      )
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
                      <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Volume (L)</TableHead>
                      <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Rate</TableHead>
                      <TableHead className="font-semibold text-muted-foreground text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Expected</TableHead>
                      <TableHead className="font-semibold text-accent text-right whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Amount Paid</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payer</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Payment Method</TableHead>
                      <TableHead className="font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-muted/90 backdrop-blur-sm">Entered By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedSales.map((sale, idx) => {
                      const customerName = sale.customerName || customerMap.get(String(sale.customerId))?.name || '—'
                      const datePaid = sale.dateOfPayment || sale.dateLoaded
                      const serial = (currentPage - 1) * pageSize + idx + 1
                      return (
                        <TableRow
                          key={sale._id || sale.id}
                          className="cursor-pointer hover:bg-muted/70 border-b border-border transition-colors duration-250 ease-luxe"
                          onClick={() => navigate({
                            to: '/sales-ledger/details',
                            search: {
                              truckNumber: sale.truckNumber,
                              dateLoaded: sale.dateLoaded || '',
                              customerId: String(sale.customerId || ''),
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
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs">{toNum(sale.quantity) > 0 ? fmtQty(toNum(sale.quantity)) : '—'}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs">{toNum(sale.rate) > 0 ? fmt(toNum(sale.rate)) : '—'}</TableCell>
                          <TableCell className="text-right text-muted-foreground whitespace-nowrap text-xs">{toNum(sale.salesValue) > 0 ? fmt(toNum(sale.salesValue)) : '—'}</TableCell>
                          <TableCell className="text-right font-semibold text-accent whitespace-nowrap text-xs">{toNum(sale.paymentAmount) > 0 ? fmt(toNum(sale.paymentAmount)) : '—'}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">{sale.payerName || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {formatBankLabel(bankAccounts, sale.bank) || '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{sale.enteredBy || '—'}</TableCell>
                        </TableRow>
                      )
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
      />
    </div>
  )
}
