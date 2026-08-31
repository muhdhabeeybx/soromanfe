import { useState, useMemo, useCallback } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import { Truck, Calendar, Tag, Building2, UserPlus, Loader2, Plus, X, Fuel, CheckCircle2, ChevronRight, Users, MapPin, AlertTriangle } from 'lucide-react'
import { useDeliveryInventoryList, useUpdateDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { useDeliverySalesList, useCreateDeliverySale } from '#/lib/hooks/useDeliverySales'
import { usePfiList, type Pfi } from '#/lib/hooks/usePfis'
import { useLedgerGroups } from '#/lib/hooks/useLedgerGroups'
import { useToast } from '#/lib/hooks/useToast'
import type { DeliveryInventory, DeliveryCustomer, DeliverySale } from '#/lib/types'
import type { LedgerGroup } from '#/components/sales-ledger/SalesLedgerDialogs'
import { toNum, formatWithCommas, stripCommas, isFillingStation, safeFormatDate, normalizeCycleDate, normalizePlate, idKey, entityId } from '#/lib/sales-ledger-utils'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/sales-ledger/assign-customer')({
  beforeLoad: () => routeGuard('/sales-ledger'),
  validateSearch: (search: Record<string, unknown>): {
    loadingId?: string
    truckNumber?: string
    dateLoaded?: string
    depot?: string
    code?: string
  } => ({
    loadingId: (search.loadingId as string) || undefined,
    truckNumber: (search.truckNumber as string) || undefined,
    dateLoaded: (search.dateLoaded as string) || undefined,
    depot: (search.depot as string) || undefined,
    code: (search.code as string) || undefined,
  }),
  component: AssignCustomerPage,
})

interface SaleRow {
  uid: string
  customer: string
  customer_name: string
  location: string
  quantity: string
  phone_number: string
  remarks: string
}

const makeSaleRow = (): SaleRow => ({
  uid: crypto.randomUUID(),
  customer: '',
  customer_name: '',
  location: '',
  quantity: '',
  phone_number: '',
  remarks: '',
})

interface ExistingAssignment {
  customerId: string
  customerName: string
  location: string
  quantity: number
  isFillingStation: boolean
  paymentCount: number
  totalPaid: number
}

function AssignCustomerPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const searchParams = useSearch({ from: '/sales-ledger/assign-customer' })

  const { data: rawInventory = [], isLoading: inventoryLoading } = useDeliveryInventoryList()
  const { data: rawCustomers, isLoading: customersLoading } = useDeliveryCustomerList()
  const { data: rawSales = [], isLoading: salesLoading } = useDeliverySalesList()
  const { data: rawPfis } = usePfiList()

  const createSale = useCreateDeliverySale()
  const updateInventory = useUpdateDeliveryInventory()

  const allLoadings: DeliveryInventory[] = useMemo(() =>
    Array.isArray(rawInventory) ? rawInventory : [], [rawInventory])

  const allSales: DeliverySale[] = useMemo(() =>
    Array.isArray(rawSales) ? rawSales : [], [rawSales])

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

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    pfis.forEach(p => m.set(idKey(p._id), p))
    return m
  }, [pfis])

  const customerMap = useMemo(() => {
    const m = new Map<string, DeliveryCustomer>()
    customers.forEach(c => {
      if (c._id != null) m.set(idKey(c._id), c)
      if (c.id != null) m.set(idKey(c.id), c)
    })
    return m
  }, [customers])

  const customerByNameMap = useMemo(() => {
    const m = new Map<string, DeliveryCustomer>()
    customers.forEach(c => {
      if (c.name) m.set(c.name.trim().toLowerCase(), c)
    })
    return m
  }, [customers])

  const { ledgerGroups } = useLedgerGroups({
    allSales,
    allLoadings,
    customerMap,
    pfiMap,
  })

  const selectedLoading = useMemo(() => {
    if (searchParams.loadingId) {
      const found = allLoadings.find(l => entityId(l) === idKey(searchParams.loadingId))
      if (found) return found
    }
    if (searchParams.truckNumber) {
      const normalizedTruck = normalizePlate(searchParams.truckNumber)
      const matches = allLoadings.filter(l => normalizePlate(l.truckNumber) === normalizedTruck)
      if (searchParams.dateLoaded) {
        const dateMatch = matches.find(l => (l.dateAllocated || '').split('T')[0] === searchParams.dateLoaded?.split('T')[0])
        if (dateMatch) return dateMatch
      }
      if (matches.length > 0) return matches[0]
    }
    return null
  }, [allLoadings, searchParams])

  const truckNumber = searchParams.truckNumber || selectedLoading?.truckNumber || ''
  const dateLoaded = searchParams.dateLoaded || selectedLoading?.dateAllocated || ''
  const depot = searchParams.depot || selectedLoading?.depot || selectedLoading?.pfiLocation || selectedLoading?.location || ''
  const code = searchParams.code || selectedLoading?.allocationCode || ''

  // ── Compute existing assignments for this truck cycle ──────────────────
  const targetCycleGroups = useMemo((): LedgerGroup[] => {
    if (!ledgerGroups.length) return []
    const { loadingId, truckNumber: paramTruck, dateLoaded: paramDate, code: paramCode } = searchParams

    if (loadingId || selectedLoading) {
      const targetId = idKey(loadingId) || entityId(selectedLoading)
      if (targetId) {
        const matches = ledgerGroups.filter(g => idKey(g.loadingId) === targetId)
        if (matches.length > 0) return matches
      }
    }

    const targetTruck = normalizePlate(paramTruck || selectedLoading?.truckNumber)
    if (!targetTruck) return []

    return ledgerGroups.filter(g => {
      const gTruck = normalizePlate(g.truckNumber)
      if (gTruck !== targetTruck) return false

      const targetDate = paramDate || selectedLoading?.dateAllocated
      if (targetDate) {
        if (normalizeCycleDate(g.dateLoaded) !== normalizeCycleDate(targetDate)) return false
      }

      const targetCode = (paramCode || selectedLoading?.allocationCode || '').trim().toUpperCase()
      if (targetCode && g.code) {
        if (g.code.trim().toUpperCase() !== targetCode) return false
      }

      return true
    })
  }, [ledgerGroups, searchParams, selectedLoading])

  const existingAssignments = useMemo((): ExistingAssignment[] => {
    const list: ExistingAssignment[] = []
    const seenCustomers = new Set<string>()

    targetCycleGroups.forEach(g => {
      const name = g.customerName || ''
      const rawCid = idKey(g.customerId)
      const customerObj = (rawCid ? customerMap.get(rawCid) : null) || (name ? customerByNameMap.get(name.trim().toLowerCase()) : null)
      const resolvedCid = rawCid || entityId(customerObj)

      if (!name && !resolvedCid) return

      const dedupKey = resolvedCid || name.trim().toLowerCase()
      if (seenCustomers.has(dedupKey)) return
      seenCustomers.add(dedupKey)

      const isFS = g.isFillingStation || isFillingStation(customerObj)
      const location = isFS ? (name || customerObj?.name || g.location || '') : (g.location || name || '')

      list.push({
        customerId: resolvedCid,
        customerName: name || customerObj?.name || 'Assigned Customer',
        location,
        quantity: Math.max(0, toNum(g.quantity)),
        isFillingStation: isFS,
        paymentCount: g.payments?.length || 0,
        totalPaid: toNum(g.totalPaid),
      })
    })

    return list
  }, [targetCycleGroups, customerMap, customerByNameMap])

  // ── Capacity calculations ─────────────────────────────────────────────
  const totalTruckCapacity = useMemo(() => {
    // The whole load as the ledger already resolves it, which is the stored
    // allocation except where that was overwritten with one customer's share —
    // taking the stored figure alone reported a 45,000 L truck with 45,000 L
    // already assigned as a 30,000 L truck with nothing left to give.
    const fromGroups = targetCycleGroups.reduce((mx, g) => Math.max(mx, toNum(g.loadQuantity)), 0)
    if (fromGroups > 0) return fromGroups
    const direct = toNum(selectedLoading?.quantityAllocated)
    if (direct > 0) return direct
    return targetCycleGroups.reduce((mx, g) => Math.max(mx, toNum(g.quantity)), 0)
  }, [selectedLoading, targetCycleGroups])

  const alreadyAllocatedQty = useMemo(() =>
    existingAssignments.reduce((sum, a) => sum + a.quantity, 0),
    [existingAssignments]
  )

  const remainingCapacity = Math.max(0, totalTruckCapacity - alreadyAllocatedQty)

  // IDs of already-assigned customers (to exclude from dropdown)
  const assignedCustomerIds = useMemo(() =>
    new Set(existingAssignments.map(a => a.customerId)),
    [existingAssignments]
  )

  // ── Form state ────────────────────────────────────────────────────────
  const [saleRows, setSaleRows] = useState<SaleRow[]>(() => {
    // Start with an empty row — don't pre-fill from inventory since that customer is already tracked
    return [makeSaleRow()]
  })

  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof SaleRow, string>>>>({})
  const [saving, setSaving] = useState(false)

  const updateSaleRow = useCallback((uid: string, field: keyof Omit<SaleRow, 'uid'>, value: string) => {
    if (rowErrors[uid]?.[field]) {
      setRowErrors(prev => {
        const next = { ...prev }
        if (next[uid]) { next[uid] = { ...next[uid] }; delete next[uid][field] }
        return next
      })
    }
    setSaleRows(prev => prev.map(row => {
      if (row.uid !== uid) return row
      const updated = {
        ...row,
        [field]: field === 'quantity' ? formatWithCommas(value) : value,
      }
      if (field === 'customer') {
        const selectedCustomer = value ? customerMap.get(value) : null
        if (selectedCustomer) {
          updated.customer_name = selectedCustomer.name
          if (isFillingStation(selectedCustomer)) {
            const phone = (selectedCustomer as any).contactPersonPhone || (selectedCustomer as any).phoneNumber || (selectedCustomer as any).phone
            if (phone) updated.phone_number = phone
            updated.location = selectedCustomer.name
          }
        }
      }
      return updated
    }))
  }, [rowErrors, customerMap])

  const addSaleRow = () => setSaleRows(prev => [...prev, makeSaleRow()])
  const removeSaleRow = (uid: string) => setSaleRows(prev => prev.length > 1 ? prev.filter(r => r.uid !== uid) : prev)

  // ── Available customers (exclude already assigned) ─────────────────────
  const availableCustomers = useMemo(() => {
    // Also exclude customers already selected in other form rows
    const selectedInForm = new Set(saleRows.filter(r => r.customer).map(r => r.customer))
    // entityId, not the raw id: the assigned set holds strings, so a number
    // key matched nothing there and a customer already on this cycle was
    // offered again as if free.
    return customers.filter(c => {
      const id = entityId(c)
      return !assignedCustomerIds.has(id) || selectedInForm.has(id)
    })
  }, [customers, assignedCustomerIds, saleRows])

  // ── Save handler ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!truckNumber.trim()) {
      toast.error('Truck information missing')
      return
    }

    const filledRows = saleRows.filter(r => r.customer || r.location || r.quantity)
    if (filledRows.length === 0) {
      toast.error('Please select at least one customer')
      return
    }

    const newAllocatedQty = filledRows.reduce((sum, row) => sum + (Number(stripCommas(row.quantity)) || 0), 0)

    const errors: Record<string, Partial<Record<keyof SaleRow, string>>> = {}
    filledRows.forEach(row => {
      const e: Partial<Record<keyof SaleRow, string>> = {}
      if (!row.customer) e.customer = 'Customer is required'
      if (!row.location.trim()) e.location = 'Destination is required'
      const rowQty = Number(stripCommas(row.quantity)) || 0
      if (!rowQty || rowQty <= 0) e.quantity = 'Quantity is required'
      if (Object.keys(e).length) errors[row.uid] = e
    })

    // Validate against REMAINING capacity, not total
    if (remainingCapacity > 0 && newAllocatedQty > remainingCapacity) {
      toast.error(
        `New allocation (${newAllocatedQty.toLocaleString()} L) exceeds remaining capacity (${remainingCapacity.toLocaleString()} L). ` +
        `Already assigned: ${alreadyAllocatedQty.toLocaleString()} L of ${totalTruckCapacity.toLocaleString()} L.`
      )
      return
    }

    if (Object.keys(errors).length) {
      setRowErrors(errors)
      toast.error('Please fix the highlighted fields')
      return
    }

    setRowErrors({})
    setSaving(true)

    try {
      const currentUser = localStorage.getItem('fullname') || 'Unknown'

      const promises = filledRows.map(row => {
        return createSale.mutateAsync({
          truckNumber: truckNumber.trim(),
          dateLoaded: dateLoaded || new Date().toISOString().split('T')[0],
          depotLoaded: depot.trim() || undefined,
          customerId: row.customer || undefined,
          customerName: row.customer_name || undefined,
          allocationCode: code || undefined,
          location: row.location.trim() || undefined,
          quantity: Number(stripCommas(row.quantity)) || undefined,
          phoneNumber: row.phone_number.trim() || undefined,
          remarks: row.remarks.trim() || undefined,
          enteredBy: currentUser,
        } as Partial<DeliverySale>)
      })

      await Promise.all(promises)

      const loadingId = idKey(searchParams.loadingId) || entityId(selectedLoading)
      if (loadingId) {
        try {
          const firstRow = filledRows[0]
          const custName = firstRow.customer ? (customerMap.get(firstRow.customer)?.name || firstRow.customer_name) : ''
          await updateInventory.mutateAsync({
            id: loadingId,
            data: {
              ...(firstRow.customer ? { customerId: firstRow.customer, customerName: custName } : {}),
              ...(firstRow.location.trim() ? { location: firstRow.location.trim() } : {}),
            },
          })
        } catch {
          /* non-critical */
        }
      }

      toast.success(`${filledRows.length} customer${filledRows.length > 1 ? 's' : ''} assigned to truck ${truckNumber}`)

      navigate({
        to: '/sales-ledger/details',
        search: {
          loadingId: searchParams.loadingId,
          truckNumber: searchParams.truckNumber,
          dateLoaded: searchParams.dateLoaded,
          code: searchParams.code,
        },
      })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign customer')
    } finally {
      setSaving(false)
    }
  }, [truckNumber, dateLoaded, depot, code, saleRows, searchParams, selectedLoading, customerMap, createSale, updateInventory, toast, navigate, remainingCapacity, alreadyAllocatedQty, totalTruckCapacity])

  const goBack = () => {
    navigate({
      to: '/sales-ledger/details',
      search: {
        loadingId: searchParams.loadingId,
        truckNumber: searchParams.truckNumber,
        dateLoaded: searchParams.dateLoaded,
        code: searchParams.code,
      },
    })
  }

  // ── New entries quantity for capacity bar ──────────────────────────────
  const newEntriesQty = saleRows.reduce((sum, row) => sum + (Number(stripCommas(row.quantity)) || 0), 0)
  const combinedTotal = alreadyAllocatedQty + newEntriesQty
  const combinedPct = totalTruckCapacity > 0 ? Math.round((combinedTotal / totalTruckCapacity) * 100) : 0
  const isOverCapacity = combinedPct > 100

  if (inventoryLoading || customersLoading || salesLoading) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12">
        <Loader2 className="mx-auto size-8 animate-spin text-warning mb-3" />
        <p className="text-sm text-muted-foreground font-normal">Loading details...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <button onClick={() => navigate({ to: '/sales-ledger' })} className="text-muted-foreground hover:text-foreground font-normal transition-colors duration-250 ease-luxe">
          Sales Ledger
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <button onClick={goBack} className="text-muted-foreground hover:text-foreground font-normal transition-colors duration-250 ease-luxe">
          {truckNumber || 'Details'}
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="text-foreground font-semibold">Assign Customer</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <PageHeader
      eyebrow="Truck Sales"
      title="Assign New Customer"
      description="Link customer(s) to this truck cycle. Rates and payments can be added later."
      backAction={goBack}
    />
      </div>

      {/* Truck Context Card */}
      <Card className="bg-warning/10 border-warning/20">
        <CardHeader className="pb-3 border-b border-warning/20">
          <CardTitle className="text-sm font-semibold text-warning flex items-center gap-2">
            <Truck className="size-4 text-warning" />
            Truck Context
          </CardTitle>
          <CardDescription className="text-xs text-warning">
            This assignment is bound to the currently viewed truck cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
            <div className="p-3 bg-card rounded-xl border border-warning/20">
              <div className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                <Truck className="size-3 text-warning" /> Truck Number
              </div>
              <div className="font-semibold text-base font-mono text-foreground mt-0.5">
                {truckNumber || '—'}
              </div>
            </div>
            <div className="p-3 bg-card rounded-xl border border-warning/20">
              <div className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                <Calendar className="size-3 text-muted-foreground" /> Date Loaded
              </div>
              <div className="font-semibold text-foreground mt-0.5">
                {safeFormatDate(dateLoaded)}
              </div>
            </div>
            <div className="p-3 bg-card rounded-xl border border-warning/20">
              <div className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                <Building2 className="size-3 text-warning" /> Depot
              </div>
              <div className="font-semibold text-foreground mt-0.5">
                {depot || '—'}
              </div>
            </div>
            <div className="p-3 bg-card rounded-xl border border-warning/20">
              <div className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                <Tag className="size-3 text-muted-foreground" /> PFI Code
              </div>
              <div className="font-semibold text-foreground mt-0.5">
                {code ? (
                  <Badge variant="outline" className="font-mono text-xs uppercase bg-muted/10 text-foreground dark:text-muted-foreground border-border/20">
                    {code}
                  </Badge>
                ) : 'None'}
              </div>
            </div>
            <div className="p-3 bg-card rounded-xl border border-warning/20">
              <div className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                <Fuel className="size-3 text-accent" /> Capacity
              </div>
              <div className="font-semibold text-foreground mt-0.5">
                {totalTruckCapacity > 0 ? (
                  <>
                    {totalTruckCapacity.toLocaleString()} L
                    {alreadyAllocatedQty > 0 && (
                      <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                        {remainingCapacity.toLocaleString()} L remaining
                      </span>
                    )}
                  </>
                ) : '—'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Existing Assignments */}
      {existingAssignments.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              Already Assigned Customers ({existingAssignments.length})
            </CardTitle>
            <CardDescription className="text-xs">
              These customers are already linked to truck {truckNumber} on this cycle. They are excluded from the dropdown below.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {existingAssignments.map(a => (
                <div
                  key={a.customerId}
                  className="flex items-center justify-between p-3 bg-muted/60 rounded-xl border border-border"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {a.isFillingStation ? (
                      <div className="p-1.5 rounded-lg bg-warning/20">
                        <Fuel className="size-3.5 text-warning" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-lg bg-muted/20">
                        <Users className="size-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm truncate uppercase">{a.customerName}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {a.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="size-2.5" /> {a.location}
                          </span>
                        )}
                        {a.isFillingStation && (
                          <Badge className="text-xs bg-warning/20 text-warning border-warning/30 px-1 py-0">
                            FS
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="font-semibold text-foreground text-sm">{a.quantity > 0 ? `${a.quantity.toLocaleString()} L` : '—'}</p>
                    {a.paymentCount > 0 && (
                      <p className="text-xs text-accent font-normal">
                        {a.paymentCount} payment{a.paymentCount !== 1 ? 's' : ''} · {a.totalPaid.toLocaleString()} paid
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Summary bar */}
              <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
                <span className="text-muted-foreground font-normal">
                  Total already allocated: <strong className="text-foreground">{alreadyAllocatedQty.toLocaleString()} L</strong>
                </span>
                {totalTruckCapacity > 0 && (
                  <span className={`font-semibold ${remainingCapacity > 0 ? 'text-accent' : 'text-destructive'}`}>
                    {remainingCapacity > 0
                      ? `${remainingCapacity.toLocaleString()} L remaining`
                      : 'Fully allocated'}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No existing assignments - info banner */}
      {existingAssignments.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted border border-border rounded-xl text-xs text-foreground">
          <Users className="size-3.5 shrink-0" />
          <span>No customers are currently assigned to this truck cycle. Use the form below to assign the first customer.</span>
        </div>
      )}

      {/* Capacity fully allocated warning */}
      {remainingCapacity <= 0 && totalTruckCapacity > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/40 rounded-xl text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            <strong>Fully allocated.</strong> This truck's capacity ({totalTruckCapacity.toLocaleString()} L) is fully used by existing assignments.
            Adding more customers will exceed capacity.
          </span>
        </div>
      )}

      {/* Customer Assignment Form */}
      <Card className="bg-card border-border">
        <CardHeader className="border-b border-border pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <UserPlus className="size-4 text-muted-foreground" />
              New Customer Assignment ({saleRows.length})
            </CardTitle>
            <CardDescription className="text-xs">
              {existingAssignments.length > 0
                ? `Add more customers to truck ${truckNumber}. Already-assigned customers are excluded.`
                : `Select one or multiple customers receiving fuel from truck ${truckNumber}.`}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={addSaleRow}>
            <Plus className="size-3.5" /> Add Customer
          </Button>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {saleRows.map((row, idx) => {
            const custObj = row.customer ? customerMap.get(row.customer) : null
            const isFS = isFillingStation(custObj)
            const hasError = rowErrors[row.uid] && Object.keys(rowErrors[row.uid]).length

            return (
              <div
                key={row.uid}
                className={`border rounded-xl p-4 space-y-4 relative transition-all ${hasError ? 'border-destructive bg-destructive/10' : isFS ? 'border-warning/30 bg-warning/10' : 'border-border bg-muted/40'
 }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                    {isFS && <Fuel className="size-3.5 text-warning" />}
                    Customer #{idx + 1}
                    {isFS && (
                      <Badge className="ml-1 text-xs font-semibold bg-warning/20 text-warning border-warning/30 px-1.5 py-0 normal-case tracking-normal">
                        Filling Station
                      </Badge>
                    )}
                  </span>
                  {saleRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSaleRow(row.uid)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded-md duration-250 ease-luxe"
                      title="Remove customer row"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Select Customer <span className="text-destructive">*</span>
                    </Label>
                    <select
                      aria-label={`Customer for row ${idx + 1}`}
                      value={row.customer}
                      onChange={e => updateSaleRow(row.uid, 'customer', e.target.value)}
                      className={`h-10 w-full rounded-lg border bg-background text-foreground px-3 py-2 text-sm font-normal transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${rowErrors[row.uid]?.customer ? 'border-destructive' : 'border-input'
 }`}
                    >
                      <option value="">Select customer...</option>
                      {availableCustomers.map(c => {
                        const cid = entityId(c)
                        const isAssigned = assignedCustomerIds.has(cid)
                        return (
                          <option key={cid} value={cid}>
                            {c.name} {c.customerType === 'filling_station' ? '(FS)' : ''}{isAssigned ? ' (already assigned)' : ''}
                          </option>
                        )
                      })}
                    </select>
                    {rowErrors[row.uid]?.customer && (
                      <p className="text-xs text-destructive font-normal">{rowErrors[row.uid].customer}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Destination <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      placeholder="e.g. Kano, Abuja, Station Name..."
                      className={`h-10 text-sm ${rowErrors[row.uid]?.location ? 'border-destructive' : ''}`}
                      value={row.location}
                      onChange={e => updateSaleRow(row.uid, 'location', e.target.value)}
                    />
                    {rowErrors[row.uid]?.location && (
                      <p className="text-xs text-destructive font-normal">{rowErrors[row.uid].location}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Quantity (Litres) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder={remainingCapacity > 0 ? `max ${remainingCapacity.toLocaleString()}` : 'e.g. 33,000'}
                      className={`h-10 text-sm font-normal ${rowErrors[row.uid]?.quantity ? 'border-destructive' : ''}`}
                      value={row.quantity}
                      onChange={e => updateSaleRow(row.uid, 'quantity', e.target.value)}
                    />
                    {rowErrors[row.uid]?.quantity && (
                      <p className="text-xs text-destructive font-normal">{rowErrors[row.uid].quantity}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Contact Phone</Label>
                    <Input
                      placeholder="e.g. 08012345678"
                      className="h-10 text-sm"
                      value={row.phone_number}
                      onChange={e => updateSaleRow(row.uid, 'phone_number', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Remarks</Label>
                    <Input
                      placeholder="e.g. Assigned to cycle..."
                      className="h-10 text-sm"
                      value={row.remarks}
                      onChange={e => updateSaleRow(row.uid, 'remarks', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )
          })}

          {/* Combined Capacity Bar (existing + new) */}
          {totalTruckCapacity > 0 && (
            <div className={`p-4 rounded-xl border ${isOverCapacity ? 'bg-destructive/10 border-destructive/30' : combinedPct > 80 ? 'bg-warning/10 border-warning/30' : 'bg-accent/10 border-accent/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Total Truck Capacity Usage</span>
                <span className={`text-xs font-semibold ${isOverCapacity ? 'text-destructive' : combinedPct > 80 ? 'text-warning' : 'text-accent'}`}>
                  {combinedTotal.toLocaleString()} / {totalTruckCapacity.toLocaleString()} L ({combinedPct}%)
                </span>
              </div>
              <div className="h-3 bg-white/60 rounded-full overflow-hidden flex">
                {/* Existing allocations segment */}
                {alreadyAllocatedQty > 0 && (
                  <div
                    className="h-full bg-muted transition-all duration-250 ease-luxe"
                    style={{ width: `${Math.min(100, Math.round((alreadyAllocatedQty / totalTruckCapacity) * 100))}%` }}
                    title={`Already assigned: ${alreadyAllocatedQty.toLocaleString()} L`}
                  />
                )}
                {/* New allocations segment */}
                {newEntriesQty > 0 && (
                  <div
                    className={`h-full transition-all ${isOverCapacity ? 'bg-destructive' : combinedPct > 80 ? 'bg-warning' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100 - Math.round((alreadyAllocatedQty / totalTruckCapacity) * 100), Math.round((newEntriesQty / totalTruckCapacity) * 100))}%` }}
                    title={`New entries: ${newEntriesQty.toLocaleString()} L`}
                  />
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs">
                {alreadyAllocatedQty > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-muted" />
                    <span className="text-muted-foreground">Already assigned: <strong className="text-foreground">{alreadyAllocatedQty.toLocaleString()} L</strong></span>
                  </span>
                )}
                {newEntriesQty > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${isOverCapacity ? 'bg-destructive' : 'bg-accent'}`} />
                    <span className="text-muted-foreground">New entries: <strong className="text-foreground">{newEntriesQty.toLocaleString()} L</strong></span>
                  </span>
                )}
                {remainingCapacity > 0 && newEntriesQty === 0 && (
                  <span className="text-muted-foreground">
                    {remainingCapacity.toLocaleString()} L available for new assignments
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button variant="outline" onClick={goBack} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 bg-accent hover:bg-accent/80 text-accent-foreground font-semibold"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {saving ? 'Assigning...' : `Confirm & Assign to ${truckNumber}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
