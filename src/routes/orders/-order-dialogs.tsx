import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Check } from 'lucide-react'
import { format } from 'date-fns'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NumberInput } from '#/components/ui/number-input'
import { Label } from '#/components/ui/label'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useUpdateOrder } from '#/lib/hooks/useOrders'
import { useCustomerList } from '#/lib/hooks/useCustomers'
import { usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import type { Customer } from '#/lib/types'
import { formatNaira, formatQty, toNumber } from './-orders-utils'
import { OrderStatusBadge, PaymentBadge } from './-order-status'

// A live payment hold sits on this order's customer, and once trucks are
// allocated at release the stock reservation is a real gate action — see
// order.service.js's updateOrder for the full reasoning these mirror.
const LOCKED_STATUSES = new Set(['Completed', 'Cancelled', 'Expired'])
const STOCK_EDITABLE_STATUSES = new Set(['Pending', 'Paid'])

/** Search box + result list, picking one customer to reassign the order to. */
function CustomerPicker({
  customers, isLoading, selectedId, onSelect,
}: {
  customers: Customer[]
  isLoading: boolean
  selectedId: string
  onSelect: (c: Customer) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = !q
      ? customers.slice(0, 100)
      : customers.filter((c) =>
          [c.name, c.companyName, c.phone].some((f) => String(f || '').toLowerCase().includes(q)),
        ).slice(0, 100)
    return list
  }, [customers, query])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, company or phone…"
          className="pl-9"
          autoFocus
        />
      </div>
      <ul className="max-h-48 divide-y divide-foreground/10 overflow-y-auto rounded-lg border border-foreground/15">
        {isLoading ? (
          <li className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading customers…
          </li>
        ) : filtered.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted-foreground">No customer matches that.</li>
        ) : (
          filtered.map((c) => (
            <li key={c._id}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-250 ease-luxe outline-none hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1">
                  <p className="truncate text-sm font-normal">{c.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.companyName || 'No company'} · {formatNaira(toNumber(c.balance))}
                  </p>
                </span>
                {String(c._id) === selectedId && <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

/** A label/value pair in the read-only detail grid. */
function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={cn(MICRO, 'text-xs text-muted-foreground')}>{label}</p>
      <p className="mt-1 truncate text-sm">{value ?? '—'}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={cn(MICRO, 'mb-3 text-muted-foreground')}>{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</div>
    </div>
  )
}

export function OrderDetailsDialog({
  order,
  open,
  onOpenChange,
}: {
  order: any | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  if (!order) return null
  const qty = toNumber(order.quantity)
  const unit = order.productUnit || 'L'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{order.orderNumber || 'Order'}</DialogTitle>
          <DialogDescription>
            {order.createdAt ? format(new Date(order.createdAt), 'EEEE, d MMMM yyyy · HH:mm') : 'No date recorded'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentBadge paymentStatus={order.paymentStatus} />
        </div>

        <div className="space-y-6 pt-2">
          <Section title="Customer">
            <Row label="Name" value={order.customerName} />
            <Row label="Phone" value={order.customerPhone} />
            <Row label="Email" value={order.customerEmail} />
            <Row label="Company" value={order.companyName || order.customerCompanyName} />
            {order.customerBalance !== undefined && (
              <Row label="Wallet balance" value={<span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatNaira(toNumber(order.customerBalance))}</span>} />
            )}
          </Section>

          <Section title="Order">
            {/* <Row label="Reference" value={order.orderNumber} /> */}
            <Row label="PFI" value={order.pfiNumber} />
            <Row label="Location" value={order.depotName || order.state} />
            <Row label="Product" value={order.productName} />
            <Row label="Quantity" value={`${formatQty(qty)} ${unit}`} />
            <Row label="Unit price" value={formatNaira(toNumber(order.price))} />
            <Row label="Total" value={formatNaira(toNumber(order.totalAmount))} />
            {/* Restored. These read as raw field names — "delivery"/"pickup"
                and a bare address — which is presumably why they were turned
                off. Said the way the desk says them, and the destination only
                where there is one to give. */}
            <Row
              label="Fulfilment"
              value={order.deliveryType === 'delivery' ? 'Delivered by Soroman' : 'Customer pickup'}
            />
            {order.deliveryType === 'delivery' && (
              <Row label="Delivering to" value={(order.deliveryAddress || '').trim() || 'Not recorded'} />
            )}
          </Section>

          {(order.virtualAccountNumber || order.virtualAccountBank) && (
            <Section title="Payment">
              <Row label="Account number" value={order.virtualAccountNumber} />
              <Row label="Bank" value={order.virtualAccountBank} />
              <Row label="Account name" value={order.virtualAccountName} />
            </Section>
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edit form — everything about an order a mistake can leave wrong, short of
 * its status (that only ever moves through Release/Cancel/Pay). Reassigning
 * the customer moves the order's payment hold with it (debit the new owner,
 * refund the old one); reassigning the PFI moves its stock reservation.
 * Both are backend invariants, not just UI convenience — see
 * order.service.js's updateOrder.
 *
 * The form diffs against the original and sends only what changed.
 */
export function OrderEditDialog({
  order,
  open,
  onOpenChange,
}: {
  order: any | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const updateOrder = useUpdateOrder()
  const [form, setForm] = useState({
    date: '', time: '', quantity: '', totalAmount: '', customerId: '', pfiId: '',
  })
  const [pickingCustomer, setPickingCustomer] = useState(false)
  const [pickingPfi, setPickingPfi] = useState(false)
  const [pickedCustomerLabel, setPickedCustomerLabel] = useState('')
  const [pickedPfiLabel, setPickedPfiLabel] = useState('')

  // Both lists are heavy (thousands of customers, every PFI ever opened), so
  // they only load once the matching picker is actually opened.
  const { data: customerData, isLoading: loadingCustomers } = useCustomerList(
    { limit: 5000 }, { enabled: open && pickingCustomer },
  )
  const customers: Customer[] = useMemo(() => {
    if (!customerData) return []
    return Array.isArray(customerData) ? customerData : customerData?.customers || []
  }, [customerData])

  // Capped at 200 active PFIs — cheap enough to just fetch, unlike the
  // customer list above, and usePfiList has no conditional-fetch option.
  const { data: pfiData, isLoading: loadingPfis } = usePfiList({ limit: 200, status: 'active' })
  const pfis = pfiData?.pfis || []

  useEffect(() => {
    if (!order) return
    const d = order.createdAt ? new Date(order.createdAt) : null
    setForm({
      date: d ? format(d, 'yyyy-MM-dd') : '',
      time: d ? format(d, 'HH:mm') : '',
      quantity: String(order.quantity ?? ''),
      totalAmount: String(order.totalAmount ?? ''),
      customerId: String(order.customerId ?? ''),
      pfiId: order.pfiId ? String(order.pfiId) : '',
    })
    setPickingCustomer(false)
    setPickingPfi(false)
    setPickedCustomerLabel('')
    setPickedPfiLabel('')
  }, [order])

  if (!order) return null

  const locked = LOCKED_STATUSES.has(order.status)
  const stockEditable = STOCK_EDITABLE_STATUSES.has(order.status)

  const original = {
    date: order.createdAt ? format(new Date(order.createdAt), 'yyyy-MM-dd') : '',
    time: order.createdAt ? format(new Date(order.createdAt), 'HH:mm') : '',
    quantity: String(order.quantity ?? ''),
    totalAmount: String(order.totalAmount ?? ''),
    customerId: String(order.customerId ?? ''),
    pfiId: order.pfiId ? String(order.pfiId) : '',
  }

  const changed =
    form.date !== original.date ||
    form.time !== original.time ||
    form.quantity !== original.quantity ||
    form.totalAmount !== original.totalAmount ||
    form.customerId !== original.customerId ||
    form.pfiId !== original.pfiId

  const currentCustomerLabel = [order.companyName || order.customerCompanyName, order.customerName]
    .filter(Boolean).join(' · ') || order.customerName || '—'
  const currentPfiLabel = order.pfiNumber || 'No PFI assigned'

  const handleSave = async () => {
    // Send only what actually changed.
    const patch: Record<string, unknown> = {}
    if (form.quantity !== original.quantity) patch.quantity = Number(form.quantity)
    if (form.totalAmount !== original.totalAmount) patch.totalAmount = Number(form.totalAmount)
    if (form.date !== original.date || form.time !== original.time) {
      patch.createdAt = new Date(`${form.date}T${form.time || '00:00'}`).toISOString()
    }
    if (form.customerId !== original.customerId) patch.customerId = Number(form.customerId)
    if (form.pfiId !== original.pfiId) patch.pfiId = form.pfiId ? Number(form.pfiId) : null
    if (!Object.keys(patch).length) return onOpenChange(false)

    try {
      await updateOrder.mutateAsync({ id: String(order.id ?? order._id), data: patch })
      onOpenChange(false)
    } catch {
      // useUpdateOrder surfaces the error as a toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {order.orderNumber}</DialogTitle>
          <DialogDescription>
            Only changed fields are sent. Reassigning the customer or PFI moves the
            order's money and stock along with it.
          </DialogDescription>
        </DialogHeader>

        {locked ? (
          <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
            This order is {String(order.status).toLowerCase()} and can no longer be edited.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Customer</Label>
              {pickingCustomer ? (
                <CustomerPicker
                  customers={customers}
                  isLoading={loadingCustomers}
                  selectedId={form.customerId}
                  onSelect={(c) => {
                    setForm((f) => ({ ...f, customerId: String(c._id) }))
                    setPickedCustomerLabel([c.companyName, c.name].filter(Boolean).join(' · '))
                    setPickingCustomer(false)
                  }}
                />
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/15 bg-muted/30 p-3">
                  <p className="min-w-0 truncate text-sm">
                    {form.customerId !== original.customerId
                      ? (pickedCustomerLabel || `Customer #${form.customerId}`)
                      : currentCustomerLabel}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickingCustomer(true)}>
                    Reassign
                  </Button>
                </div>
              )}
              {form.customerId !== original.customerId && (
                <p className="text-xs leading-tight text-muted-foreground/70">
                  Moves this order's payment hold to the new customer — debited from their
                  balance, refunded to the current one.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>PFI</Label>
              {!stockEditable ? (
                <p className="rounded-lg border border-foreground/15 bg-muted/30 p-3 text-sm text-muted-foreground">
                  {currentPfiLabel} — locked once an order is released for loading.
                </p>
              ) : pickingPfi ? (
                <div className="space-y-2">
                  <ul className="max-h-48 divide-y divide-foreground/10 overflow-y-auto rounded-lg border border-foreground/15">
                    {loadingPfis ? (
                      <li className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Loading PFIs…
                      </li>
                    ) : pfis.length === 0 ? (
                      <li className="py-6 text-center text-sm text-muted-foreground">No active PFIs.</li>
                    ) : (
                      pfis.map((p: PfiWithFinancials) => {
                        const remaining = toNumber(p.startingQtyLitres) - toNumber(p.soldQtyLitres)
                        return (
                          <li key={String(p._id ?? p.id)}>
                            <button
                              type="button"
                              onClick={() => {
                                setForm((f) => ({ ...f, pfiId: String(p._id ?? p.id) }))
                                setPickedPfiLabel(p.pfiNumber)
                                setPickingPfi(false)
                              }}
                              className="flex w-full items-start justify-between gap-2.5 px-3 py-2.5 text-left transition-colors duration-250 ease-luxe outline-none hover:bg-muted/60"
                            >
                              <span className="min-w-0">
                                <p className="truncate text-sm font-normal">{p.pfiNumber}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.locationName || '—'}</p>
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatQty(remaining)} L left</span>
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPickingPfi(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/15 bg-muted/30 p-3">
                  <p className="min-w-0 truncate text-sm">
                    {form.pfiId !== original.pfiId
                      ? (pickedPfiLabel || `PFI #${form.pfiId}`)
                      : currentPfiLabel}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickingPfi(true)}>
                    Reassign
                  </Button>
                </div>
              )}
              {form.pfiId !== original.pfiId && (
                <p className="text-xs leading-tight text-muted-foreground/70">
                  Releases the reserved stock on the current PFI and reserves it on the new
                  one — refused if the new PFI doesn't have enough remaining.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="order-date">Order date</Label>
                <Input
                  id="order-date" type="date" value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-time">Time</Label>
                <Input
                  id="order-time" type="time" value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-qty">Quantity</Label>
                <NumberInput
                  id="order-qty" value={form.quantity}
                  disabled={!stockEditable}
                  onValueChange={(v) => setForm((f) => ({ ...f, quantity: v }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order-total">Total price</Label>
                <NumberInput
                  id="order-total" allowDecimal value={form.totalAmount}
                  onValueChange={(v) => setForm((f) => ({ ...f, totalAmount: v }))}
                />
              </div>
            </div>
            {!stockEditable && (
              <p className="text-xs leading-tight text-muted-foreground/70">
                Quantity is locked once an order is released for loading — the reserved
                stock is already committed to a truck by then.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateOrder.isPending}>
            Cancel
          </Button>
          {!locked && (
            <Button onClick={handleSave} disabled={!changed || updateOrder.isPending}>
              {updateOrder.isPending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          )}
        </DialogFooter>
        {!locked && !changed && (
          <p className="text-right text-xs text-muted-foreground/70">
            Nothing changed yet
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
