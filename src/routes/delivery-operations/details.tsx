import { useState, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Button } from '#/components/ui/button'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '#/components/ui/table'
import {
  ArrowLeft, Truck, Package, MapPin, Calendar, CheckCircle2,
  Trash2, Loader2, ShieldAlert, FileText, Building2, DollarSign,
  User, Users, Tag,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useDeliveryInventoryList, useDeleteDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useDeliverySalesList } from '#/lib/hooks/useDeliverySales'
import { useDeliveryCustomerList } from '#/lib/hooks/useDeliveryCustomers'
import { usePfiList } from '#/lib/hooks/usePfis'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { useToast } from '#/lib/hooks/useToast'
import type { DeliveryInventory, DeliverySale, DeliveryCustomer } from '#/lib/types'
import type { Pfi } from '#/lib/hooks/usePfis'
import { routeGuard } from '#/lib/route-guard'
import { salesForLoading, rateFromSales } from '#/lib/sales-ledger-utils'
import { buildTruckIndex, resolveLoading } from '#/lib/delivery-records'
import { buildLoadSplit } from '#/lib/load-split'
import { SplitBadge, SplitSummaryCard } from '#/components/LoadSplit'

export const Route = createFileRoute('/delivery-operations/details')({
  beforeLoad: () => routeGuard('/delivery-operations'),
  validateSearch: (search: Record<string, unknown>) => ({
    inventoryId: (search.inventoryId as string) || '',
  }),
  component: DeliveryOperationDetailsView,
})

