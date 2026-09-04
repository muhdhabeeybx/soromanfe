import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Search, Loader2, Clock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import { useAllOrders } from '#/lib/hooks/useOrders'
import { useOrderForTicketing, type TruckLoad } from '#/lib/hooks/useTickets'
import { PhoneLink } from '#/components/ContactLink'

export const fmt = (n: unknown) => Number(n || 0).toLocaleString('en-NG')

/** Local datetime for a datetime-local input. */
export function localNow() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Order lookup.
 *
 * Security works from a single order at a time, found by reference, truck or
 * customer — never from a list, because the officer already has the paperwork
 * in hand and needs the one order in front of them.
 */
export function useOrderLookup() {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<any | null>(null)

  const { data, isLoading } = useAllOrders()
  const orders: any[] = data?.orders || []

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return orders
      .filter((o) => ['Released', 'Loading', 'Completed'].includes(String(o.status)))
      .filter((o) =>
        [o.orderNumber, o.customerName, o.customerCompanyName, o.depotName]
          .some((f) => String(f ?? '').toLowerCase().includes(q)),
      )
      .slice(0, 8)
  }, [orders, query])

  const { data: order, isFetching } = useOrderForTicketing(picked?.id ?? undefined)
  const loads: TruckLoad[] = order?.trucks || []

  return { query, setQuery, matches, picked, setPicked, order, loads, isLoading, isFetching }
}

export function OrderSearch({
  query, setQuery, matches, picked, setPicked, placeholder,
}: ReturnType<typeof useOrderLookup> & { placeholder: string }) {
  return (
    <section className={PANEL}>
      <div className={PANEL_RAIL}>
        <span className={MICRO}>Find the order</span>
        {picked && (
          <button
            type="button"
            onClick={() => { setPicked(null); setQuery('') }}
            className="text-xs text-accent underline-offset-4 outline-none hover:underline"
          >
            Search again
          </button>
        )}
      </div>
      <div className={PANEL_BODY}>
        {picked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-normal text-accent">{picked.orderNumber}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {picked.customerName} · {picked.depotName || picked.state} · {picked.productName}
              </p>
            </div>
            <span className="text-sm font-semibold">
              {fmt(picked.quantity)} {picked.productUnit || 'Litres'}
            </span>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="pl-9"
                autoFocus
              />
            </div>
            {query.trim().length >= 2 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-foreground/15">
                {matches.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No released order matches that.
                  </p>
                ) : (
                  <ul className="divide-y divide-foreground/10">
                    {matches.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(o)}
                          className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors duration-250 ease-luxe outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-normal">{o.orderNumber}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {o.customerName} · {o.depotName || o.state}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm">{fmt(o.quantity)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** A truck card. What it offers depends on where that truck is. */
export function TruckCard({
  load, unit, children,
}: {
  load: TruckLoad
  unit: string
  children?: React.ReactNode
}) {
  const entered = Boolean(load.securityEnteredAt)
  const exited = Boolean(load.securityExitedAt)

  // Once entered, show the driver who actually turned up — not the one booked.
  const driverName = entered ? load.entryDriverName || load.driverName : load.driverName
  const driverPhone = entered ? load.entryDriverPhone || load.driverPhone : load.driverPhone

  return (
    <div className={cn(PANEL, 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-normal">
            Truck {load.truckIndex} — <span className="font-mono">{load.truckNumber}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {driverName || '—'}
            {driverPhone && <> · <PhoneLink value={driverPhone} className="text-inherit" /></>}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {fmt(load.quantity)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {exited ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-xs whitespace-nowrap text-accent-foreground uppercase">
                Exited
              </span>
              {(load.gantry || load.loaderName) && (
                <span className="text-xs text-muted-foreground">
                  {[load.gantry && `Arm ${load.gantry}`, load.loaderName].filter(Boolean).join(' · ')}
                </span>
              )}
            </>
          ) : entered ? (
            <StatusChip tone="warning">Entered</StatusChip>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  )
}

/** Entry and exit share a dialog shape; only the fields differ. */
export function GateDialog({
  title, description, open, onOpenChange, fields, onSubmit, submitLabel, pending,
}: {
  title: string
  description: string
  open: boolean
  onOpenChange: (o: boolean) => void
  fields: { key: string; label: string; value: string; set: (v: string) => void; type?: string; placeholder?: string }[]
  onSubmit: () => void
  submitLabel: string
  pending: boolean
}) {
  // Every field is required — the button stays dead until all are filled.
  const ready = fields.every((f) => f.value.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label className={cn(MICRO, 'block text-muted-foreground')} htmlFor={f.key}>
                {f.label}
              </label>
              <div className="flex gap-2">
                <Input
                  id={f.key} type={f.type || 'text'} value={f.value}
                  placeholder={f.placeholder}
                  onChange={(e) => f.set(e.target.value)}
                />
                {f.type === 'datetime-local' && (
                  <Button variant="outline" size="sm" onClick={() => f.set(localNow())}>
                    <Clock data-icon="inline-start" />
                    Now
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!ready || pending}>
            {pending && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
        {!ready && (
          <p className="text-right text-xs text-muted-foreground/70">
            All fields are required
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Posts a gate action and refreshes the order. */
export function useGateAction(orderId?: number) {
  const qc = useQueryClient()
  const toast = useToast()
  const [pending, setPending] = useState(false)

  const run = async (path: string, body: Record<string, unknown>, okMessage: string) => {
    setPending(true)
    try {
      const res = await api.post(path, body)
      // The backend reports a repeat rather than erroring on it.
      const already = res.data?.data?.alreadyEntered || res.data?.data?.alreadyExited
      toast.success(already ? 'Already recorded — the original time is kept' : okMessage)
      await qc.invalidateQueries({ queryKey: ['orders', orderId, 'ticketing'] })
      await qc.invalidateQueries({ queryKey: ['orders'] })
      return true
    } catch (err) {
      toast.error(getErrorMessage(err))
      return false
    } finally {
      setPending(false)
    }
  }

  return { run, pending }
}

export const gateTime = (v?: string | null) =>
  v ? format(new Date(v), 'd MMM yyyy · HH:mm') : '—'
