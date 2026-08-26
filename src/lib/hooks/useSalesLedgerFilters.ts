import { useState, useMemo, useCallback } from 'react'
import { parseISO } from 'date-fns'
import type { DeliverySale, DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import type { LedgerGroup } from '#/components/sales-ledger/SalesLedgerDialogs'
import { matchesDateRange, getPresetRange, type TimePreset, isFillingStation, idKey, entityId } from '#/lib/sales-ledger-utils'

interface UseSalesLedgerFiltersParams {
  ledgerGroups: LedgerGroup[]
  allSales: DeliverySale[]
  allLoadings: DeliveryInventory[]
  customers: DeliveryCustomer[]
  customerMap: Map<string, DeliveryCustomer>
  tripCodes: string[]
  saleTripMap: Record<string, string>
}

export function useSalesLedgerFilters({
  ledgerGroups, allSales, allLoadings, customers, customerMap, tripCodes, saleTripMap,
}: UseSalesLedgerFiltersParams) {
  const [timePreset, setTimePreset] = useState<TimePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<'ledger' | 'daily'>('ledger')
  const [truckFilter, setTruckFilter] = useState('all')
  const [customerFilter, setCustomerFilter] = useState('all')
  /**
   * Normal customers by default.
   *
   * Filling stations are the company's own outlets and behave nothing like a
   * delivery customer — they remit takings rather than settle an invoice, and
   * they have their own page for it. Mixed into the default view they were
   * most of the rows and none of the work, so the ledger opened on a list
   * that had to be narrowed before it could be read.
   */
  const [customerTypeFilter, setCustomerTypeFilter] = useState<'all' | 'filling_station' | 'normal'>('normal')
  const [tripCodeFilter, setTripCodeFilter] = useState('all')

  const dateRange = useMemo(() => {
    if (timePreset === 'custom') {
      return { from: customFrom ? parseISO(customFrom) : null, to: customTo ? parseISO(customTo) : null }
    }
    return getPresetRange(timePreset)
  }, [timePreset, customFrom, customTo])

  const handlePresetChange = useCallback((preset: TimePreset) => {
    setTimePreset(preset)
    if (preset !== 'custom') { setCustomFrom(''); setCustomTo('') }
  }, [])

  const clearAllFilters = useCallback(() => {
    setTruckFilter('all')
    setCustomerFilter('all')
    // Back to the default view, not to everything — clearing filters should
    // return the page to how it opens.
    setCustomerTypeFilter('normal')
    setTripCodeFilter('all')
    setSearchQuery('')
    setTimePreset('all')
    setCustomFrom('')
    setCustomTo('')
  }, [])

  // "normal" is the resting state, so it does not count as a filter in force
  // — otherwise the page would open already offering to clear itself.
  const hasActiveFilters = truckFilter !== 'all' || customerFilter !== 'all'
    || customerTypeFilter !== 'normal' || tripCodeFilter !== 'all' || searchQuery !== ''

  const filteredLedgerGroups = useMemo(() => {
    let result = [...ledgerGroups]
    result = result.filter(g =>
      matchesDateRange(g.dateLoaded, dateRange.from, dateRange.to)
      || g.payments.some(p => matchesDateRange(p.dateOfPayment || p.createdAt || p.dateLoaded, dateRange.from, dateRange.to))
    )
    if (truckFilter !== 'all') result = result.filter(g => g.truckNumber === truckFilter)
    if (customerFilter !== 'all') {
      const selectedCustName = customerMap.get(customerFilter)?.name
      result = result.filter(g => idKey(g.customerId) === customerFilter || (selectedCustName && g.customerName === selectedCustName))
    }
    if (tripCodeFilter !== 'all') result = result.filter(g => g.code === tripCodeFilter)
    if (customerTypeFilter !== 'all') {
      result = result.filter(g => customerTypeFilter === 'filling_station' ? g.isFillingStation : !g.isFillingStation)
    }
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(g =>
        (g.truckNumber || '').toLowerCase().includes(q)
        || (g.depot || '').toLowerCase().includes(q)
        || (g.location || '').toLowerCase().includes(q)
        || (g.customerName || '').toLowerCase().includes(q)
        || (g.allocationCode || '').toLowerCase().includes(q)
        || (g.pfiNumber || '').toLowerCase().includes(q)
        || g.payments.some(p => (p.payerName || '').toLowerCase().includes(q) || (p.bank || '').toLowerCase().includes(q) || (p.phoneNumber || '').toLowerCase().includes(q) || (p.enteredBy || '').toLowerCase().includes(q))
      )
    }
    const codeOrder = new Map<string, number>()
    tripCodes.forEach((code, idx) => codeOrder.set(code, idx))
    return result.sort((a, b) => {
      const aRank = a.code ? (codeOrder.get(a.code) ?? 10_000) : 99_999
      const bRank = b.code ? (codeOrder.get(b.code) ?? 10_000) : 99_999
      if (aRank !== bRank) return aRank - bRank
      const codeDiff = (a.code || '').localeCompare(b.code || '')
      if (codeDiff !== 0) return codeDiff
      return (a.truckNumber || '').localeCompare(b.truckNumber || '')
    })
  }, [ledgerGroups, dateRange, truckFilter, customerFilter, tripCodeFilter, customerTypeFilter, searchQuery, tripCodes, customerMap])

  const filteredSales = useMemo(() => {
    let result = allSales.filter(s => {
      const dateField = s.dateOfPayment || s.dateLoaded
      return matchesDateRange(dateField, dateRange.from, dateRange.to)
    })
    if (truckFilter !== 'all') result = result.filter(s => s.truckNumber === truckFilter)
    if (customerFilter !== 'all') result = result.filter(s => idKey(s.customerId) === customerFilter)
    if (tripCodeFilter !== 'all') result = result.filter(s => (s.allocationCode || saleTripMap[entityId(s)] || '') === tripCodeFilter)
    if (customerTypeFilter !== 'all') {
      result = result.filter(s => {
        const isFS = isFillingStation(customerMap.get(idKey(s.customerId)))
        return customerTypeFilter === 'filling_station' ? isFS : !isFS
      })
    }
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(s =>
        (s.truckNumber || '').toLowerCase().includes(q)
        || (s.customerName || customerMap.get(idKey(s.customerId))?.name || '').toLowerCase().includes(q)
        || (s.payerName || '').toLowerCase().includes(q)
        || (s.location || '').toLowerCase().includes(q)
      )
    }
    return result.sort((a, b) => (b.dateOfPayment || b.dateLoaded || '').localeCompare(a.dateOfPayment || a.dateLoaded || ''))
  }, [allSales, dateRange, truckFilter, customerFilter, tripCodeFilter, customerTypeFilter, searchQuery, customerMap, saleTripMap])

  const uniqueTruckNumbers = useMemo(() => {
    const set = new Set<string>()
    ledgerGroups.forEach(g => { if (g.truckNumber) set.add(g.truckNumber) })
    allSales.forEach(s => { if (s.truckNumber) set.add(s.truckNumber) })
    allLoadings.forEach(l => { if (l.truckNumber) set.add(l.truckNumber) })
    return Array.from(set).filter(Boolean).sort()
  }, [ledgerGroups, allSales, allLoadings])

  const uniqueCustomerOptions = useMemo(() => {
    const map = new Map<string, string>()
    ledgerGroups.forEach(g => {
      if (g.customerId && g.customerName) map.set(idKey(g.customerId), g.customerName)
    })
    allSales.forEach(s => {
      const cid = idKey(s.customerId)
      const name = s.customerName || customerMap.get(cid)?.name || ''
      if (cid && name) map.set(cid, name)
    })
    allLoadings.forEach(l => {
      const cid = idKey(l.customerId)
      const name = l.customerName || customerMap.get(cid)?.name || ''
      if (cid && name) map.set(cid, name)
    })
    // entityId, not the raw id: a number key never collided with the string
    // keys set above, so every customer already named by a ledger row was
    // listed a second time and the duplicate matched no rows when picked.
    customers.forEach(c => {
      const id = entityId(c)
      if (id && c.name && !map.has(id)) map.set(id, c.name)
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [ledgerGroups, allSales, allLoadings, customers, customerMap])

  const periodLabel = timePreset === 'custom'
    ? `${customFrom || '?'} – ${customTo || '?'}`
    : timePreset === 'all' ? 'All Time' : timePreset.charAt(0).toUpperCase() + timePreset.slice(1)

  return {
    timePreset, setTimePreset, customFrom, setCustomFrom, customTo, setCustomTo,
    searchQuery, setSearchQuery, activeView, setActiveView,
    truckFilter, setTruckFilter, customerFilter, setCustomerFilter,
    customerTypeFilter, setCustomerTypeFilter, tripCodeFilter, setTripCodeFilter,
    dateRange, handlePresetChange, clearAllFilters, hasActiveFilters,
    filteredLedgerGroups, filteredSales,
    uniqueTruckNumbers, uniqueCustomerOptions, periodLabel,
  }
}
