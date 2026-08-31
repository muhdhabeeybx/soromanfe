import { useState, useCallback, useEffect, useMemo } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import {
  Plus, Loader2, Trash2, Pencil, UserPlus, X,
  Fuel, Banknote, Tag, Truck, ArrowLeftRight,
  Calendar as CalendarIcon, FileText, Split,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  useCreateDeliverySale, useUpdateDeliverySale, useDeleteDeliverySale, useTransferOverpayment,
} from '#/lib/hooks/useDeliverySales'
import { useUpdateDeliveryInventory } from '#/lib/hooks/useDeliveryInventory'
import { useToast } from '#/lib/hooks/useToast'
import type { DeliverySale, DeliveryInventory, DeliveryCustomer } from '#/lib/types'
import { toNum, fmt, formatWithCommas, stripCommas, isFillingStation, idKey, entityId } from '#/lib/sales-ledger-utils'
import { useBankAccountPicker, bankAccountToString, BANK_ACCOUNT_USAGE } from '#/lib/bank-accounts'
import { NativeSelect } from '#/components/ui/native-select'

// Bank accounts come from the managed table via #/lib/bank-accounts — they
// used to be three literals right here. See that module for why resolution
// stayed keyed on the account number.

// Helpers (imported from lib/sales-ledger-utils)

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SaleRow {
  uid: string
  customer: string
  customer_name: string
  location: string
  quantity: string
  rate: string
  rateLocked: boolean
  sales_value: string
  payment_amount: string
  payer_name: string
  bank_account_id: string
  date_of_payment: string
  phone_number: string
  remarks: string
}

export interface LedgerGroup {
  key: string
  loadingId?: number
  truckNumber: string
  dateLoaded: string
  depot: string
  location: string
  customerId: string | null
  customerName: string
  quantity: number
  rate: number
  expected: number
  totalPaid: number
  balance: number
  pfiNumber: string
  allocationCode: string
  code: string
  payments: DeliverySale[]
  isFillingStation: boolean
  /**
   * The load this row is a share of. On a split truck `quantity` is one
   * customer's share and these describe the whole: without them a row saying
   * 30,000 L could not tell you it came off a 45,000 L truck, and every screen
   * reading it showed a fraction of a load as though it were the load.
   */
  loadQuantity: number
  loadAssigned: number
  loadUnassigned: number
  shareCount: number
  isSplitLoad: boolean
}

export const makeSaleRow = (): SaleRow => ({
  uid: crypto.randomUUID(),
  customer: '',
  customer_name: '',
  location: '',
  quantity: '',
  rate: '',
  rateLocked: false,
  sales_value: '',
  payment_amount: '',
  payer_name: '',
  bank_account_id: '',
  date_of_payment: format(new Date(), 'yyyy-MM-dd'),
  phone_number: '',
  remarks: '',
})

// ═══════════════════════════════════════════════════════════════════════════
// Record Payment Dialog
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What a truck has already been sold, keyed by loading id.
 *
 * Recording a payment used to prefill the whole allocated quantity into every
 * new row, on a truck that might already have 30,000 of its 45,000 spoken for.
 * That is how a share ends up holding the whole load — the stale 45,000 rows
 * this release had to reason around were made exactly this way.
 */
export interface LoadSummary {
  /** The whole truck. */
  total: number
  /** What its customers already account for. */
  assigned: number
  /** total − assigned, never negative. */
  unassigned: number
  /** How many customers are on it. */
  shareCount: number
  /** Their ids, so a follow-up payment is not mistaken for new volume. */
  customerIds: Set<string>
  /** Each customer's share, for prefilling a follow-up payment. */
  shareByCustomer: Map<string, number>
}

interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trucks: DeliveryInventory[]
  customers: DeliveryCustomer[]
  customerMap: Map<string, DeliveryCustomer>
  tripCodes: string[]
  cycleCustomerRateMap: Map<string, Map<string, string>>
  getCycleKey: (truck: string, date: string | null | undefined) => string
  normalizeCycleDate: (d: string | null | undefined) => string
  assignMode?: boolean
  loadSummaries?: Map<string, LoadSummary>
}

