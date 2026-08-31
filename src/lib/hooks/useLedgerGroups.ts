import { useMemo, useCallback } from 'react'
import type { DeliverySale, DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import type { LedgerGroup } from '#/components/sales-ledger/SalesLedgerDialogs'
import { toNum, isFillingStation, getCycleKey, normalizeText, normalizePlate, idKey, entityId } from '#/lib/sales-ledger-utils'
import { buildLoadSplit } from '#/lib/load-split'

interface UseLedgerGroupsParams {
  allSales: DeliverySale[]
  allLoadings: DeliveryInventory[]
  customerMap: Map<string, DeliveryCustomer>
  pfiMap: Map<string, any>
}

export function useLedgerGroups({ allSales, allLoadings, customerMap, pfiMap }: UseLedgerGroupsParams) {
  const getPfiNumber = useCallback((loading: DeliveryInventory): string => {
    const direct = String(loading.pfiNumber || '').trim()
    if (direct) return direct
    if (loading.pfiId) {
      const pfi = pfiMap.get(idKey(loading.pfiId))
      return pfi?.pfiNumber || ''
    }
    return ''
  }, [pfiMap])

  const ledgerGroups = useMemo((): LedgerGroup[] => {
    const groups: LedgerGroup[] = []
    const matchedSaleIds = new Set<string>()
    const salesByCycle = new Map<string, DeliverySale[]>()
    const salesByTruck = new Map<string, DeliverySale[]>()

    allSales.forEach(sale => {
      const cycleKey = getCycleKey(sale.truckNumber, sale.dateLoaded)
      const existing = salesByCycle.get(cycleKey) ?? []
      existing.push(sale)
      salesByCycle.set(cycleKey, existing)
      const truckKey = normalizePlate(sale.truckNumber)
      const byTruck = salesByTruck.get(truckKey) ?? []
      byTruck.push(sale)
      salesByTruck.set(truckKey, byTruck)
    })

    const sortPayments = (payments: DeliverySale[]) => [...payments].sort((a, b) => {
      const dateA = String(a.dateOfPayment || a.createdAt || a.dateLoaded || '')
      const dateB = String(b.dateOfPayment || b.createdAt || b.dateLoaded || '')
      const idA = entityId(a)
      const idB = entityId(b)
      return dateA.localeCompare(dateB) || idA.localeCompare(idB)
    })

    const filteredLoadings = allLoadings.filter(l => !!(l.truckId || l.truckNumber || l.loadingStatus))
    const sortedLoadings = [
      ...filteredLoadings.filter(l => !!l.dateAllocated),
      ...filteredLoadings.filter(l => !l.dateAllocated),
    ]

    sortedLoadings.forEach(loading => {
      const loadingId = entityId(loading)
      const cycleKey = getCycleKey(loading.truckNumber || '', loading.dateAllocated || '')
      const cycleSales = salesByCycle.get(cycleKey) || []
      let payments = cycleSales.filter(s => !matchedSaleIds.has(entityId(s)))

      if (payments.length === 0 && !loading.dateAllocated) {
        const truckKey = normalizePlate(loading.truckNumber)
        const truckSales = salesByTruck.get(truckKey) || []
        payments = truckSales.filter(s => !matchedSaleIds.has(entityId(s)))
      }

      payments = sortPayments(payments)
      payments.forEach(p => matchedSaleIds.add(entityId(p)))

      const pfiNumber = getPfiNumber(loading)
      const allocationCode = loading.allocationCode || payments.map(s => s.allocationCode).find(Boolean) || ''

      /*
       * What this truck carried, and how it was divided — one shared answer,
       * so a load reads the same here as it does in Delivery Operations. The
       * ledger's own rows are the shares; `split.total` is the whole truck,
       * which every row now carries so a 30,000 L share can say what it is a
       * share of.
       */
      const split = buildLoadSplit(loading, payments, customerMap)
      const loadContext = {
        loadQuantity: split.total,
        loadAssigned: split.assigned,
        loadUnassigned: split.unassigned,
        shareCount: split.shares.length,
        isSplitLoad: split.isSplit,
      }

      if (split.isSplit) {
        split.shares.forEach(share => {
          const custId = share.customerId || null
          const customerObj = custId ? customerMap.get(custId) : null
          const customerPayments = share.payments
          const firstPayment = customerPayments[0]
          const salesExpected = customerPayments.reduce((mx, s) => Math.max(mx, toNum(s.salesValue)), 0)
          const rate = share.rate > 0 ? share.rate : toNum(loading.rate)
          const totalPaid = share.totalPaid
          const quantity = share.quantity
          const expected = salesExpected > 0 ? salesExpected : (rate > 0 && quantity > 0 ? rate * quantity : 0)
          groups.push({
            key: `loading:${loadingId}:${custId ?? 'none'}`,
            loadingId: Number(loadingId) || undefined,
            truckNumber: loading.truckNumber || '',
            dateLoaded: loading.dateAllocated || firstPayment?.dateLoaded || '',
            depot: loading.depot || loading.pfiLocation || firstPayment?.depotLoaded || '',
            location: isFillingStation(customerObj) ? (customerObj?.name || '') : (firstPayment?.location || (custId ? loading.location : '') || ''),
            customerId: custId,
            customerName: customerObj?.name || firstPayment?.customerName || '',
            quantity, rate, expected, totalPaid,
            balance: expected - totalPaid,
            pfiNumber, allocationCode, code: allocationCode,
            payments: customerPayments,
            isFillingStation: isFillingStation(customerObj),
            ...loadContext,
          })
        })
      } else {
        const firstPayment = payments[0]
        const customerId = idKey(loading.customerId) || idKey(firstPayment?.customerId) || null
        const customerObj = customerId ? customerMap.get(customerId) : null
        const salesExpected = payments.reduce((mx, s) => Math.max(mx, toNum(s.salesValue)), 0)
        const salesRate = payments.reduce((mx, s) => Math.max(mx, toNum(s.rate)), 0)
        const rate = salesRate > 0 ? salesRate : toNum(loading.rate)
        const totalPaid = payments.reduce((sum, s) => sum + toNum(s.paymentAmount), 0)
        // One customer takes the whole load, so the row's quantity IS the
        // load's — including where the allocation was left at zero and only
        // the ledger knows what went out.
        const quantity = split.total
        const expected = salesExpected > 0 ? salesExpected : (rate > 0 && quantity > 0 ? rate * quantity : 0)
        groups.push({
          key: `loading:${loadingId}`,
          loadingId: Number(loadingId) || undefined,
          truckNumber: loading.truckNumber || '',
          dateLoaded: loading.dateAllocated || firstPayment?.dateLoaded || '',
          depot: loading.depot || loading.pfiLocation || firstPayment?.depotLoaded || '',
          location: isFillingStation(customerObj) ? (customerObj?.name || '') : (firstPayment?.location || (customerId ? loading.location : '') || ''),
          customerId, customerName: loading.customerName || customerObj?.name || firstPayment?.customerName || '',
          quantity, rate, expected, totalPaid,
          balance: expected - totalPaid,
          pfiNumber, allocationCode, code: allocationCode,
          payments,
          isFillingStation: isFillingStation(customerObj),
          ...loadContext,
        })
      }
    })

    // Unmatched sales
    const unmatchedGroups = new Map<string, DeliverySale[]>()
    allSales.forEach(sale => {
      if (matchedSaleIds.has(entityId(sale))) return
      const key = [getCycleKey(sale.truckNumber, sale.dateLoaded), idKey(sale.customerId), normalizeText(sale.location)].join('::')
      const existing = unmatchedGroups.get(key) ?? []
      existing.push(sale)
      unmatchedGroups.set(key, existing)
    })

    unmatchedGroups.forEach((payments, key) => {
      const sorted = sortPayments(payments)
      const firstPayment = sorted[0]
      const customerObj = customerMap.get(idKey(firstPayment.customerId))
      const expected = sorted.reduce((mx, s) => Math.max(mx, toNum(s.salesValue)), 0)
      const totalPaid = sorted.reduce((sum, s) => sum + toNum(s.paymentAmount), 0)
      const allocationCode = firstPayment.allocationCode || sorted.map(s => s.allocationCode).find(Boolean) || ''
      // The largest quantity on the group, not their sum. These sales are all
      // the same cycle, customer and destination — every follow-up payment
      // carries the load's quantity again, so adding them up reported a
      // 33,000 L truck as 99,000 L once it had been paid in three parts.
      const quantity = sorted.reduce((mx, s) => Math.max(mx, toNum(s.quantity)), 0)
      groups.push({
        // No allocation behind these, so there is no load to be a share of.
        loadQuantity: quantity,
        loadAssigned: quantity,
        loadUnassigned: 0,
        shareCount: 1,
        isSplitLoad: false,
        key: `sale:${key}`,
        truckNumber: firstPayment.truckNumber,
        dateLoaded: firstPayment.dateLoaded || '',
        depot: firstPayment.depotLoaded || '',
        location: isFillingStation(customerObj) ? (customerObj?.name || '') : (firstPayment.location || ''),
        customerId: idKey(firstPayment.customerId) || null,
        customerName: firstPayment.customerName || customerObj?.name || '',
        quantity, rate: sorted.reduce((mx, s) => Math.max(mx, toNum(s.rate)), 0),
        expected, totalPaid, balance: expected - totalPaid,
        pfiNumber: '', allocationCode, code: allocationCode,
        payments: sorted,
        isFillingStation: isFillingStation(customerObj),
      })
    })

    return groups
  }, [allLoadings, allSales, customerMap, getPfiNumber])

  const cycleCustomerRateMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    allSales.forEach(s => {
      const r = toNum(s.rate)
      if (!r || !s.truckNumber || !s.customerId) return
      const cycleKey = getCycleKey(s.truckNumber, s.dateLoaded)
      if (!map.has(cycleKey)) map.set(cycleKey, new Map())
      const inner = map.get(cycleKey)!
      const cid = idKey(s.customerId)
      if (!inner.has(cid)) inner.set(cid, String(r))
    })
    return map
  }, [allSales])

  return { ledgerGroups, cycleCustomerRateMap, getPfiNumber }
}