const toNum = (v: string | number | undefined | null): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const fmtMoney = (n: number) => `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Icon per status; the labels and colours come from STATUS_DISPLAY. */
const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  loaded: Truck,
  offloaded: CheckCircle2,
  empty: Package,
  unknown: Package,
}

function DeliveryOperationDetailsView() {
  const navigate = useNavigate()
  const routerState = useRouterState()
  const searchParams = Route.useSearch()
  const state = (routerState.location.state || {}) as { inventoryItem?: DeliveryInventory }
  const toast = useToast()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const deleteMutation = useDeleteDeliveryInventory()

  const { data: rawInventory = [], isLoading } = useDeliveryInventoryList()
  const { data: allSales = [] } = useDeliverySalesList()
  const { data: pfisData } = usePfiList()
  const { data: trucksData } = useAllocatableTrucks()
  const { data: customersData = [] } = useDeliveryCustomerList()

  const allEntries = useMemo((): DeliveryInventory[] => {
    if (!rawInventory) return []
    return Array.isArray(rawInventory) ? rawInventory : []
  }, [rawInventory])

  const allCustomers: DeliveryCustomer[] = useMemo(() => {
    if (!customersData) return []
    return Array.isArray(customersData) ? customersData : (customersData.customers || [])
  }, [customersData])

  const allPfis: Pfi[] = useMemo(() => {
    if (!pfisData) return []
    return Array.isArray(pfisData) ? pfisData : (pfisData.pfis || [])
  }, [pfisData])

  const allTrucks = useMemo(() => {
    if (!trucksData) return []
    return Array.isArray(trucksData) ? trucksData : (trucksData.trucks || [])
  }, [trucksData])

  const targetId = searchParams.inventoryId || state.inventoryItem?._id || state.inventoryItem?.id || ''
  const inventoryItem = state.inventoryItem || allEntries.find(e => (e._id || e.id) === targetId)

  const truckIndex = useMemo(() => buildTruckIndex(allTrucks), [allTrucks])

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    allPfis.forEach(p => m.set(p._id, p))
    return m
  }, [allPfis])

  const customerMap = useMemo(() => {
    const m = new Map<string, DeliveryCustomer>()
    allCustomers.forEach(c => {
      if (c.id != null) m.set(String(c.id), c)
      if (c._id != null) m.set(String(c._id), c)
    })
    return m
  }, [allCustomers])

  // Matched sales.
  //
  // This used to take every sale sharing the allocation code, which on a code
  // covering twenty trucks put all twenty trucks' payments on one truck's
  // page. It matches on the truck now — see salesForLoading. It is also
  // computed before the record rather than from it, because the record's own
  // rate, date and destination are read back out of these entries.
  const matchedSales = useMemo((): DeliverySale[] => {
    if (!inventoryItem) return []
    return salesForLoading(allSales, {
      truckNumber: inventoryItem.truckNumber,
      dateAllocated: inventoryItem.dateAllocated,
      allocationCode: inventoryItem.allocationCode,
    }).sort((a, b) => (a.dateOfPayment || a.dateLoaded || '').localeCompare(b.dateOfPayment || b.dateLoaded || ''))
  }, [allSales, inventoryItem])

  // Enriched record — every field through the shared resolvers, so this page
  // cannot fall a fallback short of what the list pages show.
  const record = useMemo(() => {
    if (!inventoryItem) return null
    const truck = truckIndex.find(inventoryItem)
    const pfi = inventoryItem.pfiId ? pfiMap.get(String(inventoryItem.pfiId)) : null
    const customer = inventoryItem.customerId
      ? customerMap.get(String(inventoryItem.customerId)) || null
      : null
    const resolved = resolveLoading(inventoryItem, { truck, pfi, customer, sales: matchedSales })
    const split = buildLoadSplit(inventoryItem, matchedSales, customerMap)
    return {
      ...inventoryItem,
      ...resolved,
      unitLabel: pfi?.productUnit || 'Litres',
      // The whole truck, not one buyer's share of it — see buildLoadSplit.
      qty: split.total,
      split,
      code: (inventoryItem.allocationCode || '').trim().toUpperCase(),
      notes: inventoryItem.notes || '',
    }
  }, [inventoryItem, truckIndex, pfiMap, customerMap, matchedSales])

  /** True when the figure on screen came from the ledger, not the allocation. */
  const rateFromLedger = rateFromSales(matchedSales) > 0

  const salesSummary = useMemo(() => {
    let totalValue = 0, totalPaid = 0, totalExpenses = 0
    matchedSales.forEach(s => {
      totalValue += toNum(s.salesValue)
      totalPaid += toNum(s.paymentAmount)
      totalExpenses += toNum(s.expensesAmount ?? 0)
    })
    if (totalValue === 0 && record && record.rate > 0) {
      totalValue = record.rate * record.qty
    }
    // The volume with a buyer against it — the shares, added once. Summing the
    // quantity column across payment rows counted the same litres again for
    // every instalment, so a 45,000 L truck paid in three parts read 135,000.
    const totalQty = record?.split.assigned ?? 0
    return { totalQty, totalValue, totalPaid, totalExpenses, balance: totalValue - (totalPaid + totalExpenses) }
  }, [matchedSales, record])

  const handleDelete = async () => {
    if (!inventoryItem) return
    try {
      await deleteMutation.mutateAsync(inventoryItem._id || inventoryItem.id || '')
      toast.success('Record deleted')
      navigate({ to: '/delivery-operations' })
    } catch {
      toast.error('Delete failed')
    }
  }

  if (!inventoryItem && isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-card rounded-xl border border-border">
        <ShieldAlert className="size-10 mx-auto text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg">Record Not Found</h3>
        <p className="text-sm text-muted-foreground mt-1">Please select a valid inventory record from the list.</p>
        <Button onClick={() => navigate({ to: '/delivery-operations' })} className="mt-4 cursor-pointer">
          Back to Delivery Operations
        </Button>
      </div>
    )
  }

  const badge = record.status
  const Icon = STATUS_ICON[badge.key] ?? Package

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => navigate({ to: '/delivery-operations' })}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <PageHeader
      eyebrow="Truck Sales"
      title={record.truckPlate}
      actions={
        <>
          <p className="text-muted-foreground text-sm mt-0.5">
          {record.product || 'N/A'} · {record.depot || 'N/A'}
          </p>
        </>
      }
    />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="cursor-pointer"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="size-3.5 mr-1.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Quantity Loaded</div>
              <div className="text-xl font-semibold text-foreground mt-0.5">
                {record.qty > 0 ? `${fmtQty(record.qty)} ${record.unitLabel}` : '—'}
              </div>
              {/* On a split load the headline is the whole truck, so it has to
                  say what it is made of — otherwise it reads as one customer's. */}
              {record.split.isSplit && (
                <div className="mt-1 flex items-center gap-1.5">
                  <SplitBadge split={record.split} />
                  <span className="text-xs text-muted-foreground">
                    {record.split.shares.map(sh => fmtQty(sh.quantity)).join(' + ')}
                  </span>
                </div>
              )}
              {!record.split.isSplit && record.split.unassigned > 0 && record.split.assigned > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtQty(record.split.unassigned)} {record.unitLabel} unassigned
                </div>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-muted/10 text-muted-foreground">
              <Package className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">
                {record.pfiNumber ? 'PFI Number' : 'Allocation Code'}
              </div>
              <div className="text-lg font-semibold text-foreground mt-0.5 truncate max-w-[140px]">
                {record.batchLabel || '—'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-muted/10 text-muted-foreground">
              <FileText className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Rate (per litre)</div>
              <div className="text-xl font-semibold text-foreground mt-0.5">
                {record.rate > 0 ? `₦${record.rate.toLocaleString()}` : '—'}
              </div>
              {record.rate > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {rateFromLedger ? 'From sales ledger' : 'Recorded on allocation'}
                </div>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-accent/10 text-accent">
              <DollarSign className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Date Loaded</div>
              <div className="text-sm font-semibold text-foreground mt-0.5">
                {record.dateLoaded
                  ? (() => { try { return format(parseISO(record.dateLoaded), 'dd MMM yyyy') } catch { return record.dateLoaded } })()
                  : '—'}
              </div>
              {record.dateLoaded && !record.dateAllocated && (
                <div className="text-xs text-muted-foreground mt-0.5">From sales ledger</div>
              )}
            </div>
            <div className="p-2.5 rounded-xl bg-muted text-muted-foreground">
              <Calendar className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Status</div>
              <div className="text-sm font-semibold text-foreground mt-0.5">
                {badge.label}
              </div>
            </div>
            <div className={`p-2.5 rounded-xl border ${badge.cls}`}>
              {Icon ? <Icon className="size-5" /> : <Truck className="size-5" />}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Who this truck's load actually went to, before the allocation's
              own single-customer fields, which cannot describe a split. */}
          <SplitSummaryCard split={record.split} unit={record.unitLabel} />

          <Card>
            <CardHeader>
              <CardTitle>Truck & Allocation Details</CardTitle>
              <CardDescription>Core information about this delivery allocation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Truck className="size-5 text-primary shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Truck Plate</div>
                    <div className="font-semibold">{record.truckPlate}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Package className="size-5 text-primary shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Product</div>
                    <div className="font-semibold">{record.product || 'N/A'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Building2 className="size-5 text-warning shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Depot</div>
                    <div className="font-semibold">{record.depot || 'N/A'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <MapPin className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Destination</div>
                    <div className="font-semibold">{record.destination || 'N/A'}</div>
                  </div>
                </div>
                {/* Driver and customer were both resolved on this page and
                    then never rendered — the fleet register has a driver for
                    every truck, and the ledger names the customer even where
                    the allocation itself does not. */}
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <User className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Driver</div>
                    <div className="font-semibold">{record.driverName || 'N/A'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Users className="size-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground font-normal">
                      {record.split.isSplit ? `Customers (${record.split.shares.length})` : 'Customer'}
                    </div>
                    {/* The allocation carries one customer id, which on a split
                        load names whichever buyer was recorded first and hides
                        the rest. The shares name all of them. */}
                    <div className="font-semibold capitalize truncate">
                      {record.split.isSplit
                        ? record.split.shares.map(sh => sh.customerName || 'Unassigned').join(', ')
                        : (record.customerName || 'N/A')}
                    </div>
                  </div>
                </div>
                {record.code && (
                  <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                    <Tag className="size-5 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground font-normal">Allocation Code</div>
                      <div className="font-semibold">{record.code}</div>
                    </div>
                  </div>
                )}
              </div>

              {record.dateOffloaded && (
                <div className="border-t border-border pt-4 mt-4">
                  <div className="flex items-center gap-3 p-3 bg-accent/60 rounded-xl">
                    <CheckCircle2 className="size-5 text-accent shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground font-normal">Date Sold / Offloaded</div>
                      <div className="font-semibold">
                        {(() => { try { return format(parseISO(record.dateOffloaded), 'dd MMM yyyy') } catch { return record.dateOffloaded } })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sales Ledger */}
          <Card>
            <CardHeader>
              <CardTitle>Sales Ledger Entries ({matchedSales.length})</CardTitle>
              <CardDescription>Payment records matched to this truck allocation.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {matchedSales.length === 0 ? (
                <p className="p-8 text-sm text-muted-foreground text-center">No sales entries recorded for this allocation yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="font-semibold text-muted-foreground px-4">#</TableHead>
                        <TableHead className="font-semibold text-muted-foreground">Date</TableHead>
                        <TableHead className="font-semibold text-muted-foreground">Customer</TableHead>
                        <TableHead className="font-semibold text-muted-foreground text-right">Volume</TableHead>
                        <TableHead className="font-semibold text-muted-foreground text-right">Rate</TableHead>
                        <TableHead className="font-semibold text-muted-foreground text-right">Sales Value</TableHead>
                        <TableHead className="font-semibold text-muted-foreground text-right">Deposits</TableHead>
                        <TableHead className="font-semibold text-muted-foreground">Payer</TableHead>
                        <TableHead className="font-semibold text-muted-foreground">Bank</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matchedSales.map((entry, idx) => {
                        const entryDate = entry.dateOfPayment || entry.dateLoaded || ''
                        return (
                          <TableRow key={entry._id || entry.id || idx} className="hover:bg-muted/30">
                            <TableCell className="px-4 text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="whitespace-nowrap font-normal text-muted-foreground">
                              {entryDate ? (() => { try { return format(parseISO(entryDate), 'dd MMM yy') } catch { return entryDate } })() : '—'}
                            </TableCell>
                            <TableCell className="text-foreground font-normal">{entry.customerName || '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-foreground">
                              {toNum(entry.quantity) > 0 ? `${fmtQty(toNum(entry.quantity))} L` : '—'}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {toNum(entry.rate) > 0 ? `₦${toNum(entry.rate).toLocaleString()}` : '—'}
                            </TableCell>
                            <TableCell className="text-right text-foreground font-normal">
                              {toNum(entry.salesValue) > 0 ? fmtMoney(toNum(entry.salesValue)) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-accent">
                              {toNum(entry.paymentAmount) > 0 ? fmtMoney(toNum(entry.paymentAmount)) : '—'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{entry.payerName || '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{entry.bank || '—'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Sales Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 text-muted-foreground" /> Sales Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Volume Sold</span>
                <span className="font-semibold">{salesSummary.totalQty > 0 ? `${fmtQty(salesSummary.totalQty)} L` : '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Expected Revenue</span>
                <span className="font-semibold">{salesSummary.totalValue > 0 ? fmtMoney(salesSummary.totalValue) : '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Total Deposits</span>
                <span className="font-semibold text-accent">{salesSummary.totalPaid > 0 ? fmtMoney(salesSummary.totalPaid) : '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-semibold text-warning">{salesSummary.totalExpenses > 0 ? fmtMoney(salesSummary.totalExpenses) : '—'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground font-normal">Balance</span>
                <span className={`font-semibold ${salesSummary.balance === 0 ? 'text-accent' : salesSummary.balance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {salesSummary.balance === 0 ? '✓ Settled' : salesSummary.balance > 0 ? fmtMoney(salesSummary.balance) : `+${fmtMoney(Math.abs(salesSummary.balance))}`}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {record.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4 text-muted-foreground" /> Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-xl">
                  {record.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <ShieldAlert className="size-7" />
              <h3 className="font-semibold text-lg text-foreground">Delete Record</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete the record for <strong>{record.truckPlate}</strong>
              {record.code ? ` (${record.code})` : ''}? This will also delete associated sales entries. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="cursor-pointer">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="cursor-pointer"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Record'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
