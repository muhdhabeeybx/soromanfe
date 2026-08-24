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
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useDeliveryInventoryList, useDeleteDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useDeliverySalesList } from '#/lib/hooks/useDeliverySales'
import { usePfiList } from '#/lib/hooks/usePfis'
import { useAllocatableTrucks } from '#/lib/hooks/useFleet'
import { useToast } from '#/lib/hooks/useToast'
import type { DeliveryInventory, DeliverySale } from '#/lib/types'
import type { Pfi } from '#/lib/hooks/usePfis'
import { routeGuard } from '#/lib/route-guard'
import { salesForLoading, rateFromSales } from '#/lib/sales-ledger-utils'

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

const statusBadge: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  loaded: { label: 'In Transit', cls: 'bg-warning/10 text-warning border-warning/20', icon: Truck },
  offloaded: { label: 'Sold', cls: 'bg-accent/10 text-accent border-accent/20', icon: CheckCircle2 },
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

  const allEntries = useMemo((): DeliveryInventory[] => {
    if (!rawInventory) return []
    return Array.isArray(rawInventory) ? rawInventory : []
  }, [rawInventory])

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

  const truckMap = useMemo(() => {
    const m = new Map<string, any>()
    allTrucks.forEach((t: any) => m.set(t._id || t.id, t))
    return m
  }, [allTrucks])

  const pfiMap = useMemo(() => {
    const m = new Map<string, Pfi>()
    allPfis.forEach(p => m.set(p._id, p))
    return m
  }, [allPfis])

  // Enriched record
  const record = useMemo(() => {
    if (!inventoryItem) return null
    const truck = inventoryItem.truckId ? truckMap.get(String(inventoryItem.truckId)) : null
    const pfi = inventoryItem.pfiId ? pfiMap.get(String(inventoryItem.pfiId)) : null
    return {
      ...inventoryItem,
      truckPlate: inventoryItem.truckNumber || truck?.plateNumber || '—',
      driverName: truck?.driverName || '',
      pfiLabel: inventoryItem.pfiNumber || pfi?.pfiNumber || '',
      product: inventoryItem.pfiProduct || pfi?.productName || '',
      unitLabel: pfi?.productUnit || 'Litres',
      depotDisplay: inventoryItem.depot || inventoryItem.pfiLocation || pfi?.locationName || '',
      qty: toNum(inventoryItem.quantityAllocated),
      status: (inventoryItem.loadingStatus || 'loaded') as 'loaded' | 'offloaded',
      code: (inventoryItem.allocationCode || '').trim().toUpperCase(),
      notes: inventoryItem.notes || '',
    }
  }, [inventoryItem, truckMap, pfiMap])

  // Matched sales.
  //
  // This used to take every sale sharing the allocation code, which on a code
  // covering twenty trucks put all twenty trucks' payments on one truck's
  // page. It matches on the truck now — see salesForLoading.
  const matchedSales = useMemo((): DeliverySale[] => {
    if (!record) return []
    return salesForLoading(allSales, {
      truckNumber: record.truckPlate || record.truckNumber,
      dateAllocated: record.dateAllocated,
      allocationCode: record.code,
    }).sort((a, b) => (a.dateOfPayment || a.dateLoaded || '').localeCompare(b.dateOfPayment || b.dateLoaded || ''))
  }, [allSales, record])

  /**
   * The rate this truck sold at.
   *
   * The allocation record's own `rate` is only ever set by hand on the edit
   * dialog and is 0 on effectively every row, which is why this card read "—"
   * on trucks that had sold at a perfectly well-known price. The sales ledger
   * is where a rate is actually entered, so that is where it is read from,
   * falling back to the stored one.
   */
  const effectiveRate = useMemo(() => {
    const fromSales = rateFromSales(matchedSales)
    return fromSales > 0 ? fromSales : toNum(record?.rate)
  }, [matchedSales, record])

  const salesSummary = useMemo(() => {
    let totalQty = 0, totalValue = 0, totalPaid = 0, totalExpenses = 0
    matchedSales.forEach(s => {
      totalQty += toNum(s.quantity)
      totalValue += toNum(s.salesValue)
      totalPaid += toNum(s.paymentAmount)
      totalExpenses += toNum(s.expensesAmount ?? 0)
    })
    if (totalValue === 0 && record && effectiveRate > 0) {
      totalValue = effectiveRate * record.qty
    }
    return { totalQty, totalValue, totalPaid, totalExpenses, balance: totalValue - (totalPaid + totalExpenses) }
  }, [matchedSales, record, effectiveRate])

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

  const badge = statusBadge[record.status]
  const Icon = badge?.icon

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
          {record.product || 'N/A'} · {record.depotDisplay || 'N/A'}
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
              <div className="text-xs text-muted-foreground font-normal">Quantity Allocated</div>
              <div className="text-xl font-semibold text-foreground mt-0.5">
                {record.qty > 0 ? `${fmtQty(record.qty)} ${record.unitLabel}` : '—'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-muted/10 text-muted-foreground">
              <Package className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">PFI Number</div>
              <div className="text-lg font-semibold text-foreground mt-0.5 truncate max-w-[140px]">
                {record.pfiLabel || '—'}
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
                {effectiveRate > 0 ? `₦${effectiveRate.toLocaleString()}` : '—'}
              </div>
              {effectiveRate > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {rateFromSales(matchedSales) > 0 ? 'From sales ledger' : 'Recorded on allocation'}
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
                {record.dateAllocated ? (() => { try { return format(parseISO(record.dateAllocated), 'dd MMM yyyy') } catch { return record.dateAllocated } })() : '—'}
              </div>
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
                {badge?.label || '—'}
              </div>
            </div>
            <div className={`p-2.5 rounded-xl ${record.status === 'loaded' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent'}`}>
              {Icon ? <Icon className="size-5" /> : <Truck className="size-5" />}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-6">
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
                    <div className="font-semibold">{record.depotDisplay || 'N/A'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <MapPin className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Destination</div>
                    <div className="font-semibold">{record.location || 'N/A'}</div>
                  </div>
                </div>
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