export function RecordPaymentDialog({
  open, onOpenChange, trucks, customers, customerMap, tripCodes,
  cycleCustomerRateMap, getCycleKey, normalizeCycleDate,
  assignMode = false, loadSummaries,
}: RecordPaymentDialogProps) {
  const toast = useToast()
  const createSale = useCreateDeliverySale()
  const updateInventory = useUpdateDeliveryInventory()

  const [truckLoadingId, setTruckLoadingId] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [dateLoaded, setDateLoaded] = useState('')
  const [depot, setDepot] = useState('')
  const [dialogTripCode, setDialogTripCode] = useState('')
  const [saleRows, setSaleRows] = useState<SaleRow[]>([makeSaleRow()])
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof SaleRow, string>>>>({})
  const [saving, setSaving] = useState(false)

  /** What the truck on screen has already been sold. */
  const selectedLoad = truckLoadingId ? loadSummaries?.get(truckLoadingId) : undefined

  const handleTruckSelect = useCallback((loadingId: string) => {
    setTruckLoadingId(loadingId)
    setRowErrors({})
    // idKey on both sides: the option's value arrives as a string, the
    // loading's id is a number. See idKey in sales-ledger-utils.
    const loading = trucks.find(t => entityId(t) === loadingId)
    if (!loading) {
      setTruckNumber(''); setDateLoaded(''); setDepot(''); setSaleRows([makeSaleRow()])
      return
    }
    const dep = loading.depot || loading.pfiLocation || loading.location || ''
    setTruckNumber(loading.truckNumber || '')
    setDateLoaded(loading.dateAllocated || '')
    setDepot(dep)

    const custId = idKey(loading.customerId)
    const custObj = custId ? customerMap.get(custId) : null
    const custName = loading.customerName || custObj?.name || ''
    const destination = isFillingStation(custObj) ? custName : (loading.location || '')
    /*
     * What is left to sell, not the whole truck. On a load that already has
     * customers, prefilling the full allocation invites a second customer to
     * be recorded against volume that is already spoken for — and a row
     * carrying the whole load is indistinguishable from a stale one later.
     * Where this row's customer is already on the truck it is a follow-up
     * payment, so their existing share is the right default.
     */
    const summary = loadSummaries?.get(loadingId)
    const existingShare = custId ? summary?.shareByCustomer.get(custId) ?? 0 : 0
    const qty = existingShare > 0
      ? existingShare
      : (summary && summary.assigned > 0 ? summary.unassigned : toNum(loading.quantityAllocated))
    const cycleKey = getCycleKey(loading.truckNumber || '', loading.dateAllocated || '')
    const cycleRates = cycleCustomerRateMap.get(cycleKey)
    const existingRate = (custId && cycleRates?.get(custId)) || ''
    const rateLocked = !!existingRate && !isFillingStation(custObj)
    const qtyStr = qty > 0 ? formatWithCommas(String(qty)) : ''
    const sv = existingRate && qtyStr
      ? formatWithCommas(String(Number(stripCommas(qtyStr)) * Number(stripCommas(existingRate))))
      : ''
    const autoPhone = (custObj && isFillingStation(custObj) && custObj.phoneNumber) ? custObj.phoneNumber : ''
    const autoPayerName = (custObj && isFillingStation(custObj) && custObj.contactPerson) ? custObj.contactPerson : ''
    const autoPayerPhone = (custObj && isFillingStation(custObj) && custObj.contactPersonPhone) ? custObj.contactPersonPhone : autoPhone

    setSaleRows([{
      ...makeSaleRow(),
      customer: custId,
      customer_name: custName,
      location: destination,
      quantity: qtyStr,
      rate: existingRate,
      rateLocked,
      sales_value: sv,
      phone_number: autoPayerPhone,
      payer_name: autoPayerName,
    }])
  }, [trucks, customerMap, getCycleKey, cycleCustomerRateMap, loadSummaries])

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
      if (field === 'rate' && row.rateLocked) return row
      const updated = {
        ...row, [field]: field === 'quantity' || field === 'rate' || field === 'payment_amount' || field === 'sales_value'
          ? (field === 'sales_value' ? value : formatWithCommas(value))
          : value
      }
      if (field === 'customer') {
        const cycleKey = getCycleKey(truckNumber, dateLoaded)
        const cycleRates = cycleCustomerRateMap.get(cycleKey)
        const priorRate = value ? cycleRates?.get(value) : undefined
        const selectedCustomer = value ? customerMap.get(value) : null
        // The name travels with the id rather than in a second update call:
        // clearing the customer back to "none" has to clear the name too,
        // otherwise the row saves under whoever was picked before.
        updated.customer_name = selectedCustomer?.name || ''
        if (priorRate && !isFillingStation(selectedCustomer)) {
          updated.rate = priorRate
          updated.rateLocked = true
          const q = Number(stripCommas(updated.quantity)) || 0
          const r = Number(stripCommas(priorRate)) || 0
          updated.sales_value = q * r > 0 ? formatWithCommas(String(q * r)) : ''
        } else {
          updated.rateLocked = false
        }
        if (selectedCustomer && isFillingStation(selectedCustomer)) {
          if (selectedCustomer.contactPerson) updated.payer_name = selectedCustomer.contactPerson
          if (selectedCustomer.contactPersonPhone) updated.phone_number = selectedCustomer.contactPersonPhone
          else if (selectedCustomer.phoneNumber) updated.phone_number = selectedCustomer.phoneNumber
          updated.location = selectedCustomer.name
        }
      }
      if (field === 'quantity' || field === 'rate') {
        const q = Number(stripCommas(field === 'quantity' ? value : row.quantity)) || 0
        const r = Number(stripCommas(field === 'rate' ? value : row.rate)) || 0
        updated.sales_value = q * r > 0 ? formatWithCommas(String(q * r)) : ''
      }
      return updated
    }))
  }, [rowErrors, truckNumber, dateLoaded, getCycleKey, cycleCustomerRateMap, customerMap])

  const addSaleRow = () => setSaleRows(prev => [...prev, makeSaleRow()])
  const removeSaleRow = (uid: string) => setSaleRows(prev => {
    if (prev.length <= 1) return prev
    setRowErrors(errs => { const next = { ...errs }; delete next[uid]; return next })
    return prev.filter(r => r.uid !== uid)
  })

  // Closing keeps nothing. Reopening used to show the truck, rows and
  // validation errors from the entry before, so the next payment was keyed
  // on top of stale figures. Every close goes through here — the footer, the
  // overlay, Escape, and the save below — so there is no path that skips it.
  const closeDialog = useCallback((next: boolean) => {
    if (!next) {
      setTruckLoadingId(''); setTruckNumber(''); setDateLoaded(''); setDepot('')
      setDialogTripCode(''); setSaleRows([makeSaleRow()]); setRowErrors({})
    }
    onOpenChange(next)
  }, [onOpenChange])

  const handleSave = useCallback(async () => {
    if (!truckNumber.trim()) { toast.error('Please select a truck'); return }
    const filledRows = saleRows.filter(r => r.customer || r.payment_amount || r.rate || r.quantity)
    if (filledRows.length === 0) { toast.error('Add at least one customer row'); return }

    const errors: Record<string, Partial<Record<keyof SaleRow, string>>> = {}
    const nameOnlyRegex = /^[A-Za-z\s'\-\.]+$/
    filledRows.forEach(row => {
      const e: Partial<Record<keyof SaleRow, string>> = {}
      const custObj = row.customer ? customerMap.get(row.customer) : null
      const isFS = isFillingStation(custObj)
      if (!row.customer) e.customer = 'Customer is required'
      if (!row.location.trim()) e.location = 'Destination is required'
      if (!assignMode && !isFS) {
        if (!row.rate || Number(stripCommas(row.rate)) <= 0) e.rate = 'Rate is required'
        if (row.payer_name.trim() && !nameOnlyRegex.test(row.payer_name.trim())) e.payer_name = 'Letters only'
      }
      if (Object.keys(e).length) errors[row.uid] = e
    })
    if (Object.keys(errors).length) { setRowErrors(errors); toast.error('Please fix the highlighted fields'); return }

    /*
     * New volume cannot exceed what is left on the truck. Rows for a customer
     * already on the load are follow-up payments against volume that is
     * already counted, so only the genuinely new customers are measured
     * against the remainder.
     */
    if (selectedLoad && selectedLoad.total > 0) {
      const newVolume = filledRows
        .filter(r => !r.customer || !selectedLoad.customerIds.has(r.customer))
        .reduce((sum, r) => sum + (Number(stripCommas(r.quantity)) || 0), 0)
      if (newVolume > selectedLoad.unassigned + 1) {
        toast.error(
          `${newVolume.toLocaleString()} L is more than the ${selectedLoad.unassigned.toLocaleString()} L left on this truck ` +
          `(${selectedLoad.assigned.toLocaleString()} L of ${selectedLoad.total.toLocaleString()} L already assigned).`,
        )
        return
      }
    }

    setRowErrors({}); setSaving(true)

    try {
      const currentUser = localStorage.getItem('fullname') || 'Unknown'
      const selectedLoading = truckLoadingId ? trucks.find(l => entityId(l) === truckLoadingId) : undefined
      const dialogAllocationCode = selectedLoading?.allocationCode || undefined

      const promises = filledRows.map(row => {
        return createSale.mutateAsync({
          truckNumber: truckNumber.trim(),
          dateLoaded: dateLoaded || format(new Date(), 'yyyy-MM-dd'),
          depotLoaded: depot.trim() || undefined,
          customerId: row.customer || undefined,
          customerName: row.customer_name || undefined,
          allocationCode: dialogTripCode || dialogAllocationCode || undefined,
          location: row.location.trim() || undefined,
          quantity: Number(stripCommas(row.quantity)) || undefined,
          rate: !assignMode ? (Number(stripCommas(row.rate)) || undefined) : undefined,
          salesValue: !assignMode ? (Number(stripCommas(row.sales_value)) || undefined) : undefined,
          paymentAmount: !assignMode ? (Number(stripCommas(row.payment_amount)) || undefined) : undefined,
          payerName: !assignMode ? (row.payer_name.trim() || undefined) : undefined,
          dateOfPayment: !assignMode ? (row.date_of_payment || undefined) : undefined,
          phoneNumber: row.phone_number.trim() || undefined,
          remarks: row.remarks.trim() || undefined,
          enteredBy: currentUser,
          paymentMethod: 'manual',
        } as Partial<DeliverySale>)
      })

      await Promise.all(promises)

      const loadingId = truckLoadingId
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
        } catch { /* non-critical */ }
      }

      toast.success(assignMode
        ? `${filledRows.length} customer${filledRows.length > 1 ? 's' : ''} assigned`
        : `${filledRows.length} entr${filledRows.length > 1 ? 'ies' : 'y'} recorded`)
      closeDialog(false)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [truckNumber, dateLoaded, depot, truckLoadingId, dialogTripCode, saleRows, customerMap, assignMode, trucks, createSale, updateInventory, toast, closeDialog, selectedLoad])

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-[900px] max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${assignMode ? 'bg-warning/10' : 'bg-accent/10'}`}>
              {assignMode
                ? <UserPlus className="size-5 text-warning" />
                : <Banknote className="size-5 text-accent" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {assignMode ? 'Assign Customer to Cycle' : 'Record Payment'}
              </h2>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {assignMode
                  ? 'Link customers to this truck cycle now — add rate & payment later.'
                  : 'Select a loaded truck, then add one row per customer.'}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Record payments against a loaded truck</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-normal text-foreground flex items-center gap-1.5">
              <Truck className="size-4 text-muted-foreground" /> Select Loaded Truck <span className="text-destructive">*</span>
            </Label>
            <select
              aria-label="Select loaded truck"
              value={truckLoadingId}
              onChange={e => handleTruckSelect(e.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm"
            >
              <option value="">Select a truck…</option>
              {trucks.map(t => {
                const id = entityId(t)
                const plate = t.truckNumber || `Truck #${t.truckId}`
                const custName = t.customerName || ''
                const summary = loadSummaries?.get(id)
                const qty = summary?.total || toNum(t.quantityAllocated)
                const dateLabel = normalizeCycleDate(t.dateAllocated || '')
                // How much of the truck is still free to sell. Picking a truck
                // that is already spoken for used to look identical to picking
                // an empty one.
                const remaining = summary && summary.assigned > 0
                  ? (summary.unassigned > 0
                      ? ` · ${summary.unassigned.toLocaleString()} L left`
                      : ' · fully assigned')
                  : ''
                const splitNote = summary && summary.shareCount > 1 ? ` · split ${summary.shareCount}` : ''
                return (
                  <option key={id} value={id}>
                    {plate} | {dateLabel || '-'} | {qty.toLocaleString()} L{remaining}{splitNote}{custName ? ` → ${custName}` : ''}
                  </option>
                )
              })}
            </select>
          </div>

          {truckNumber && (
            <div className="bg-muted/60 border border-border rounded-lg p-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Truck:</span>{' '}
                  <span className="font-semibold text-foreground">{truckNumber}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Depot:</span>{' '}
                  <span className="font-normal text-foreground">{depot || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Date Loaded:</span>{' '}
                  <span className="font-normal text-foreground">
                    {dateLoaded ? (() => { try { return format(parseISO(dateLoaded), 'dd MMM yyyy') } catch { return dateLoaded } })() : '—'}
                  </span>
                </div>
              </div>

              {/* What is already sold off this truck, before anything is typed
                  below it. The quantity prefilled into the row is what is
                  left, and this is the sum that explains it. */}
              {selectedLoad && selectedLoad.total > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
                  <span className="text-muted-foreground">
                    Loaded <strong className="text-foreground">{selectedLoad.total.toLocaleString()} L</strong>
                  </span>
                  {selectedLoad.assigned > 0 && (
                    <span className="text-muted-foreground">
                      Assigned <strong className="text-foreground">{selectedLoad.assigned.toLocaleString()} L</strong>
                      {selectedLoad.shareCount > 1 && ` to ${selectedLoad.shareCount} customers`}
                    </span>
                  )}
                  <span className={selectedLoad.unassigned > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                    Left{' '}
                    <strong className={selectedLoad.unassigned > 0 ? 'text-accent' : 'text-muted-foreground'}>
                      {selectedLoad.unassigned.toLocaleString()} L
                    </strong>
                  </span>
                  {selectedLoad.shareCount > 1 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 font-semibold text-blue-700 dark:text-blue-300">
                      <Split className="size-3" />
                      Split load
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {truckNumber && tripCodes.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground flex items-center gap-1.5">
                <Tag className="size-3.5 text-muted-foreground" /> Allocation Code
              </Label>
              <select
                aria-label="Select allocation code"
                value={dialogTripCode}
                onChange={e => setDialogTripCode(e.target.value)}
                className={`h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${dialogTripCode ? 'border-border bg-muted text-foreground font-semibold' : 'border-input'}`}
              >
                <option value="">No allocation code</option>
                {tripCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          )}

          {truckNumber && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                  Customer ({saleRows.length})
                </p>
                <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={addSaleRow}>
                  <UserPlus className="size-3.5" /> Add Customer
                </Button>
              </div>

              {saleRows.map((row, idx) => {
                const custObj = row.customer ? customerMap.get(row.customer) : null
                const isFS = isFillingStation(custObj)
                const hasError = rowErrors[row.uid] && Object.keys(rowErrors[row.uid]).length

                return (
                  <div key={row.uid} className={`border rounded-lg p-3 space-y-3 relative ${hasError ? 'border-destructive/40 bg-destructive/30' : isFS ? 'border-warning/40 bg-warning/30' : 'border-border bg-muted/50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                        {isFS ? <Fuel className="size-3 text-warning" /> : null}
                        Customer #{idx + 1}
                        {isFS && <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-warning/10 text-warning border border-warning/40 normal-case tracking-normal">Filling Station</span>}
                      </span>
                      {saleRows.length > 1 && (
                        <button type="button" onClick={() => removeSaleRow(row.uid)} className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded duration-250 ease-luxe" title="Remove row">
                          <X className="size-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Customer <span className="text-destructive">*</span></Label>
                        <select
                          aria-label={`Customer for row ${idx + 1}`}
                          value={row.customer}
                          onChange={e => updateSaleRow(row.uid, 'customer', e.target.value)}
                          className={`h-9 w-full rounded-md border bg-background px-3 py-2 text-sm ${rowErrors[row.uid]?.customer ? 'border-destructive bg-destructive/10' : 'border-input'}`}
                        >
                          <option value="">Select customer…</option>
                          {customers.map(c => {
                            const cid = entityId(c)
                            return <option key={cid} value={cid}>{c.name}</option>
                          })}
                        </select>
                        {rowErrors[row.uid]?.customer && <p className="text-xs text-destructive">{rowErrors[row.uid].customer}</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Destination <span className="text-destructive">*</span></Label>
                        <Input placeholder="e.g. Kano, Abuja…" className={`h-9 text-sm ${rowErrors[row.uid]?.location ? 'border-destructive bg-destructive/10' : ''}`} value={row.location} onChange={e => updateSaleRow(row.uid, 'location', e.target.value)} />
                        {rowErrors[row.uid]?.location && <p className="text-xs text-destructive">{rowErrors[row.uid].location}</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Quantity (L)</Label>
                        <Input type="text" inputMode="decimal" placeholder="e.g. 33,000" className="h-9 text-sm" value={row.quantity} onChange={e => updateSaleRow(row.uid, 'quantity', e.target.value)} />
                      </div>
                    </div>

                    {assignMode && (
                      <div className="flex items-start gap-2 p-2.5 bg-warning/10 border border-warning/40 rounded-lg">
                        <UserPlus className="size-3.5 text-warning mt-0.5 shrink-0" />
                        <p className="text-xs text-warning">
                          <span className="font-semibold">Assign Only</span> — customer linked to this cycle now. Edit later to add rate and payment.
                        </p>
                      </div>
                    )}

                    {!assignMode && !isFS && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground flex items-center gap-1">
                              Rate (₦/L) <span className="text-destructive">*</span>
                              {row.rateLocked && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-warning/10 text-warning border border-warning/40"><FileText className="size-2.5" /> Locked</span>}
                            </Label>
                            <Input type="text" inputMode="decimal" placeholder="e.g. 1,210" className={`h-9 text-sm ${row.rateLocked ? 'bg-warning/10 text-warning font-semibold cursor-not-allowed' : rowErrors[row.uid]?.rate ? 'border-destructive bg-destructive/10' : ''}`} value={row.rate} readOnly={row.rateLocked} onChange={e => updateSaleRow(row.uid, 'rate', e.target.value)} />
                            {rowErrors[row.uid]?.rate && <p className="text-xs text-destructive">{rowErrors[row.uid].rate}</p>}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Expected (₦)</Label>
                            <Input readOnly className="h-9 text-sm bg-white font-semibold text-foreground" value={row.sales_value ? `₦${row.sales_value}` : '—'} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Amount Paid (₦)</Label>
                            <Input type="text" inputMode="decimal" className="h-9 text-sm" value={row.payment_amount} onChange={e => updateSaleRow(row.uid, 'payment_amount', e.target.value)} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground"><CalendarIcon className="size-3 inline mr-1" />Date of Payment</Label>
                            <Input type="date" className="h-9 text-sm" value={row.date_of_payment} onChange={e => updateSaleRow(row.uid, 'date_of_payment', e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Payer's Name</Label>
                            <Input className={`h-9 text-sm ${rowErrors[row.uid]?.payer_name ? 'border-destructive bg-destructive/10' : ''}`} value={row.payer_name} onChange={e => updateSaleRow(row.uid, 'payer_name', e.target.value.replace(/[0-9]/g, ''))} />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Phone Number</Label>
                        <Input placeholder="e.g. 08012345678" className="h-9 text-sm" value={row.phone_number} onChange={e => updateSaleRow(row.uid, 'phone_number', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Remarks</Label>
                        <Input placeholder={isFS ? 'e.g. Awaiting sale…' : 'e.g. Partial Payment…'} className="h-9 text-sm" value={row.remarks} onChange={e => updateSaleRow(row.uid, 'remarks', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => closeDialog(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {saving ? 'Saving…' : `Record ${saleRows.filter(r => r.customer).length || ''} Payment${saleRows.filter(r => r.customer).length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Quick Payment Dialog
// ═══════════════════════════════════════════════════════════════════════════

interface QuickPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: LedgerGroup | null
}

export function QuickPaymentDialog({ open, onOpenChange, target }: QuickPaymentDialogProps) {
  const toast = useToast()
  const createSale = useCreateDeliverySale()
  const [saving, setSaving] = useState(false)
  const { options: bankOptions, byId: bankById } = useBankAccountPicker({
    usage: BANK_ACCOUNT_USAGE.truckSales,
  })
  const [form, setForm] = useState({
    payment_amount: '',
    payer_name: '',
    phone_number: '',
    date_of_payment: format(new Date(), 'yyyy-MM-dd'),
    bank_account_id: '',
  })

  // Closing clears the form. Otherwise the next row this dialog opens on
  // arrives with the previous row's amount and payer already typed in.
  const closeDialog = useCallback((next: boolean) => {
    if (!next) setForm({ payment_amount: '', payer_name: '', phone_number: '', date_of_payment: format(new Date(), 'yyyy-MM-dd'), bank_account_id: '' })
    onOpenChange(next)
  }, [onOpenChange])

  const handleSave = useCallback(async () => {
    if (!target) return
    const paymentAmount = Number(stripCommas(form.payment_amount))
    if (!paymentAmount || paymentAmount <= 0) { toast.error('Enter a valid payment amount'); return }
    const payerName = form.payer_name.trim()
    if (payerName && !/^[A-Za-z\s'\-.]+$/.test(payerName)) { toast.error('Payer name should contain letters only'); return }

    setSaving(true)
    try {
      const currentUser = localStorage.getItem('fullname') || 'Unknown'
      await createSale.mutateAsync({
        truckNumber: target.truckNumber,
        dateLoaded: target.dateLoaded || format(new Date(), 'yyyy-MM-dd'),
        depotLoaded: target.depot || undefined,
        customerId: target.customerId || undefined,
        customerName: target.customerName || undefined,
        allocationCode: target.allocationCode || undefined,
        location: target.location || undefined,
        quantity: target.quantity || undefined,
        rate: target.rate || undefined,
        salesValue: target.expected || undefined,
        paymentAmount: paymentAmount,
        payerName: payerName || undefined,
        dateOfPayment: form.date_of_payment || format(new Date(), 'yyyy-MM-dd'),
        phoneNumber: form.phone_number.trim() || undefined,
        // Both are written: the id links the row properly, and the string is
        // what every row predating that column resolves by, so historical and
        // new entries keep reading the same way.
        bankAccountId: form.bank_account_id ? Number(form.bank_account_id) : undefined,
        bank: form.bank_account_id
          ? bankAccountToString(bankById.get(form.bank_account_id)!)
          : undefined,
        enteredBy: currentUser,
        paymentMethod: 'manual',
      } as Partial<DeliverySale>)
      toast.success(`${target.truckNumber} · ${fmt(paymentAmount)}`)
      closeDialog(false)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }, [target, form, createSale, toast, closeDialog, bankById])

  const amountTyped = Number(stripCommas(form.payment_amount)) || 0
  const remainingBalance = target ? target.balance - amountTyped : 0

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Banknote className="size-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Add Payment</h2>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {target ? `${target.truckNumber} · ${target.customerName || 'Customer pending'}${target.code ? ` · ${target.code}` : ''}` : ''}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Record a follow-up payment</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {target && (
            <div className="bg-muted border border-border rounded-lg p-3 text-sm space-y-2">
              <div className="grid grid-cols-2 gap-3 pb-2 border-b border-dashed border-border">
                <div>
                  <p className="text-xs text-muted-foreground font-normal">Expected</p>
                  <p className="font-semibold text-foreground mt-0.5">{target.expected > 0 ? fmt(target.expected) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-normal">Current Balance</p>
                  <p className={`font-semibold mt-0.5 ${target.balance > 0 ? 'text-destructive' : 'text-accent'}`}>
                    {target.expected > 0 ? (target.balance > 0 ? fmt(target.balance) : 'Fully Paid') : '—'}
                  </p>
                </div>
              </div>
              {amountTyped > 0 && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">Payment Preview</p>
                    <p className="font-semibold text-muted-foreground mt-0.5">{fmt(amountTyped)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-normal">New Balance</p>
                    <p className={`font-semibold mt-0.5 ${remainingBalance === 0 ? 'text-accent' : remainingBalance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {remainingBalance === 0 ? 'Fully Settled' : remainingBalance > 0 ? fmt(remainingBalance) : `+${fmt(Math.abs(remainingBalance))} Overpaid`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount Paid</Label>
              <Input type="text" inputMode="decimal" value={form.payment_amount} onChange={e => setForm(prev => ({ ...prev, payment_amount: formatWithCommas(e.target.value) }))} placeholder="e.g. 5,000,000" />
            </div>
            <div className="space-y-1">
              <Label>Date Paid</Label>
              <Input type="date" value={form.date_of_payment} onChange={e => setForm(prev => ({ ...prev, date_of_payment: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payer's Name</Label>
              <Input value={form.payer_name} onChange={e => setForm(prev => ({ ...prev, payer_name: e.target.value.replace(/[0-9]/g, '') }))} />
            </div>
            <div className="space-y-1">
              <Label>Phone Number</Label>
              <Input value={form.phone_number} onChange={e => setForm(prev => ({ ...prev, phone_number: e.target.value }))} />
            </div>
          </div>

          {/* Which account the money landed in. The same shortlist the full
              Record Payment dialog offers — nine truck-collection accounts,
              not the company's whole banking — so a payment recorded here can
              be reconciled against the statement it will actually appear on. */}
          <div className="space-y-1">
            <Label>Paid Into</Label>
            <NativeSelect
              value={form.bank_account_id}
              onChange={e => setForm(prev => ({ ...prev, bank_account_id: e.target.value }))}
            >
              <option value="">Select the account…</option>
              {bankOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </NativeSelect>
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => closeDialog(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {saving ? 'Saving…' : 'Save Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Row Setup Dialog
// ═══════════════════════════════════════════════════════════════════════════

interface RowSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: LedgerGroup | null
  customers: DeliveryCustomer[]
  customerMap: Map<string, DeliveryCustomer>
  tripCodes: string[]
}

export function RowSetupDialog({ open, onOpenChange, target, customers, customerMap, tripCodes }: RowSetupDialogProps) {
  const toast = useToast()
  const updateSale = useUpdateDeliverySale()
  const updateInventory = useUpdateDeliveryInventory()
  const [saving, setSaving] = useState(false)
  const [setupCustomer, setSetupCustomer] = useState('')
  const [setupDestination, setSetupDestination] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [setupRate, setSetupRate] = useState('')
  const [setupQuantity, setSetupQuantity] = useState('')

  useEffect(() => {
    if (target) {
      setSetupCustomer(target.customerId || '')
      setSetupDestination(target.location || '')
      setSetupCode(target.code || target.allocationCode || '')
      setSetupRate(target.rate > 0 ? formatWithCommas(String(target.rate)) : '')
      setSetupQuantity(target.quantity > 0 ? formatWithCommas(String(target.quantity)) : '')
    }
  }, [target, open])

  const handleSave = useCallback(async () => {
    if (!target) return
    const normalized = setupCode.trim().toUpperCase().replace(/\s+/g, '-')
    if (normalized && !tripCodes.includes(normalized)) { toast.error('Create this code in Inventory first'); return }

    setSaving(true)
    try {
      const customerId = setupCustomer || null
      const customerName = customerId ? (customerMap.get(customerId)?.name || '') : ''
      const numRate = Number(stripCommas(setupRate)) || 0
      const numQty = Number(stripCommas(setupQuantity)) || 0
      const calcSalesValue = numRate * numQty > 0 ? numRate * numQty : undefined

      // A row with no payments yet has nowhere to keep a rate except the
      // loading itself, and that is where the ledger already looks for one:
      // useLedgerGroups falls back to `loading.rate` whenever the sales carry
      // none. Until now the rate was written only onto payment rows, so
      // setting it on a truck that had not been paid yet saved nothing at all
      // — the dialog still said "Row setup saved", the rate came back blank,
      // Expected stayed at zero, and Add Payment refused the row for being
      // incomplete. Writing it here fixes both halves of that.
      //
      // Not on a multi-customer cycle: those share one loading between several
      // customers who can each have their own rate, and one customer's rate on
      // the shared row would silently become everyone's. A multi-customer
      // group is built out of its payments, so it always has payment rows to
      // carry the rate instead.
      //
      // The quantity is the same trap and did real damage before it was seen.
      // On a split load this field holds one customer's share — 30,000 of a
      // 45,000 L truck — and it was written onto `quantityAllocated`, which is
      // the whole load. Six trucks across five batches had their total silently
      // replaced by one buyer's share that way, so PFI-40B's KUJ228XC reported
      // 30,000 L for a truck that carried 45,000. The share belongs on this
      // customer's own payment rows, below; the load's total belongs to the
      // allocation and is edited in Delivery Operations.
      if (target.loadingId) {
        const isMulti = target.key.split(':').length > 2
        await updateInventory.mutateAsync({
          id: String(target.loadingId),
          data: {
            ...(isMulti ? {} : {
              customerId: customerId || undefined,
              customerName: customerName || undefined,
              location: setupDestination.trim() || undefined,
              ...(numRate > 0 ? { rate: numRate } : {}),
              ...(numQty > 0 ? { quantityAllocated: numQty } : {}),
            }),
            allocationCode: normalized || null,
          },
        })
        if (target.payments.length > 0) {
          await Promise.all(target.payments.map(p =>
            updateSale.mutateAsync({
              id: entityId(p),
              data: {
                customerId: customerId || undefined,
                location: setupDestination.trim() || undefined,
                allocationCode: normalized || null,
                ...(numRate > 0 ? { rate: numRate } : {}),
                ...(numQty > 0 ? { quantity: numQty } : {}),
                ...(calcSalesValue ? { salesValue: calcSalesValue } : {}),
              },
            }),
          ))
        }
      } else if (target.payments.length > 0) {
        await Promise.all(target.payments.map(p =>
          updateSale.mutateAsync({
            id: entityId(p),
            data: {
              customerId: customerId || undefined,
              location: setupDestination.trim() || undefined,
              allocationCode: normalized || null,
              ...(numRate > 0 ? { rate: numRate } : {}),
              ...(numQty > 0 ? { quantity: numQty } : {}),
              ...(calcSalesValue ? { salesValue: calcSalesValue } : {}),
            },
          }),
        ))
      } else {
        // Neither a loading nor a payment to write to. Nothing was saved, so
        // this must not report that something was — the old code fell through
        // both branches and toasted success over a no-op.
        toast.error('This row has no loading or payment behind it yet — record a payment against it first')
        return
      }

      toast.success('Row setup saved')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save setup')
    } finally {
      setSaving(false)
    }
  }, [target, setupCustomer, setupDestination, setupCode, setupRate, setupQuantity, tripCodes, customerMap, updateSale, updateInventory, toast, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <UserPlus className="size-5 text-warning" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Row Setup</h2>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {target ? `${target.truckNumber} · ${target.dateLoaded ? (() => { try { return format(parseISO(target.dateLoaded), 'dd MMM yyyy') } catch { return target.dateLoaded } })() : 'No date'}` : 'Assign customer and destination'}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Setup customer, destination and code for selected row</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Customer</Label>
              <select aria-label="Setup customer" value={setupCustomer} onChange={e => setSetupCustomer(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm">
                <option value="">Select customer…</option>
                {customers.map(c => {
                  const cid = entityId(c)
                  return <option key={cid} value={cid}>{c.name}</option>
                })}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Destination</Label>
              <Input value={setupDestination} onChange={e => setSetupDestination(e.target.value)} placeholder="e.g. Kano, Abuja" />
            </div>
          </div>

          {/* A split truck's row holds one customer's share, and the fields
              below only ever touch that share. Said out loud because it was
              not: the quantity here used to be written onto the whole
              allocation, which is how five trucks came to report one buyer's
              volume as the load that left the depot. */}
          {target?.isSplitLoad && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs">
              <Split className="mt-0.5 size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span className="text-muted-foreground">
                Split load — this row is <strong className="text-foreground">{target.customerName || 'this customer'}</strong>
                {"'"}s share of a{' '}
                <strong className="text-foreground">{target.loadQuantity.toLocaleString()} L</strong> truck shared
                between {target.shareCount} customers. Changes here apply to this share only; the truck{"'"}s total is
                edited in Delivery Operations.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{target?.isSplitLoad ? 'Quantity — this share (L)' : 'Quantity (L)'}</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={setupQuantity}
                onChange={e => setSetupQuantity(formatWithCommas(e.target.value))}
                placeholder="e.g. 33,000"
              />
            </div>
            <div className="space-y-1">
              <Label>Rate (₦/L)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={setupRate}
                onChange={e => setSetupRate(formatWithCommas(e.target.value))}
                placeholder="e.g. 1,200"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Allocation Code</Label>
            <select aria-label="Setup allocation code" value={setupCode} onChange={e => setSetupCode(e.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm">
              <option value="">No allocation code</option>
              {tripCodes.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
            {saving ? 'Saving…' : 'Save Setup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Edit Entry Dialog
// ═══════════════════════════════════════════════════════════════════════════

interface EditEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: DeliverySale | null
  tripCodes: string[]
}

export function EditEntryDialog({ open, onOpenChange, target, tripCodes }: EditEntryDialogProps) {
  const toast = useToast()
  const updateSale = useUpdateDeliverySale()
  const { options: bankOptions } = useBankAccountPicker({ usage: BANK_ACCOUNT_USAGE.truckSales })
  const [saving, setSaving] = useState(false)
  const [editTripCode, setEditTripCode] = useState('')
  const [form, setForm] = useState<{
    rate: string; sales_value: string; payment_amount: string;
    payer_name: string; date_of_payment: string; bank: string;
    remarks: string; phone_number: string; location: string; quantity: string;
  } | null>(null)

  useEffect(() => {
    if (target && open) {
      setEditTripCode(target.allocationCode || '')
      const rate = toNum(target.rate)
      const sv = toNum(target.salesValue)
      const pa = toNum(target.paymentAmount)
      const qty = toNum(target.quantity)

      let rawDate = target.dateOfPayment || ''
      if (rawDate) {
        try {
          rawDate = format(parseISO(rawDate), 'yyyy-MM-dd')
        } catch {
          rawDate = String(rawDate).split('T')[0] || ''
        }
      }

      setForm({
        quantity: qty > 0 ? formatWithCommas(String(qty)) : '',
        rate: rate > 0 ? formatWithCommas(String(rate)) : '',
        sales_value: sv > 0 ? formatWithCommas(String(sv)) : '',
        payment_amount: pa > 0 ? formatWithCommas(String(pa)) : '',
        payer_name: target.payerName || '',
        date_of_payment: rawDate,
        bank: target.bank || '',
        remarks: target.remarks || '',
        phone_number: target.phoneNumber || '',
        location: target.location || '',
      })
    }
  }, [target, open])

  const handleSave = useCallback(async () => {
    if (!target || !form) return
    setSaving(true)
    try {
      const qty = Number(stripCommas(form.quantity)) || undefined
      const rate = Number(stripCommas(form.rate)) || undefined
      const sv = Number(stripCommas(form.sales_value)) || undefined
      const pa = Number(stripCommas(form.payment_amount)) || undefined
      const computedSv = qty && rate && !sv ? qty * rate : sv

      await updateSale.mutateAsync({
        id: entityId(target),
        data: {
          quantity: qty,
          rate: rate,
          salesValue: computedSv,
          paymentAmount: pa,
          payerName: form.payer_name.trim() || undefined,
          bank: form.bank.trim() || undefined,
          dateOfPayment: form.date_of_payment || undefined,
          remarks: form.remarks.trim() || undefined,
          phoneNumber: form.phone_number.trim() || undefined,
          location: form.location.trim() || undefined,
          allocationCode: editTripCode || undefined,
          paymentMethod: target.paymentMethod || 'manual',
        },
      })

      toast.success('Entry updated')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
  }, [target, form, editTripCode, updateSale, toast, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Pencil className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Edit Entry</h2>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {target?.truckNumber} — {target?.customerName || `Customer #${target?.customerId}`}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Edit a sales ledger entry</DialogDescription>
        </DialogHeader>

        {form && target && (
          <div className="space-y-4 py-2">
            {(!toNum(target.rate) || !toNum(target.salesValue)) && (
              <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/40 rounded-lg">
                <Fuel className="size-3.5 text-warning mt-0.5 shrink-0" />
                <p className="text-xs text-warning">This entry has no rate or revenue yet — fill them in below.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Destination</Label>
                <Input value={form.location} onChange={e => setForm(f => f ? { ...f, location: e.target.value } : f)} className="h-9 text-sm" placeholder="e.g. Kano" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Quantity (L)</Label>
                <Input type="text" inputMode="decimal" value={form.quantity} onChange={e => {
                  const qty = formatWithCommas(e.target.value)
                  const r = Number(stripCommas(form.rate)) || 0
                  const q = Number(stripCommas(qty)) || 0
                  const sv = q && r ? formatWithCommas(String(q * r)) : form.sales_value
                  setForm(f => f ? { ...f, quantity: qty, sales_value: sv } : f)
                }} className="h-9 text-sm" placeholder="e.g. 33,000" />
              </div>
            </div>

            {tripCodes.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Tag className="size-3 text-muted-foreground" /> Code</Label>
                <select aria-label="Code" value={editTripCode} onChange={e => setEditTripCode(e.target.value)} className={`h-9 w-full rounded-md border bg-background px-3 py-1 text-sm ${editTripCode ? 'border-border bg-muted text-foreground font-semibold' : 'border-input'}`}>
                  <option value="">No code</option>
                  {tripCodes.map(code => (<option key={code} value={code}>{code}</option>))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Rate (₦/L)</Label>
                <Input type="text" inputMode="decimal" value={form.rate} onChange={e => {
                  const rate = formatWithCommas(e.target.value)
                  const r = Number(stripCommas(rate)) || 0
                  const q = Number(stripCommas(form.quantity)) || 0
                  const sv = q && r ? formatWithCommas(String(q * r)) : form.sales_value
                  setForm(f => f ? { ...f, rate, sales_value: sv } : f)
                }} className="h-9 text-sm" placeholder="e.g. 1,210" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Total Expected (₦)</Label>
                <Input type="text" inputMode="decimal" value={form.sales_value} onChange={e => setForm(f => f ? { ...f, sales_value: formatWithCommas(e.target.value) } : f)} className="h-9 text-sm font-semibold" placeholder="Auto-computed or manual" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Amount Paid (₦)</Label>
                <Input type="text" inputMode="decimal" value={form.payment_amount} onChange={e => setForm(f => f ? { ...f, payment_amount: formatWithCommas(e.target.value) } : f)} className="h-9 text-sm" placeholder="e.g. 5,000,000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Date of Payment</Label>
                <Input type="date" value={form.date_of_payment} onChange={e => setForm(f => f ? { ...f, date_of_payment: e.target.value } : f)} className="h-9 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Payer's Name</Label>
                <Input value={form.payer_name} onChange={e => setForm(f => f ? { ...f, payer_name: e.target.value.replace(/[0-9]/g, '') } : f)} className="h-9 text-sm" placeholder="Name only" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Phone Number</Label>
                <Input value={form.phone_number} onChange={e => setForm(f => f ? { ...f, phone_number: e.target.value } : f)} className="h-9 text-sm" placeholder="e.g. 08012345678" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Payment Bank Account</Label>
                <select
                  aria-label="Payment Bank Account"
                  value={form.bank}
                  onChange={e => setForm(f => f ? { ...f, bank: e.target.value } : f)}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm"
                >
                  <option value="">No Bank Selected / Cash</option>
                  {/* An account already on the entry but no longer active (or
                      deleted outright) is still offered, so opening an old
                      entry and saving it does not quietly blank its bank. */}
                  {form.bank && !bankOptions.some(o => bankAccountToString(o.account) === form.bank) && (
                    <option value={form.bank}>{form.bank} (on record)</option>
                  )}
                  {bankOptions.map(o => (
                    <option key={o.id} value={bankAccountToString(o.account)}>
                      {o.account.accountName} — {o.account.bankName} ({o.account.accountNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Remarks</Label>
                <Input value={form.remarks} onChange={e => setForm(f => f ? { ...f, remarks: e.target.value } : f)} className="h-9 text-sm" placeholder="e.g. Full Payment" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Delete Confirmation Dialog
// ═══════════════════════════════════════════════════════════════════════════

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { ids: string[]; loadingId?: string; mode: 'entry' | 'truck'; label: string } | null
}

export function DeleteConfirmDialog({ open, onOpenChange, target }: DeleteConfirmDialogProps) {
  const toast = useToast()
  const deleteSale = useDeleteDeliverySale()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    if (!target) return
    setDeleting(true)
    try {
      if (target.ids.length > 0) {
        await Promise.all(target.ids.map(id => deleteSale.mutateAsync(id)))
      }
      toast.success(target.mode === 'truck' ? 'Truck record deleted' : 'Entry deleted')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [target, deleteSale, toast, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="bg-destructive/10 p-2 rounded-lg">
              <Trash2 className="size-5 text-destructive" />
            </div>
            <span>Confirm Delete</span>
          </DialogTitle>
          <DialogDescription className="pt-2 text-muted-foreground">
            Are you sure you want to delete <strong>{target?.label}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-2">
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Transfer Overpayment Dialog
// ═══════════════════════════════════════════════════════════════════════════

interface TransferOverpaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The overpaid cycle the surplus is leaving. */
  source: LedgerGroup | null
  /** Every other cycle on the ledger, to choose destinations from. */
  candidates: LedgerGroup[]
}

/**
 * Move a truck's surplus onto other trucks.
 *
 * The destinations are chosen from the ledger's own groups rather than typed,
 * so a transfer can only ever land on a truck-cycle that exists. Trucks still
 * owing money are offered first and their outstanding balance shown, because
 * settling a debt is what the surplus is nearly always for — but a fully paid
 * truck is not hidden, since a customer may well want the credit sitting
 * against a specific load.
 *
 * The server recomputes the available surplus and refuses anything above it.
 * This dialog caps the inputs to the same figure so that refusal is a
 * backstop rather than the normal way of finding out.
 */
export function TransferOverpaymentDialog({
  open, onOpenChange, source, candidates,
}: TransferOverpaymentDialogProps) {
  const toast = useToast()
  const transfer = useTransferOverpayment()
  const [rows, setRows] = useState<Array<{ uid: string; key: string; amount: string }>>([])

  const available = source ? Math.abs(Math.min(source.balance, 0)) : 0

  const closeDialog = useCallback((next: boolean) => {
    if (!next) setRows([])
    onOpenChange(next)
  }, [onOpenChange])

  // Seeded with one empty destination whenever the dialog opens on a new row,
  // so it is usable without first having to work out that a row must be
  // added. Adjusted during render rather than in an effect — the same pattern
  // the rest of the app uses — so the first paint already has the row instead
  // of rendering empty and then correcting itself.
  const seedKey = open ? source?.key ?? '' : null
  const [seeded, setSeeded] = useState<string | null>(null)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setRows(seedKey === null ? [] : [{ uid: Math.random().toString(36).slice(2), key: '', amount: '' }])
  }

  const options = useMemo(() => {
    const rest = candidates.filter(c => c.key !== source?.key)
    const owing = rest.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance)
    const settled = rest.filter(c => c.balance <= 0)
    return { owing, settled }
  }, [candidates, source?.key])

  const byKey = useMemo(() => new Map(candidates.map(c => [c.key, c])), [candidates])

  const allocated = rows.reduce((s, r) => s + (Number(stripCommas(r.amount)) || 0), 0)
  const left = Math.round((available - allocated) * 100) / 100

  const setRow = (uid: string, patch: Partial<{ key: string; amount: string }>) =>
    setRows(prev => prev.map(r => (r.uid === uid ? { ...r, ...patch } : r)))

  const handleSave = async () => {
    if (!source) return
    const chosen = rows.filter(r => r.key && Number(stripCommas(r.amount)) > 0)
    if (chosen.length === 0) { toast.error('Choose a truck and an amount to move'); return }
    if (left < -0.005) { toast.error('That is more than this truck has over'); return }

    const cycleOf = (g: LedgerGroup) => ({
      truckNumber: g.truckNumber,
      dateLoaded: g.dateLoaded,
      depotLoaded: g.depot,
      customerId: g.customerId ? Number(g.customerId) : null,
      customerName: g.customerName,
      location: g.location,
      allocationCode: g.allocationCode || undefined,
    })

    try {
      await transfer.mutateAsync({
        from: cycleOf(source),
        to: chosen.map(r => ({
          ...cycleOf(byKey.get(r.key)!),
          amount: Number(stripCommas(r.amount)),
        })),
      })
      closeDialog(false)
    } catch {
      // useTransferOverpayment already surfaced it.
    }
  }

  const label = (g: LedgerGroup) =>
    `${g.truckNumber} · ${g.customerName || 'No customer'}${g.balance > 0 ? ` — owes ${fmt(g.balance)}` : ' — settled'}`

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10">
              <ArrowLeftRight className="size-5 text-info" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Move Overpayment</h2>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {source ? `${source.truckNumber} · ${source.customerName || 'Customer pending'}` : ''}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Move a truck's surplus onto other trucks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-info/25 bg-info/5 p-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Overpaid by</p>
                <p className="mt-0.5 font-semibold text-info">{fmt(available)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Allocated</p>
                <p className="mt-0.5 font-semibold">{fmt(allocated)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Still to place</p>
                <p className={`mt-0.5 font-semibold ${left < 0 ? 'text-destructive' : left === 0 ? 'text-accent' : 'text-muted-foreground'}`}>
                  {left < 0 ? `${fmt(Math.abs(left))} over` : fmt(left)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {rows.map((row) => {
              const dest = row.key ? byKey.get(row.key) : null
              return (
                <div key={row.uid} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <NativeSelect value={row.key} onChange={e => setRow(row.uid, { key: e.target.value })}>
                      <option value="">Move to which truck…</option>
                      {options.owing.length > 0 && (
                        <optgroup label="Still owing">
                          {options.owing.map(g => <option key={g.key} value={g.key}>{label(g)}</option>)}
                        </optgroup>
                      )}
                      {options.settled.length > 0 && (
                        <optgroup label="Already settled">
                          {options.settled.map(g => <option key={g.key} value={g.key}>{label(g)}</option>)}
                        </optgroup>
                      )}
                    </NativeSelect>
                    {dest && dest.balance > 0 && (
                      <button
                        type="button"
                        className="text-xs text-info hover:underline"
                        onClick={() => setRow(row.uid, {
                          // Never offer more than is actually left to place.
                          amount: formatWithCommas(String(Math.min(dest.balance, Math.max(left + (Number(stripCommas(row.amount)) || 0), 0)))),
                        })}
                      >
                        Fill its balance ({fmt(dest.balance)})
                      </button>
                    )}
                  </div>
                  <div className="w-40">
                    <Input
                      inputMode="decimal"
                      placeholder="Amount"
                      value={row.amount}
                      onChange={e => setRow(row.uid, { amount: formatWithCommas(e.target.value) })}
                    />
                  </div>
                  {rows.length > 1 && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => setRows(prev => prev.filter(r => r.uid !== row.uid))}
                      title="Remove"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              )
            })}

            <Button
              variant="outline" size="sm" className="gap-1.5"
              disabled={left <= 0}
              onClick={() => setRows(prev => [...prev, { uid: Math.random().toString(36).slice(2), key: '', amount: '' }])}
            >
              <Plus className="size-3.5" />
              Another truck
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Both trucks keep a record: this one shows the amount leaving, the other
            shows where it came from. Nothing already received is edited away.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => closeDialog(false)} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={transfer.isPending || allocated <= 0 || left < -0.005}
            className="gap-2"
          >
            {transfer.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}
            {transfer.isPending ? 'Moving…' : `Move ${allocated > 0 ? fmt(allocated) : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
