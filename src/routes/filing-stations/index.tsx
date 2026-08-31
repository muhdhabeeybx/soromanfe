import { useState, useMemo, useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SummaryCards, type SummaryCard } from '#/components/SummaryCards'
import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import {
  Fuel, Plus, Search, Download, Trash2, Pencil,
  Truck, Wallet, TrendingUp, Banknote, MapPin, Users,
  Filter, Tag, Receipt, ArrowRightLeft, ChevronRight, ChevronDown,
  Calendar as CalendarIcon, X, Eye, Loader2, FileSpreadsheet, FileText,
} from 'lucide-react'
import {
  format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, isWithinInterval,
} from 'date-fns'
import { useFilingStations } from '#/lib/hooks/useFilingStations'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { useDeliverySalesList, useCreateDeliverySale, useUpdateDeliverySale, useDeleteDeliverySale, useSetDepositStatus } from '#/lib/hooks/useDeliverySales'
import { useDeliveryInventoryList, useUpdateDeliveryInventory, useDeleteDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useToast } from '#/lib/hooks/useToast'
import { cn, toNum, getErrorMessage } from '#/lib/utils'
import type { FilingStation, DeliverySale, DeliveryCustomer, AccountEntry } from '#/lib/types'
import { routeGuard } from '#/lib/route-guard'
import { normalizePlate } from '#/lib/sales-ledger-utils'
import { buildLoadSplit } from '#/lib/load-split'

export const Route = createFileRoute('/filing-stations/')({
  beforeLoad: () => routeGuard('/filing-stations'),
  component: FilingStationsDashboard,
})

import { useBankAccountPicker, bankAccountToString } from '#/lib/bank-accounts'
import {
  DepositChannelPicker, BankAccountSelect, BankChargesPanel, RemittanceAmountField,
} from '#/components/filing-stations/RemittanceChannelFields'
import { sumByChannel, type DepositChannel } from '#/lib/deposit-channel'
import { exportStationLedgerExcel, exportStationLedgerPdf } from './-station-ledger-export'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const fmt = (n: number) =>
  `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtQty = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const formatWithCommas = (v: string): string => {
  const cleaned = v.replace(/[^0-9.]/g, '')
  const parts = cleaned.split('.')
  const intPart = (parts[0] || '').replace(/^0+(?=\d)/, '')
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (parts.length > 1) return `${formatted}.${parts[1]}`
  return formatted
}

const stripCommas = (v: string): string => v.replace(/,/g, '')

type TimePreset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all' | 'custom'

const normalizeCycleDate = (dateValue: string | undefined | null): string => {
  if (!dateValue) return ''
  const raw = String(dateValue).trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  try {
    return format(parseISO(raw), 'yyyy-MM-dd')
  } catch {
    return raw.split('T')[0] || raw
  }
}

const getCycleKey = (truckNum: string, dateLoaded: string | undefined | null): string =>
  `${(truckNum || '').trim().toUpperCase()}||${normalizeCycleDate(dateLoaded)}`

const matchesDateRange = (
  dateStr: string | undefined | null,
  from: Date | null,
  to: Date | null,
): boolean => {
  if (!dateStr || (!from && !to)) return true
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr)
    if (from && to) return isWithinInterval(d, { start: startOfDay(from), end: endOfDay(to) })
    if (from) return d >= startOfDay(from)
    if (to) return d <= endOfDay(to)
    return true
  } catch {
    return true
  }
}

const getPresetRange = (preset: TimePreset): { from: Date | null; to: Date | null } => {
  const now = new Date()
  switch (preset) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) }
    case 'yesterday': { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) } }
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'year': return { from: startOfYear(now), to: endOfYear(now) }
    case 'all': return { from: null, to: null }
    case 'custom': return { from: null, to: null }
  }
}

const CODE_PALETTE = [
  { row: 'bg-muted/60 border-l-sky-300', badge: 'bg-muted text-foreground border-border' },
  { row: 'bg-accent/60 border-l-emerald-300', badge: 'bg-accent/10 text-accent border-accent/40' },
  { row: 'bg-warning/60 border-l-orange-300', badge: 'bg-warning/10 text-warning border-warning/40' },
  { row: 'bg-muted/60 border-l-violet-300', badge: 'bg-muted text-foreground border-border' },
  { row: 'bg-muted/60 border-l-pink-300', badge: 'bg-muted text-foreground border-border' },
  { row: 'bg-warning/60 border-l-amber-300', badge: 'bg-warning/10 text-warning border-warning/40' },
  { row: 'bg-accent/60 border-l-teal-300', badge: 'bg-accent/10 text-accent border-accent/40' },
  { row: 'bg-muted/60 border-l-indigo-300', badge: 'bg-muted text-foreground border-border' },
]

const getCodeTheme = (code: string) => {
  if (!code) return null
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0
  return CODE_PALETTE[hash % CODE_PALETTE.length]
}

const normalizeText = (v: string | undefined | null) => (v || '').trim().toLowerCase()

const isFillingStationCustomer = (c: DeliveryCustomer | FilingStation | undefined | null): boolean => {
  if (!c) return false
  const name = (c.name || (c as any).customer_name || '').toLowerCase()
  const customerType = (c as any).customerType || (c as any).customer_type
  const notes = (c as any).notes || ''
  return (
    customerType === 'filling_station' ||
    notes.includes('__type:filling_station__') ||
    name.includes('station') ||
    name.includes('filling') ||
    name.includes('retail') ||
    name.includes('outlet')
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Types & Forms
// ═══════════════════════════════════════════════════════════════════════════

type EntryTab = 'sale' | 'deposit' | 'expense'

interface QuickPaymentForm {
  payment_amount: string
  rate: string
  quantity: string
  date_of_payment: string
  payer_name: string
  phone_number: string
  bank_account_id: string
  deposit_channel: DepositChannel
  deposit_status: 'pending' | 'paid'
  remarks: string
}

interface LedgerGroup {
  key: string
  loadingId?: string
  stationId: string
  stationName: string
  truckNumber: string
  dateLoaded: string
  depot: string
  location: string
  quantity: number
  totalQtySold: number
  rate: number
  expected: number
  totalPaid: number
  totalExpenses: number
  balance: number
  code: string
  payments: DeliverySale[]
  collectionAccounts: AccountEntry[]
  remittanceAccounts: AccountEntry[]
  cycleNum?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

function FilingStationsDashboard() {
  const navigate = useNavigate()
  const toast = useToast()

  // ── Filters ────────────────────────────────────────────────────────
  const [timePreset, setTimePreset] = useState<TimePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [truckFilter, setTruckFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [stationFilter, setStationFilter] = useState<string>('all')
  const [allocationCodeFilter, setAllocationCodeFilter] = useState<string>('all')
  const [rateFilter, setRateFilter] = useState<string>('all')
  const [cycleFilter, setCycleFilter] = useState<string>('all')

  // ── Cycle Aliasing ────────────────────────────────────────────────
  const [cycleAliasMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('dsl_cycle_aliases') || '{}') } catch { return {} }
  })

  // ── Card Expand/Collapse ──────────────────────────────────────────
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const toggleCard = (key: string) =>
    setExpandedCards(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // ── Record Entry Dialog ──────────────────────────────────────────
  const [quickPaymentTarget, setQuickPaymentTarget] = useState<LedgerGroup | null>(null)
  const [activeEntryTab, setActiveEntryTab] = useState<EntryTab>('sale')
  const [quickPaymentForm, setQuickPaymentForm] = useState<QuickPaymentForm>({
    payment_amount: '',
    rate: '',
    quantity: '',
    date_of_payment: format(new Date(), 'yyyy-MM-dd'),
    payer_name: '',
    phone_number: '',
    bank_account_id: '',
    deposit_channel: 'bank_deposit',
    deposit_status: 'paid',
    remarks: '',
  })

  // Every account, active or not — an entry recorded into an account since
  // retired still has to resolve to a name.
  const { accounts: bankAccounts, byId: bankAccountsById } = useBankAccountPicker()

  // The cycle's running POS/deposit split, so the charges panel can show the
  // pair rather than only the figure being typed.
  const quickPaymentChannelTotals = useMemo(
    () => sumByChannel(quickPaymentTarget?.payments || []),
    [quickPaymentTarget],
  )
  const [quickPaymentSaving, setQuickPaymentSaving] = useState(false)

  // ── Edit Entry Dialog ─────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<{
    entry: DeliverySale
    group: LedgerGroup
  } | null>(null)
  const [editForm, setEditForm] = useState<{
    date_of_payment: string
    quantity: string
    rate: string
    sales_value: string
    payment_amount: string
    expenses_amount: string
    payer_name: string
    bank: string
    deposit_channel: DepositChannel
  deposit_status: 'pending' | 'paid'
    phone_number: string
    remarks: string
    location: string
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // ── Allocation Code Dialog ────────────────────────────────────────
  const [codeEditTarget, setCodeEditTarget] = useState<LedgerGroup | null>(null)
  const [codeInputValue, setCodeInputValue] = useState('')
  const [codeSaving, setCodeSaving] = useState(false)

  // ── Delete Dialog ──────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{
    ids: string[]
    loadingId?: string
    mode: 'entry' | 'truck'
    label: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────
  const { data: stations = [], isLoading: isLoadingStations } = useFilingStations()
  const { data: customerListRes, isLoading: isLoadingDeliveryCusts } = useDeliveryCustomerList({ type: 'filling_station' })
  const { data: allSales = [], isLoading: isLoadingSales } = useDeliverySalesList()
  const { data: allLoadings = [], isLoading: isLoadingInventory } = useDeliveryInventoryList()

  const deliveryCustomers = useMemo(() => {
    if (!customerListRes) return []
    if (Array.isArray(customerListRes)) return customerListRes
    if (Array.isArray(customerListRes.customers)) return customerListRes.customers
    if (Array.isArray(customerListRes.results)) return customerListRes.results
    return []
  }, [customerListRes])

  const createSaleMutation = useCreateDeliverySale()
  const updateSaleMutation = useUpdateDeliverySale()
  const setDepositStatusMutation = useSetDepositStatus()
  const deleteSaleMutation = useDeleteDeliverySale()
  const updateInventoryMutation = useUpdateDeliveryInventory()
  const deleteInventoryMutation = useDeleteDeliveryInventory()

  const isLoading = isLoadingStations || isLoadingSales || isLoadingInventory || isLoadingDeliveryCusts

  // ── Station Lookup Map ─────────────────────────────────────────────
  const stationMap = useMemo(() => {
    const m = new Map<string, { id: string; name: string; stationObj?: any }>()
    stations.forEach(s => {
      const id = String(s._id || (s as any).id || '')
      if (id) m.set(id, { id, name: s.name, stationObj: s })
    })
    deliveryCustomers.forEach((c: any) => {
      const id = String(c._id || c.id || '')
      if (id && !m.has(id)) {
        m.set(id, { id, name: c.name || c.customer_name || '', stationObj: c })
      }
    })
    return m
  }, [stations, deliveryCustomers])

  const stationIds = useMemo(() => new Set(Array.from(stationMap.keys())), [stationMap])

  // Filter sales and loadings to station records
  const stationSales = useMemo(() =>
    allSales.filter(s => {
      if (s.customerId && stationIds.has(String(s.customerId))) return true
      const cObj = s.customerId ? stationMap.get(String(s.customerId))?.stationObj : null
      return isFillingStationCustomer(cObj) || (s.customerName && (s.customerName.toLowerCase().includes('station') || s.customerName.toLowerCase().includes('retail')))
    }),
    [allSales, stationIds, stationMap])

  const stationLoadings = useMemo(() =>
    allLoadings.filter(l => {
      if (l.customerId && stationIds.has(String(l.customerId))) return true
      const cObj = l.customerId ? stationMap.get(String(l.customerId))?.stationObj : null
      return isFillingStationCustomer(cObj)
    }),
    [allLoadings, stationIds, stationMap])

  // ── Cycle Number Calculation ───────────────────────────────────────
  const cycleNumberMap = useMemo(() => {
    const truckDatesMap = new Map<string, Set<string>>()

    stationLoadings.forEach(l => {
      const truck = normalizePlate(l.truckNumber)
      const date = normalizeCycleDate(l.dateAllocated || '')
      if (!truck || !date) return
      if (!truckDatesMap.has(truck)) truckDatesMap.set(truck, new Set())
      truckDatesMap.get(truck)!.add(date)
    })

    stationSales.forEach(s => {
      const truck = normalizePlate(s.truckNumber)
      const date = normalizeCycleDate(s.dateLoaded || '')
      if (!truck || !date) return
      if (!truckDatesMap.has(truck)) truckDatesMap.set(truck, new Set())
      truckDatesMap.get(truck)!.add(date)
    })

    const truckDateList = new Map<string, string[]>()
    truckDatesMap.forEach((dates, truck) => {
      truckDateList.set(truck, Array.from(dates).sort((a, b) => a.localeCompare(b)))
    })

    const map = new Map<string, { cycleNum: number; totalCycles: number }>()

    truckDateList.forEach((dates, truck) => {
      dates.forEach((date, idx) => {
        const key = `${truck}||${date}`
        map.set(key, { cycleNum: idx + 1, totalCycles: dates.length })
      })
    })

    return map
  }, [stationLoadings, stationSales])

  // ── Unique values for filters ──────────────────────────────────────
  const uniqueTruckNumbers = useMemo(() => {
    const set = new Set<string>()
    stationSales.forEach(s => { if (s.truckNumber) set.add(s.truckNumber) })
    stationLoadings.forEach(l => { if (l.truckNumber) set.add(l.truckNumber) })
    return Array.from(set).sort()
  }, [stationSales, stationLoadings])

  const uniqueLocations = useMemo(() => {
    const set = new Set<string>()
    stationSales.forEach(s => { if (s.location) set.add(s.location) })
    stationLoadings.forEach(l => { if (l.location) set.add(l.location) })
    return Array.from(set).sort()
  }, [stationSales, stationLoadings])

  const uniqueAllocationCodes = useMemo(() => {
    const set = new Set<string>()
    stationSales.forEach(s => { if (s.allocationCode) set.add(s.allocationCode.trim().toUpperCase()) })
    stationLoadings.forEach(l => { if (l.allocationCode) set.add(l.allocationCode.trim().toUpperCase()) })
    return Array.from(set).sort()
  }, [stationSales, stationLoadings])

  const uniqueStationOptions = useMemo(() => {
    const map = new Map<string, string>()
    stationSales.forEach(s => {
      const name = s.customerName || stationMap.get(String(s.customerId || ''))?.name
      if (s.customerId && name) map.set(String(s.customerId), name)
    })
    stationLoadings.forEach(l => {
      const name = l.customerName || stationMap.get(String(l.customerId || ''))?.name
      if (l.customerId && name) map.set(String(l.customerId), name)
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [stationSales, stationLoadings, stationMap])

  const uniqueRates = useMemo(() => {
    const set = new Set<number>()
    stationSales.forEach(s => {
      const r = toNum(s.rate)
      if (r > 0) set.add(r)
    })
    return Array.from(set).sort((a, b) => a - b)
  }, [stationSales])

  const uniqueCycleOptions = useMemo(() => {
    const maxCycle = Array.from(cycleNumberMap.values()).reduce((m, v) => Math.max(m, v.cycleNum), 0)
    if (maxCycle <= 1) return []
    return Array.from({ length: maxCycle }, (_, i) => i + 1)
  }, [cycleNumberMap])

  // ── Date Range ─────────────────────────────────────────────────────
  const dateRange = useMemo(() => {
    if (timePreset === 'custom') {
      return {
        from: customFrom ? parseISO(customFrom) : null,
        to: customTo ? parseISO(customTo) : null,
      }
    }
    return getPresetRange(timePreset)
  }, [timePreset, customFrom, customTo])

  // ── Build Ledger Groups ────────────────────────────────────────────
  const ledgerGroups = useMemo(() => {
    const groups: LedgerGroup[] = []
    const matchedSaleIds = new Set<string>()
    const salesByCycleKey = new Map<string, DeliverySale[]>()

    // Group sales by truck+date cycle key
    stationSales.forEach(sale => {
      const rawKey = getCycleKey(sale.truckNumber, sale.dateLoaded)
      const key = cycleAliasMap[rawKey] || rawKey
      const arr = salesByCycleKey.get(key) ?? []
      arr.push(sale)
      salesByCycleKey.set(key, arr)
    })

    const getObjId = (obj: any) => String(obj?._id || obj?.id || '')

    const sortPayments = (payments: DeliverySale[]) => [...payments].sort((a, b) => {
      const dA = a.dateOfPayment || a.createdAt || a.dateLoaded || ''
      const dB = b.dateOfPayment || b.createdAt || b.dateLoaded || ''
      return dA.localeCompare(dB) || getObjId(a).localeCompare(getObjId(b))
    })

    const filteredLoadings = stationLoadings.filter(l => !!(l.truckNumber || (l as any).truck))

    filteredLoadings.forEach(loading => {
      const loadingId = getObjId(loading)
      const rawCycleKey = getCycleKey(loading.truckNumber || '', loading.dateAllocated || '')
      const cycleKey = cycleAliasMap[rawCycleKey] || rawCycleKey
      const cycleSales = salesByCycleKey.get(cycleKey) || []

      let payments = cycleSales.filter(sale => {
        if (matchedSaleIds.has(getObjId(sale))) return false
        const customerMatches = loading.customerId ? String(sale.customerId) === String(loading.customerId) : true
        return customerMatches
      })

      if (payments.length === 0 && loading.customerId) {
        payments = cycleSales.filter(sale => !matchedSaleIds.has(getObjId(sale)) && String(sale.customerId) === String(loading.customerId))
      }

      payments = sortPayments(payments)
      payments.forEach(p => matchedSaleIds.add(getObjId(p)))

      const stationId = String(loading.customerId || payments[0]?.customerId || '')
      const stationObj = stationMap.get(stationId)
      const stationName = loading.customerName || payments[0]?.customerName || stationObj?.name || 'Station'

      // The station's own share, read the same way the ledger reads it — off
      // the money on the row where the quantity column and the sales value
      // disagree, which they do wherever a load was split after the fact.
      const maxSaleQty = buildLoadSplit(loading, payments).shares[0]?.quantity ?? 0
      const quantity = maxSaleQty > 0 ? maxSaleQty : toNum(loading.quantityAllocated)

      const dailySales = payments.filter(s => {
        const q = toNum(s.quantity)
        return q > 0 && q < quantity
      })

      const expected = dailySales.reduce((sum, s) => sum + toNum(s.salesValue), 0)
      const rate = dailySales.reduce((max, s) => Math.max(max, toNum(s.rate)), 0) || payments.reduce((max, s) => Math.max(max, toNum(s.rate)), 0)
      const totalPaid = payments.reduce((sum, s) => sum + toNum(s.paymentAmount), 0)
      const totalExpenses = payments.reduce((sum, s) => sum + toNum(s.expensesAmount ?? 0), 0)
      const totalQtySold = dailySales.reduce((sum, s) => sum + toNum(s.quantity), 0)

      const cycleInfo = cycleNumberMap.get(rawCycleKey)

      groups.push({
        key: `loading:${loadingId}`,
        loadingId: loadingId,
        stationId,
        stationName,
        truckNumber: loading.truckNumber || '',
        dateLoaded: loading.dateAllocated || payments[0]?.dateLoaded || '',
        depot: loading.depot || loading.pfiLocation || payments[0]?.depotLoaded || '',
        location: loading.location || payments[0]?.location || '',
        quantity,
        totalQtySold,
        rate,
        expected,
        totalPaid,
        totalExpenses,
        balance: expected - (totalPaid + totalExpenses),
        code: loading.allocationCode || payments.map(s => s.allocationCode).find(Boolean) || '',
        payments,
        collectionAccounts: (loading.collectionAccounts?.length ? loading.collectionAccounts : payments[0]?.collectionAccounts) || [],
        remittanceAccounts: (loading.remittanceAccounts?.length ? loading.remittanceAccounts : payments[0]?.remittanceAccounts) || [],
        cycleNum: cycleInfo?.cycleNum,
      })
    })

    // Unmatched sales
    const unmatchedGroups = new Map<string, DeliverySale[]>()
    stationSales.forEach(sale => {
      if (matchedSaleIds.has(getObjId(sale))) return
      const rawCycleKey = getCycleKey(sale.truckNumber, sale.dateLoaded)
      const cycleKey = cycleAliasMap[rawCycleKey] || rawCycleKey
      const groupKey = [
        cycleKey,
        sale.customerId || '',
        normalizeText(sale.location),
      ].join('::')
      const arr = unmatchedGroups.get(groupKey) ?? []
      arr.push(sale)
      unmatchedGroups.set(groupKey, arr)
    })

    unmatchedGroups.forEach((payments, groupKey) => {
      const sorted = sortPayments(payments)
      const first = sorted[0]
      const quantity = payments.reduce((max, s) => Math.max(max, toNum(s.quantity)), 0)
      const dailySales = payments.filter(s => {
        const q = toNum(s.quantity)
        return q > 0 && q < quantity
      })
      const expected = dailySales.reduce((sum, s) => sum + toNum(s.salesValue), 0)
      const totalPaid = payments.reduce((sum, s) => sum + toNum(s.paymentAmount), 0)
      const totalExpenses = payments.reduce((sum, s) => sum + toNum(s.expensesAmount ?? 0), 0)
      const totalQtySold = dailySales.reduce((sum, s) => sum + toNum(s.quantity), 0)
      const stationObj = stationMap.get(String(first.customerId || ''))

      const rawCycleKey = getCycleKey(first.truckNumber, first.dateLoaded)
      const cycleInfo = cycleNumberMap.get(rawCycleKey)

      groups.push({
        key: `sale:${groupKey}`,
        stationId: String(first.customerId || ''),
        stationName: first.customerName || stationObj?.name || 'Station',
        truckNumber: first.truckNumber,
        dateLoaded: first.dateLoaded || '',
        depot: first.depotLoaded || '',
        location: first.location || '',
        quantity,
        totalQtySold,
        rate: dailySales.reduce((max, s) => Math.max(max, toNum(s.rate)), 0) || sorted.reduce((max, s) => Math.max(max, toNum(s.rate)), 0),
        expected,
        totalPaid,
        totalExpenses,
        balance: expected - (totalPaid + totalExpenses),
        code: first.allocationCode || sorted.map(s => s.allocationCode).find(Boolean) || '',
        payments: sorted,
        collectionAccounts: sorted.map(s => s.collectionAccounts).find(a => a && a.length) || [],
        remittanceAccounts: sorted.map(s => s.remittanceAccounts).find(a => a && a.length) || [],
        cycleNum: cycleInfo?.cycleNum,
      })
    })

    return groups
  }, [stationLoadings, stationSales, stationMap, cycleAliasMap, cycleNumberMap])

  // ── Filtered Groups ────────────────────────────────────────────────
  const filteredLedgerGroups = useMemo(() => {
    let result = [...ledgerGroups]

    result = result.filter(group => {
      const isInventoryLinked = !!group.loadingId
      if (isInventoryLinked) return true
      return (
        matchesDateRange(group.dateLoaded, dateRange.from, dateRange.to)
        || group.payments.some(p => matchesDateRange(p.dateOfPayment || p.createdAt || p.dateLoaded, dateRange.from, dateRange.to))
      )
    })

    if (truckFilter !== 'all') result = result.filter(g => g.truckNumber === truckFilter)
    if (locationFilter !== 'all') result = result.filter(g => g.location === locationFilter)
    if (stationFilter !== 'all') result = result.filter(g => g.stationId === stationFilter)
    if (allocationCodeFilter !== 'all') result = result.filter(g => g.code === allocationCodeFilter)
    if (cycleFilter !== 'all') {
      const targetCycle = Number(cycleFilter)
      result = result.filter(g => g.cycleNum === targetCycle)
    }
    if (rateFilter !== 'all') {
      const rateNum = Number(rateFilter)
      result = result.filter(g => g.payments.some(p => Math.abs(toNum(p.rate) - rateNum) < 1))
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(g =>
        (g.truckNumber || '').toLowerCase().includes(q)
        || (g.depot || '').toLowerCase().includes(q)
        || (g.location || '').toLowerCase().includes(q)
        || (g.stationName || '').toLowerCase().includes(q)
        || (g.code || '').toLowerCase().includes(q)
        || g.payments.some(p =>
          (p.payerName || '').toLowerCase().includes(q)
          || (p.bank || '').toLowerCase().includes(q)
        )
      )
    }

    return result.sort((a, b) => {
      const codeDiff = (a.code || 'ZZZZ').localeCompare(b.code || 'ZZZZ')
      if (codeDiff !== 0) return codeDiff
      const dateDiff = (b.dateLoaded || '').localeCompare(a.dateLoaded || '')
      if (dateDiff !== 0) return dateDiff
      return (a.truckNumber || '').localeCompare(b.truckNumber || '')
    })
  }, [ledgerGroups, dateRange, truckFilter, locationFilter, stationFilter, allocationCodeFilter, cycleFilter, rateFilter, searchQuery])

  // ── Totals ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let totalExpected = 0, totalPaid = 0, totalExpenses = 0, totalBalance = 0
    let totalQtyAllocated = 0, totalQtySold = 0, entries = 0
    const uniqueTrucks = new Set<string>()
    const uniqueStations = new Set<string>()

    filteredLedgerGroups.forEach(g => {
      if (g.truckNumber) uniqueTrucks.add(g.truckNumber)
      if (g.stationId) uniqueStations.add(g.stationId)
      totalQtyAllocated += Math.max(0, toNum(g.quantity))
      totalQtySold += Math.max(0, toNum(g.totalQtySold))
      totalExpected += Math.max(0, toNum(g.expected))
      totalPaid += toNum(g.totalPaid)
      totalExpenses += toNum(g.totalExpenses)
      totalBalance += toNum(g.balance)
      entries += g.payments.length
    })

    return {
      entries, totalExpected, totalPaid, totalExpenses,
      totalQtyAllocated, totalQtySold, balance: totalBalance,
      truckCount: uniqueTrucks.size, stationCount: uniqueStations.size,
    }
  }, [filteredLedgerGroups])

  const summaryCards = useMemo((): SummaryCard[] => [
    {
      title: 'Active Stations',
      value: String(totals.truckCount),
      description: `${totals.stationCount} station${totals.stationCount === 1 ? '' : 's'} · ${totals.entries} entries`,
      icon: <Truck className="size-5" />,
      tone: 'neutral',
    },
    {
      title: 'Volume Sold / Allocated',
      value: totals.totalQtyAllocated > 0 ? `${totals.totalQtySold.toLocaleString()} / ${totals.totalQtyAllocated.toLocaleString()} L` : '0 L',
      description: totals.totalQtyAllocated > 0 ? `${Math.round((totals.totalQtySold / totals.totalQtyAllocated) * 100)}% of allocated volume sold` : 'No allocations yet',
      icon: <Fuel className="size-5" />,
      tone: 'neutral',
    },
    {
      title: 'Expected Revenue',
      value: fmt(totals.totalExpected),
      description: 'Target value of all daily pump sales',
      icon: <TrendingUp className="size-5" />,
      tone: 'neutral',
    },
    {
      title: 'Total Deposited',
      value: fmt(totals.totalPaid),
      description: 'Bank deposits & collections received',
      icon: <Banknote className="size-5" />,
      tone: 'green',
    },
    {
      title: 'Total Expenses',
      value: fmt(totals.totalExpenses),
      description: 'Operating costs recorded against stations',
      icon: <Receipt className="size-5" />,
      tone: 'amber',
    },
    {
      title: 'Outstanding Balance',
      value: totals.balance > 0 ? fmt(totals.balance) : totals.balance < 0 ? `+${fmt(Math.abs(totals.balance))}` : '₦0.00 ✓',
      description: totals.balance > 0 ? 'Yet to be collected' : totals.balance < 0 ? 'Overpaid' : 'Fully reconciled',
      icon: <Wallet className="size-5" />,
      tone: totals.balance > 0 ? 'red' : 'green',
    },
  ], [totals])

  // ── Handlers ───────────────────────────────────────────────────────
  const handlePresetChange = (preset: TimePreset) => {
    setTimePreset(preset)
    if (preset !== 'custom') { setCustomFrom(''); setCustomTo('') }
  }

  const openQuickPaymentDialog = (group?: LedgerGroup) => {
    setQuickPaymentTarget(group || filteredLedgerGroups[0] || null)
    setActiveEntryTab('sale')
    setQuickPaymentForm({
      payment_amount: '',
      rate: group?.rate ? String(group.rate) : '',
      quantity: '',
      date_of_payment: format(new Date(), 'yyyy-MM-dd'),
      payer_name: group?.stationName || '',
      phone_number: '',
      bank_account_id: '1',
      deposit_channel: 'bank_deposit',
    deposit_status: 'paid',
      remarks: '',
    })
  }

  const handleSaveQuickPayment = useCallback(async () => {
    if (!quickPaymentTarget) {
      toast.error('Select a filling station allocation')
      return
    }

    const payload: Partial<DeliverySale> = {
      truckNumber: quickPaymentTarget.truckNumber,
      dateLoaded: quickPaymentTarget.dateLoaded,
      depotLoaded: quickPaymentTarget.depot,
      customerId: quickPaymentTarget.stationId ? (quickPaymentTarget.stationId as any) : null,
      customerName: quickPaymentTarget.stationName,
      location: quickPaymentTarget.location,
      allocationCode: quickPaymentTarget.code,
      remarks: quickPaymentForm.remarks,
    }

    if (activeEntryTab === 'sale') {
      const qty = toNum(quickPaymentForm.quantity)
      const rate = toNum(quickPaymentForm.rate)
      if (!qty || qty <= 0) {
        toast.error('Enter valid pump sales volume (litres)')
        return
      }
      if (!rate || rate <= 0) {
        toast.error('Enter selling rate per litre')
        return
      }
      payload.quantity = qty
      payload.rate = rate
      payload.salesValue = qty * rate
      payload.dateOfPayment = quickPaymentForm.date_of_payment
      payload.paymentAmount = 0
    } else if (activeEntryTab === 'deposit') {
      const amt = toNum(quickPaymentForm.payment_amount)
      if (!amt || amt <= 0) {
        toast.error('Enter deposit amount')
        return
      }
      if (!quickPaymentForm.bank_account_id) {
        toast.error('Select a bank account')
        return
      }
      const bankAcc = bankAccountsById.get(quickPaymentForm.bank_account_id)
      payload.paymentAmount = amt
      payload.payerName = quickPaymentForm.payer_name
      payload.phoneNumber = quickPaymentForm.phone_number
      // Account NUMBER first. This wrote the account NAME, which carries no
      // number at all, so nothing recorded from this page could ever be
      // resolved back to an account the way every report does it.
      payload.bank = bankAcc ? bankAccountToString(bankAcc) : 'Bank Deposit'
      payload.bankAccountId = bankAcc ? Number(bankAcc.id) : undefined
      payload.depositChannel = quickPaymentForm.deposit_channel
      payload.dateOfPayment = quickPaymentForm.date_of_payment
      payload.quantity = 0
    } else if (activeEntryTab === 'expense') {
      const expAmt = toNum(quickPaymentForm.payment_amount)
      if (!expAmt || expAmt <= 0) {
        toast.error('Enter expense amount')
        return
      }
      payload.expensesAmount = expAmt
      payload.dateOfPayment = quickPaymentForm.date_of_payment
      payload.quantity = 0
      payload.paymentAmount = 0
    }

    setQuickPaymentSaving(true)
    try {
      await createSaleMutation.mutateAsync(payload)
      if (quickPaymentTarget?.key) {
        setExpandedCards(prev => new Set(prev).add(quickPaymentTarget.key))
      }
      toast.success('Entry recorded successfully')
      setQuickPaymentTarget(null)
    } finally {
      setQuickPaymentSaving(false)
    }
  }, [quickPaymentTarget, activeEntryTab, quickPaymentForm, bankAccountsById, createSaleMutation, toast])

  const openEditDialog = (entry: DeliverySale, group: LedgerGroup) => {
    setEditTarget({ entry, group })
    setEditForm({
      date_of_payment: entry.dateOfPayment || entry.dateLoaded || format(new Date(), 'yyyy-MM-dd'),
      quantity: entry.quantity ? String(entry.quantity) : '',
      rate: entry.rate ? String(entry.rate) : '',
      sales_value: entry.salesValue ? String(entry.salesValue) : '',
      payment_amount: entry.paymentAmount ? String(entry.paymentAmount) : '',
      expenses_amount: entry.expensesAmount ? String(entry.expensesAmount) : '',
      payer_name: entry.payerName || '',
      bank: entry.bank || '',
      deposit_channel: (entry.depositChannel as DepositChannel) || 'bank_deposit',
      deposit_status: entry.depositStatus === 'paid' ? 'paid' : 'pending',
      phone_number: entry.phoneNumber || '',
      remarks: entry.remarks || '',
      location: entry.location || '',
    })
  }

  const handleSaveEdit = useCallback(async () => {
    if (!editTarget || !editForm) return
    const entryId = String(editTarget.entry._id || editTarget.entry.id || '')
    if (!entryId) return

    const qty = toNum(editForm.quantity)
    const rate = toNum(editForm.rate)
    const salesVal = qty > 0 && rate > 0 ? qty * rate : toNum(editForm.sales_value)

    const payload: Partial<DeliverySale> = {
      dateOfPayment: editForm.date_of_payment,
      quantity: qty,
      rate,
      salesValue: salesVal,
      paymentAmount: toNum(editForm.payment_amount),
      expensesAmount: toNum(editForm.expenses_amount),
      payerName: editForm.payer_name,
      bank: editForm.bank,
      // Only on rows that move money — a pump sale or an expense tagged with
      // a channel would be pulled into the bank-charges pair.
      depositChannel: toNum(editForm.payment_amount) > 0 ? editForm.deposit_channel : null,
      phoneNumber: editForm.phone_number,
      remarks: editForm.remarks,
      location: editForm.location,
    }

    setEditSaving(true)
    try {
      await updateSaleMutation.mutateAsync({ id: entryId, data: payload })
      // depositStatus travels on its own route — the update route strips it.
      const current = editTarget.entry.depositStatus === 'paid' ? 'paid' : 'pending'
      if (editForm.deposit_status !== current) {
        await setDepositStatusMutation.mutateAsync({ id: entryId, depositStatus: editForm.deposit_status })
      }
      setEditTarget(null)
      setEditForm(null)
    } finally {
      setEditSaving(false)
    }
  }, [editTarget, editForm, updateSaleMutation, setDepositStatusMutation])

  const openCodeEditDialog = (group: LedgerGroup) => {
    setCodeEditTarget(group)
    setCodeInputValue(group.code || '')
  }

  const handleSaveAllocationCode = useCallback(async () => {
    if (!codeEditTarget) return
    setCodeSaving(true)
    const newCode = codeInputValue.trim().toUpperCase()
    try {
      if (codeEditTarget.loadingId) {
        await updateInventoryMutation.mutateAsync({ id: codeEditTarget.loadingId, data: { allocationCode: newCode } })
      }
      await Promise.all(codeEditTarget.payments.map(p => {
        const pId = String(p._id || p.id || '')
        if (!pId) return Promise.resolve()
        return updateSaleMutation.mutateAsync({ id: pId, data: { allocationCode: newCode } })
      }))
      toast.success('Allocation code updated')
      setCodeEditTarget(null)
    } catch {
      toast.error('Failed to update code')
    } finally {
      setCodeSaving(false)
    }
  }, [codeEditTarget, codeInputValue, updateInventoryMutation, updateSaleMutation, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await Promise.all(deleteTarget.ids.map(id => deleteSaleMutation.mutateAsync(id)))
      if (deleteTarget.mode === 'truck' && deleteTarget.loadingId) {
        await deleteInventoryMutation.mutateAsync(deleteTarget.loadingId)
      }
      toast.success(deleteTarget.mode === 'truck' ? 'Truck record deleted' : 'Entry deleted')
      setDeleteTarget(null)
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleteSaleMutation, deleteInventoryMutation, toast])

  // ── Deposit Status Quick Toggle ───────────────────────────────────
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  // 'paid' is the enum's confirmed state. This used to send 'confirmed',
  // which is not one of the three the column accepts — and it sent it on the
  // update route, which strips depositStatus outright. So the toggle flipped
  // nothing at all while reporting that it had.
  const handleToggleDepositStatus = useCallback(async (entry: DeliverySale) => {
    const entryId = String(entry._id || entry.id || '')
    if (!entryId) return
    const nextStatus = entry.depositStatus === 'paid' ? 'pending' : 'paid'
    setUpdatingStatusId(entryId)
    try {
      await setDepositStatusMutation.mutateAsync({ id: entryId, depositStatus: nextStatus })
      toast.success(nextStatus === 'paid' ? 'Deposit confirmed' : 'Deposit set back to pending')
    } catch {
      toast.error('Failed to update status')
    } finally {
      setUpdatingStatusId(null)
    }
  }, [setDepositStatusMutation, toast])

  const periodLabel = timePreset === 'custom'
    ? `${customFrom || '?'} – ${customTo || '?'}`
    : timePreset === 'all' ? 'All Time' : timePreset.charAt(0).toUpperCase() + timePreset.slice(1)

  // ── Exports ────────────────────────────────────────────────────────
  //
  // This used to be a CSV writing one line per cycle with a single
  // `Deposited` column holding the SUM of that cycle's remittances — five
  // separate deposits on different days into different banks came out as one
  // number with no way back to the entries. Each remittance is now its own
  // row under its cycle. See -station-ledger-export.ts.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const runExport = useCallback(async (kind: 'excel' | 'pdf') => {
    if (!filteredLedgerGroups.length) return
    const filters = {
      periodLabel,
      stationName: stationFilter === 'all'
        ? 'All stations'
        : (stations.find(st => String(st._id) === stationFilter)?.name || 'All stations'),
      search: searchQuery,
    }
    setExporting(kind)
    try {
      if (kind === 'excel') {
        await exportStationLedgerExcel(filteredLedgerGroups, filters, bankAccounts)
      } else {
        await exportStationLedgerPdf(filteredLedgerGroups, filters, bankAccounts)
      }
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setExporting(null)
    }
  }, [filteredLedgerGroups, periodLabel, stationFilter, stations, searchQuery, bankAccounts, toast])

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        title="Filling Stations"
        description="Fuel allocated to filling stations. Track pump sales, bank deposits, operating expenses, and outstanding balances per delivery cycle."
        actions={
          <>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() => navigate({ to: '/filing-stations/form' as any })}
 >
              <Plus className="size-4 mr-2" />Create Station
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => openQuickPaymentDialog()}
 >
              <Plus className="size-4 mr-1.5" />Record Entry
            </Button>
            <Button
              variant="outline" size="sm" className="cursor-pointer"
              onClick={() => runExport('excel')}
              disabled={filteredLedgerGroups.length === 0 || exporting !== null}
            >
              {exporting === 'excel'
                ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                : <FileSpreadsheet className="size-3.5 mr-1.5" />}
              Export Excel
            </Button>
            <Button
              variant="outline" size="sm" className="cursor-pointer"
              onClick={() => runExport('pdf')}
              disabled={filteredLedgerGroups.length === 0 || exporting !== null}
            >
              {exporting === 'pdf'
                ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                : <FileText className="size-3.5 mr-1.5" />}
              Export PDF
            </Button>
          </>
        }
 />

      {/* Summary Cards */}
      <SummaryCards cards={summaryCards} />

      {/* Filter Panel */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search station, truck, code…"
              className="pl-8 h-9 text-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
 />
            {searchQuery && (
              <button title="Clear" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['today', 'yesterday', 'week', 'month', 'year', 'all'] as TimePreset[]).map(tp => (
              <button
                key={tp}
                type="button"
                onClick={() => handlePresetChange(tp)}
                className={cn(
                  'px-2.5 py-1 text-xs font-normal rounded-full border transition-colors cursor-pointer duration-250 ease-luxe',
                  timePreset === tp
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-card text-muted-foreground border-border hover:border-foreground/40'
                )}
 >
                {tp === 'all' ? 'All' : tp.charAt(0).toUpperCase() + tp.slice(1)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedFilters(f => !f)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-normal rounded-full border transition-colors cursor-pointer duration-250 ease-luxe',
              showAdvancedFilters || [truckFilter, locationFilter, stationFilter, allocationCodeFilter, rateFilter, cycleFilter].some(f => f !== 'all')
                ? 'bg-foreground text-background border-foreground'
                : 'bg-card text-muted-foreground border-border hover:border-foreground/40'
            )}
 >
            <Filter className="size-3" />
            Filters
            {[truckFilter, locationFilter, stationFilter, allocationCodeFilter, rateFilter, cycleFilter].filter(f => f !== 'all').length > 0 && (
              <span className="ml-0.5 bg-background text-foreground rounded-full size-4 flex items-center justify-center text-xs font-semibold">
                {[truckFilter, locationFilter, stationFilter, allocationCodeFilter, rateFilter, cycleFilter].filter(f => f !== 'all').length}
              </span>
            )}
            <ChevronDown className={cn('size-3 transition-transform duration-250 ease-luxe', showAdvancedFilters && 'rotate-180')} />
          </button>
        </div>

        {timePreset === 'custom' && (
          <div className="px-4 pb-3 flex flex-wrap gap-3 items-end border-t border-border pt-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 w-[150px]" />
            </div>
          </div>
        )}

        {showAdvancedFilters && (
          <div className="border-t border-border px-4 py-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><Truck className="size-2.5" /> Truck</label>
              <select aria-label="Truck" value={truckFilter} onChange={e => setTruckFilter(e.target.value)}
                className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', truckFilter !== 'all' ? 'border-foreground font-semibold' : 'border-border text-muted-foreground')}>
                <option value="all">All</option>
                {uniqueTruckNumbers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><MapPin className="size-2.5" /> Destination</label>
              <select aria-label="Destination" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
                className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', locationFilter !== 'all' ? 'border-foreground font-semibold' : 'border-border text-muted-foreground')}>
                <option value="all">All</option>
                {uniqueLocations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><Users className="size-2.5" /> Station</label>
              <select aria-label="Station" value={stationFilter} onChange={e => setStationFilter(e.target.value)}
                className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', stationFilter !== 'all' ? 'border-foreground font-semibold' : 'border-border text-muted-foreground')}>
                <option value="all">All</option>
                {uniqueStationOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {uniqueAllocationCodes.length > 0 && (
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><Tag className="size-2.5" /> Code</label>
                <select aria-label="Code" value={allocationCodeFilter} onChange={e => setAllocationCodeFilter(e.target.value)}
                  className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', allocationCodeFilter !== 'all' ? 'border-border font-semibold text-foreground dark:text-muted-foreground bg-muted dark:bg-foreground/40' : 'border-border text-muted-foreground')}>
                  <option value="all">All</option>
                  {uniqueAllocationCodes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {uniqueRates.length > 0 && (
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><TrendingUp className="size-2.5" /> Rate (₦/L)</label>
                <select aria-label="Rate" value={rateFilter} onChange={e => setRateFilter(e.target.value)}
                  className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', rateFilter !== 'all' ? 'border-foreground font-semibold' : 'border-border text-muted-foreground')}>
                  <option value="all">All Rates</option>
                  {uniqueRates.map(r => <option key={r} value={r}>₦{r.toLocaleString()}/L</option>)}
                </select>
              </div>
            )}
            {uniqueCycleOptions.length > 0 && (
              <div className="space-y-1">
                <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase"><Receipt className="size-2.5" /> Cycle</label>
                <select aria-label="Cycle" value={cycleFilter} onChange={e => setCycleFilter(e.target.value)}
                  className={cn('h-8 w-full rounded-md border bg-background text-foreground px-2 text-xs', cycleFilter !== 'all' ? 'border-foreground font-semibold' : 'border-border text-muted-foreground')}>
                  <option value="all">All Cycles</option>
                  {uniqueCycleOptions.map(c => <option key={c} value={c}>Cycle {c}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {(truckFilter !== 'all' || locationFilter !== 'all' || stationFilter !== 'all' || allocationCodeFilter !== 'all' || rateFilter !== 'all' || cycleFilter !== 'all') && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {truckFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal"><Truck className="size-2.5" />{truckFilter}<button type="button" title="Remove" onClick={() => setTruckFilter('all')}><X className="size-2.5" /></button></span>}
            {locationFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal"><MapPin className="size-2.5" />{locationFilter}<button type="button" title="Remove" onClick={() => setLocationFilter('all')}><X className="size-2.5" /></button></span>}
            {stationFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal"><Users className="size-2.5" />{uniqueStationOptions.find(c => c.id === stationFilter)?.name || stationFilter}<button type="button" title="Remove" onClick={() => setStationFilter('all')}><X className="size-2.5" /></button></span>}
            {allocationCodeFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal"><Tag className="size-2.5" />{allocationCodeFilter}<button type="button" title="Remove" onClick={() => setAllocationCodeFilter('all')}><X className="size-2.5" /></button></span>}
            {rateFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal">₦{Number(rateFilter).toLocaleString()}/L<button type="button" title="Remove" onClick={() => setRateFilter('all')}><X className="size-2.5" /></button></span>}
            {cycleFilter !== 'all' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-foreground text-xs font-normal">Cycle {cycleFilter}<button type="button" title="Remove" onClick={() => setCycleFilter('all')}><X className="size-2.5" /></button></span>}
          </div>
        )}
      </div>

      {/* Station Cards */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLedgerGroups.length === 0 ? (
          <div className="bg-white rounded-xl border border-border p-16 text-center">
            <Fuel className="size-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground font-normal">No filling station allocations found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Assign filling stations in the inventory or create a new station first.</p>
          </div>
        ) : (
          <>
            {filteredLedgerGroups.map((group) => {
              const isExpanded = expandedCards.has(group.key)
              const theme = getCodeTheme(group.code)
              const pctSold = group.quantity > 0 ? Math.min(100, Math.round((group.totalQtySold / group.quantity) * 100)) : 0

              return (
                <div
                  key={group.key}
                  className={cn(
                    'bg-card rounded-xl border overflow-hidden transition-all duration-250 ease-luxe',
                    isExpanded ? 'border-accent/40 dark:border-accent ring-1 ring-accent dark:ring-accent/30' : 'border-border'
                  )}
 >
                  {/* Card Header */}
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleCard(group.key)}
                          className="mt-0.5 shrink-0 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer duration-250 ease-luxe"
 >
                          <ChevronRight className={cn('size-4 transition-transform duration-200 ease-luxe', isExpanded && 'rotate-90 text-accent')} />
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground text-sm uppercase tracking-tight truncate">
                              {group.stationName || 'Unnamed Station'}
                            </h3>
                            {group.cycleNum && (
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/20">
                                Cycle {group.cycleNum}
                              </span>
                            )}
                            {group.code ? (
                              <span className={cn('shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border cursor-pointer', theme ? theme.badge : 'bg-muted text-muted-foreground border-border')} onClick={() => openCodeEditDialog(group)}>
                                {group.code}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openCodeEditDialog(group)}
                                className="text-xs text-muted-foreground hover:text-foreground underline decoration-dashed"
 >
                                + Add Code
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Truck className="size-3 text-warning" />{group.truckNumber || '—'}</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="flex items-center gap-1">
                              <CalendarIcon className="size-3 text-muted-foreground/60" />
                              {group.dateLoaded ? (() => { try { return format(parseISO(group.dateLoaded), 'dd MMM yyyy') } catch { return group.dateLoaded } })() : '—'}
                            </span>
                            {group.location && (
                              <>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="flex items-center gap-1"><MapPin className="size-3 text-muted-foreground/60" />{group.location}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1 cursor-pointer"
                          onClick={() => openQuickPaymentDialog(group)}
 >
                          <Plus className="size-3.5" /> Record Entry
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5 cursor-pointer"
                          onClick={() => navigate({ to: '/filing-stations/details' as any, search: { stationId: group.stationId } as any })}
 >
                          <Eye className="size-3.5" /> View Details
                        </Button>
                      </div>
                    </div>

                    {/* Summary Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border">
                      <div className="space-y-0.5">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Allocated</p>
                        <p className="text-sm font-semibold text-foreground">{group.quantity > 0 ? `${fmtQty(group.quantity)} L` : '—'}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', pctSold >= 100 ? 'bg-accent' : pctSold >= 60 ? 'bg-warning' : 'bg-muted-foreground/30')} style={{ width: `${pctSold}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground font-semibold shrink-0">{pctSold}%</span>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Sold</p>
                        <p className="text-sm font-semibold text-foreground">{group.totalQtySold > 0 ? `${fmtQty(group.totalQtySold)} L` : '—'}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Deposited</p>
                        <p className="text-sm font-semibold text-accent">{group.totalPaid > 0 ? fmt(group.totalPaid) : '—'}</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs uppercase text-muted-foreground font-semibold">Balance</p>
                        <p className={cn('text-sm font-semibold', group.balance === 0 ? 'text-accent' : group.balance > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                          {group.balance === 0 ? '✓ Settled' : group.balance > 0 ? fmt(group.balance) : `+${fmt(Math.abs(group.balance))}`}
                        </p>
                      </div>
                    </div>

                    {(group.collectionAccounts.length > 0 || group.remittanceAccounts.length > 0) && (
                      <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.collectionAccounts.length > 0 && (
                          <div className="rounded-lg bg-muted/60 dark:bg-foreground/40 border border-border dark:border-border/50 px-3 py-2 space-y-2">
                            <p className="text-xs uppercase text-muted-foreground font-semibold flex items-center gap-1">
                              <Wallet className="size-2.5" /> Collection Account{group.collectionAccounts.length > 1 ? 's' : ''}
                            </p>
                            {group.collectionAccounts.map((acc, i) => (
                              <div key={i}>
                                <p className="text-xs font-semibold text-foreground">{acc.name || '—'}</p>
                                <p className="text-xs text-muted-foreground">{acc.bank}{acc.bank && acc.number ? ' · ' : ''}{acc.number}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {group.remittanceAccounts.length > 0 && (
                          <div className="rounded-lg bg-muted/60 dark:bg-foreground/40 border border-border dark:border-border/50 px-3 py-2 space-y-2">
                            <p className="text-xs uppercase text-muted-foreground font-semibold flex items-center gap-1">
                              <ArrowRightLeft className="size-2.5" /> Remittance Account{group.remittanceAccounts.length > 1 ? 's' : ''}
                            </p>
                            {group.remittanceAccounts.map((acc, i) => (
                              <div key={i}>
                                <p className="text-xs font-semibold text-foreground">{acc.name || '—'}</p>
                                <p className="text-xs text-muted-foreground">{acc.bank}{acc.bank && acc.number ? ' · ' : ''}{acc.number}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Ledger Table */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {group.payments.length === 0 ? (
                        <div className="py-8 text-center">
                          <p className="text-sm text-muted-foreground">No daily activity recorded for this cycle yet.</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 text-xs"
                            onClick={() => openQuickPaymentDialog(group)}
 >
                            <Plus className="size-3 mr-1" /> Add First Entry
                          </Button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table className="text-xs">
                            <TableHeader>
                              <TableRow className="bg-muted/30 border-b border-border">
                                <TableHead className="font-semibold text-muted-foreground w-[36px] px-4">#</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Date</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right">Volume</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right">Rate</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right">Sales Value</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right">Deposits</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Depositor</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Bank</TableHead>
                                <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right">Expenses</TableHead>
                                <TableHead className="font-semibold text-muted-foreground text-right px-4">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.payments
                                .filter(p => toNum(p.quantity) > 0 || toNum(p.paymentAmount) > 0 || toNum(p.expensesAmount ?? 0) > 0)
                                .sort((a, b) => (a.dateOfPayment || a.dateLoaded || '').localeCompare(b.dateOfPayment || b.dateLoaded || ''))
                                .map((entry, idx) => {
                                  const entryId = String(entry._id || entry.id || '')
                                  const saleQty = toNum(entry.quantity)
                                  const saleRate = toNum(entry.rate)
                                  const saleVal = toNum(entry.salesValue)
                                  const depositAmt = toNum(entry.paymentAmount)
                                  const expenseAmt = toNum(entry.expensesAmount ?? 0)
                                  const isSale = saleQty > 0 && saleQty < group.quantity
                                  const isConfirmed = entry.depositStatus === 'paid'
                                  const entryDate = entry.dateOfPayment || entry.dateLoaded || ''

                                  return (
                                    <TableRow key={entryId || idx} className="hover:bg-muted/30 border-b border-border/50">
                                      <TableCell className="px-4 text-muted-foreground">{idx + 1}</TableCell>
                                      <TableCell className="text-muted-foreground whitespace-nowrap font-normal">
                                        {entryDate ? (() => { try { return format(parseISO(entryDate), 'dd MMM yy') } catch { return entryDate } })() : '—'}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold text-foreground tabular-nums">{isSale ? `${fmtQty(saleQty)} L` : '—'}</TableCell>
                                      <TableCell className="text-right text-muted-foreground tabular-nums">{isSale ? `₦${saleRate.toLocaleString()}` : '—'}</TableCell>
                                      <TableCell className="text-right text-foreground font-normal tabular-nums">{isSale ? fmt(saleVal) : '—'}</TableCell>
                                      <TableCell className="text-right font-semibold text-accent tabular-nums">{depositAmt > 0 ? fmt(depositAmt) : '—'}</TableCell>
                                      <TableCell className="text-muted-foreground">{entry.payerName || '—'}</TableCell>
                                      <TableCell className="text-muted-foreground">{entry.bank ? entry.bank.split(' · ')[1] || entry.bank : '—'}</TableCell>
                                      <TableCell>
                                        {depositAmt > 0 ? (
                                          <button
                                            type="button"
                                            disabled={updatingStatusId === entryId}
                                            onClick={() => handleToggleDepositStatus(entry)}
                                            title="Click to toggle status (Confirmed / Pending)"
                                            className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold border transition-all cursor-pointer hover:opacity-80 duration-250 ease-luxe', isConfirmed ? 'bg-accent/10 text-accent border-accent/40' : 'bg-warning/10 text-warning border-warning/40')}
 >
                                            {updatingStatusId === entryId && <Loader2 className="size-2.5 animate-spin" />}
                                            {isConfirmed ? 'Confirmed' : 'Pending'}
                                          </button>
                                        ) : '—'}
                                      </TableCell>
                                      <TableCell className="text-right text-warning tabular-nums">{expenseAmt > 0 ? fmt(expenseAmt) : '—'}</TableCell>
                                      <TableCell className="text-right px-4 tabular-nums">
                                        <div className="flex items-center justify-end gap-1">
                                          <button
                                            type="button"
                                            title="Edit Entry"
                                            onClick={() => openEditDialog(entry, group)}
                                            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors duration-250 ease-luxe"
 >
                                            <Pencil className="size-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            title="Delete Entry"
                                            onClick={() => setDeleteTarget({
                                              ids: [entryId],
                                              mode: 'entry',
                                              label: `Entry on ${entryDate || 'selected date'}`,
                                            })}
                                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors duration-250 ease-luxe"
 >
                                            <Trash2 className="size-3.5" />
                                          </button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Totals Bar */}
            <div className="bg-foreground text-background rounded-xl px-5 sm:px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs uppercase text-background/60 font-semibold">
                  Totals across {filteredLedgerGroups.length} allocation{filteredLedgerGroups.length === 1 ? '' : 's'}
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Allocated</span>
                    <span className="font-semibold">{totals.totalQtyAllocated > 0 ? `${fmtQty(totals.totalQtyAllocated)} L` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Sold</span>
                    <span className="font-semibold">{totals.totalQtySold > 0 ? `${fmtQty(totals.totalQtySold)} L` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Expected</span>
                    <span className="font-semibold">{fmt(totals.totalExpected)}</span>
                  </div>
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Deposited</span>
                    <span className="font-semibold text-accent">{fmt(totals.totalPaid)}</span>
                  </div>
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Expenses</span>
                    <span className="font-semibold text-warning">{fmt(totals.totalExpenses)}</span>
                  </div>
                  <div>
                    <span className="text-background/50 text-xs uppercase mr-1.5">Outstanding</span>
                    <span className={cn('font-semibold', totals.balance > 0 ? 'text-destructive' : 'text-accent')}>
                      {totals.balance === 0 ? '₦0.00 ✓' : totals.balance > 0 ? fmt(totals.balance) : `+${fmt(Math.abs(totals.balance))}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Record Entry Dialog */}
      <Dialog open={!!quickPaymentTarget} onOpenChange={(open) => { if (!open) setQuickPaymentTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Station Entry</DialogTitle>
            <DialogDescription>
              Record daily pump sales, bank deposits, or operating expenses for <strong>{quickPaymentTarget?.stationName}</strong> ({quickPaymentTarget?.truckNumber}).
            </DialogDescription>
          </DialogHeader>

          {/* Entry Type Tabs */}
          <div className="flex border-b border-border mb-4">
            <button
              type="button"
              onClick={() => setActiveEntryTab('sale')}
              className={cn('flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-colors cursor-pointer duration-250 ease-luxe', activeEntryTab === 'sale' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
 >
              Daily Pump Sale
            </button>
            <button
              type="button"
              onClick={() => setActiveEntryTab('deposit')}
              className={cn('flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-colors cursor-pointer duration-250 ease-luxe', activeEntryTab === 'deposit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
 >
              Bank Deposit
            </button>
            <button
              type="button"
              onClick={() => setActiveEntryTab('expense')}
              className={cn('flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-colors cursor-pointer duration-250 ease-luxe', activeEntryTab === 'expense' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
 >
              Expense
            </button>
          </div>

          <div className="space-y-3 py-1">
            {activeEntryTab === 'sale' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Volume Sold (Litres)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 5,000"
                      value={formatWithCommas(quickPaymentForm.quantity)}
                      onChange={e => setQuickPaymentForm(f => ({ ...f, quantity: stripCommas(e.target.value) }))}
 />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate (₦/Litre)</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 850"
                      value={formatWithCommas(quickPaymentForm.rate)}
                      onChange={e => setQuickPaymentForm(f => ({ ...f, rate: stripCommas(e.target.value) }))}
 />
                  </div>
                </div>
                {toNum(quickPaymentForm.quantity) > 0 && toNum(quickPaymentForm.rate) > 0 && (
                  <div className="bg-muted/40 p-2.5 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Total Sales Value:</span>
                    <span className="font-semibold text-foreground text-sm">{fmt(toNum(quickPaymentForm.quantity) * toNum(quickPaymentForm.rate))}</span>
                  </div>
                )}
              </>
            )}

            {activeEntryTab === 'deposit' && (
              <>
                <DepositChannelPicker
                  value={quickPaymentForm.deposit_channel}
                  onChange={c => setQuickPaymentForm(f => ({ ...f, deposit_channel: c }))}
                />

                <BankChargesPanel
                  totals={quickPaymentChannelTotals}
                  pending={toNum(quickPaymentForm.payment_amount) || 0}
                  pendingChannel={quickPaymentForm.deposit_channel}
                />

                <RemittanceAmountField
                  channel={quickPaymentForm.deposit_channel}
                  value={formatWithCommas(quickPaymentForm.payment_amount)}
                  onChange={v => setQuickPaymentForm(f => ({ ...f, payment_amount: stripCommas(v) }))}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Depositor Name</Label>
                    <Input
                      placeholder="Payer / Station Manager"
                      value={quickPaymentForm.payer_name}
                      onChange={e => setQuickPaymentForm(f => ({ ...f, payer_name: e.target.value }))}
 />
                  </div>
                  <BankAccountSelect
                    value={quickPaymentForm.bank_account_id}
                    onChange={id => setQuickPaymentForm(f => ({ ...f, bank_account_id: id }))}
                  />
                </div>
              </>
            )}

            {activeEntryTab === 'expense' && (
              <div className="space-y-1">
                <Label className="text-xs">Expense Amount (₦)</Label>
                <Input
                  type="text"
                  placeholder="e.g. 45,000"
                  value={formatWithCommas(quickPaymentForm.payment_amount)}
                  onChange={e => setQuickPaymentForm(f => ({ ...f, payment_amount: stripCommas(e.target.value) }))}
 />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={quickPaymentForm.date_of_payment}
                  onChange={e => setQuickPaymentForm(f => ({ ...f, date_of_payment: e.target.value }))}
 />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Remarks / Notes</Label>
                <Input
                  placeholder="Optional notes…"
                  value={quickPaymentForm.remarks}
                  onChange={e => setQuickPaymentForm(f => ({ ...f, remarks: e.target.value }))}
 />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setQuickPaymentTarget(null)} disabled={quickPaymentSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveQuickPayment} disabled={quickPaymentSaving}>
              {quickPaymentSaving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null} Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Entry Dialog */}
      {editTarget && editForm && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Ledger Entry</DialogTitle>
              <DialogDescription>
                Modify entry details for <strong>{editTarget.group.stationName}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={editForm.date_of_payment}
                    onChange={e => setEditForm(f => f ? ({ ...f, date_of_payment: e.target.value }) : null)}
 />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Volume (L)</Label>
                  <Input
                    type="text"
                    value={formatWithCommas(editForm.quantity)}
                    onChange={e => setEditForm(f => f ? ({ ...f, quantity: stripCommas(e.target.value) }) : null)}
 />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Rate (₦/L)</Label>
                  <Input
                    type="text"
                    value={formatWithCommas(editForm.rate)}
                    onChange={e => setEditForm(f => f ? ({ ...f, rate: stripCommas(e.target.value) }) : null)}
 />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Deposited (₦)</Label>
                  <Input
                    type="text"
                    value={formatWithCommas(editForm.payment_amount)}
                    onChange={e => setEditForm(f => f ? ({ ...f, payment_amount: stripCommas(e.target.value) }) : null)}
 />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Expenses (₦)</Label>
                  <Input
                    type="text"
                    value={formatWithCommas(editForm.expenses_amount)}
                    onChange={e => setEditForm(f => f ? ({ ...f, expenses_amount: stripCommas(e.target.value) }) : null)}
 />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Depositor Payer</Label>
                  <Input
                    value={editForm.payer_name}
                    onChange={e => setEditForm(f => f ? ({ ...f, payer_name: e.target.value }) : null)}
 />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Remarks</Label>
                <Input
                  value={editForm.remarks}
                  onChange={e => setEditForm(f => f ? ({ ...f, remarks: e.target.value }) : null)}
 />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null} Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Allocation Code Dialog */}
      {codeEditTarget && (
        <Dialog open onOpenChange={(open) => { if (!open) setCodeEditTarget(null) }}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>Allocation Code</DialogTitle>
              <DialogDescription>Assign or update code for {codeEditTarget.truckNumber}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label className="text-xs">Code String</Label>
              <Input
                placeholder="e.g. ALLOC-001"
                value={codeInputValue}
                onChange={e => setCodeInputValue(e.target.value)}
 />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCodeEditTarget(null)} disabled={codeSaving}>Cancel</Button>
              <Button onClick={handleSaveAllocationCode} disabled={codeSaving}>
                {codeSaving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null} Save Code
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <Trash2 className="size-6" />
              <h3 className="font-semibold text-lg text-foreground">Confirm Delete</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deleteTarget.label}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
