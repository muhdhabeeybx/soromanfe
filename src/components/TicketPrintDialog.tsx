import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Printer, Loader2, Layers, ArrowLeft, Pencil, Truck, Check, LogIn, LogOut, Ticket,
} from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { WaybillSheet } from '#/components/WaybillSheet'
import api from '#/lib/api/http'
import { useTicketPrintData, type TruckLoad } from '#/lib/hooks/useTickets'

const STATUS_LABEL: Record<TruckLoad['status'], string> = {
  pending: 'Not gated in',
  gated_in: 'At the gate',
  loaded: 'Loaded',
  gated_out: 'Departed',
}
const STATUS_TONE: Record<TruckLoad['status'], string> = {
  pending: 'bg-muted text-foreground',
  gated_in: 'bg-info/15 text-info',
  loaded: 'bg-accent/15 text-accent',
  gated_out: 'bg-success/15 text-success',
}

/**
 * The four stages a truck passes through, in order.
 *
 * Ticketed is a stage, not a precondition: a truck that has been written but
 * has not reached the gate is somewhere, and a list that only marks the last
 * three leaves it looking like nothing has happened to it at all.
 */
const STAGES = [
  { key: 'pending', label: 'Ticketed', icon: Ticket, bar: 'bg-muted-foreground/30' },
  { key: 'gated_in', label: 'At gate', icon: LogIn, bar: 'bg-info' },
  { key: 'loaded', label: 'Loaded', icon: Truck, bar: 'bg-accent' },
  { key: 'gated_out', label: 'Departed', icon: LogOut, bar: 'bg-success' },
] as const

const stageIndex = (status: TruckLoad['status']) => STAGES.findIndex((s) => s.key === status)

const qty = (v: unknown) => Number(v || 0).toLocaleString('en-NG')

/** "14:32" on the day, "12 Sep 14:32" once it is not today. */
const when = (v?: string | null) => {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('en-NG', today
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Where the whole order has got to, above the list of its trucks.
 *
 * The list could only be read by counting badges. What an order actually needs
 * to answer is how much of it has left — so the bar is weighted by LITRES, not
 * by truck count: three 15,000s departed out of six trucks is not half the
 * order gone when the other three are 45,000s.
 */
function OrderProgress({ loads }: { loads: TruckLoad[] }) {
  const total = loads.reduce((s, l) => s + Number(l.quantity || 0), 0)
  const byStage = STAGES.map((stage) => {
    const at = loads.filter((l) => l.status === stage.key)
    return {
      ...stage,
      trucks: at.length,
      litres: at.reduce((s, l) => s + Number(l.quantity || 0), 0),
    }
  })
  const out = byStage[3]

  return (
    <div className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {out.trucks} of {loads.length} truck{loads.length === 1 ? '' : 's'} departed
        </p>
        <p className="text-xs text-muted-foreground">
          {qty(out.litres)} of {qty(total)} litres out
        </p>
      </div>

      {/* Weighted by litres, so the bar means what it looks like it means. */}
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
        {byStage.map((s) => (
          s.litres > 0 && (
            <div
              key={s.key}
              className={s.bar}
              style={{ width: `${(s.litres / (total || 1)) * 100}%` }}
              title={`${s.label}: ${s.trucks} truck${s.trucks === 1 ? '' : 's'}, ${qty(s.litres)} litres`}
            />
          )
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {byStage.map((s) => (
          <span
            key={s.key}
            className={`flex items-center gap-1.5 text-xs ${s.trucks ? 'text-foreground' : 'text-muted-foreground/50'}`}
          >
            <span className={`size-1.5 rounded-full ${s.trucks ? s.bar : 'bg-muted-foreground/20'}`} />
            {s.label}
            <span className="font-semibold">{s.trucks}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * The sheet at its true A4 shape, scaled to whatever room the dialog has.
 *
 * The preview used to be scale-[0.62] with the overflow clipped — a constant
 * that suited one window width, so the sheet was cut off at the foot on a
 * narrow screen and left a band of dead space on a wide one. Measuring the
 * container and dividing by the sheet's real width means the preview is the
 * page: same proportions, same margins, just smaller.
 *
 * 210mm is 793.7px at 96dpi, which is what a browser lays a mm out as.
 */
const A4_WIDTH_PX = 793.7
const A4_HEIGHT_PX = 1122.5

function WaybillPreview({ data }: { data: React.ComponentProps<typeof WaybillSheet>['data'] }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0.86)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      if (width > 0) setScale(Math.min(1, width / A4_WIDTH_PX))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      className="overflow-hidden rounded-lg border border-foreground/15 bg-neutral-200 p-2 dark:bg-neutral-800"
    >
      {/* The outer box is given the scaled height so the container shrinks
          with the sheet — a transform alone leaves the original height behind
          as empty space. */}
      <div style={{ height: A4_HEIGHT_PX * scale }}>
        <div
          className="origin-top-left shadow-sm"
          style={{ transform: `scale(${scale})`, width: A4_WIDTH_PX }}
        >
          <WaybillSheet data={data} />
        </div>
      </div>
    </div>
  )
}

/** One truck's journey, as four dots — where it is, and what it has cleared. */
function TruckStages({ load }: { load: TruckLoad }) {
  const at = stageIndex(load.status)
  const times: Array<string | null> = [
    null,
    when(load.securityEnteredAt),
    when(load.loadedAt),
    when(load.securityExitedAt),
  ]
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const done = i < at
        const here = i === at
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <span
              className={[
                'flex size-4 items-center justify-center rounded-full text-[9px]',
                done ? 'bg-success/20 text-success'
                  : here ? `${stage.bar} text-background`
                    : 'bg-muted text-muted-foreground/40',
              ].join(' ')}
              title={times[i] ? `${stage.label} · ${times[i]}` : stage.label}
            >
              {done ? <Check className="size-2.5" /> : <stage.icon className="size-2.5" />}
            </span>
            {i < STAGES.length - 1 && (
              <span className={`h-px w-4 ${i < at ? 'bg-success/40' : 'bg-foreground/10'}`} />
            )}
          </div>
        )
      })}
      {times[at] && (
        <span className="ml-1.5 text-[10px] text-muted-foreground">{times[at]}</span>
      )}
    </div>
  )
}

/**
 * Waybill preview and printing.
 *
 * Multiple trucks land on a list first — picking straight into "truck 1 of
 * N" hid every other truck's ticket behind Print all, with no way to open
 * one specifically to reprint or correct it. A single-truck order skips the
 * list; there is nothing to choose between.
 *
 * The sheets print through a portal onto <body> rather than from inside the
 * dialog: the dialog is fixed-positioned, height-capped and scrollable, all of
 * which clip a full-page sheet. A top-level sibling has none of that, so the
 * print stylesheet only has to hide everything else.
 *
 * The same WaybillSheet renders the preview and the paper, so they cannot
 * drift apart.
 */
export function TicketPrintDialog({
  orderId,
  orderNumber,
  loads = [],
  open,
  onOpenChange,
  onEdit,
}: {
  orderId?: number | string
  orderNumber?: string
  loads?: TruckLoad[]
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Switches to the truck-details editor for this order. */
  onEdit?: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const showList = loads.length > 1 && selected === null
  const activeLoadId = selected ?? (loads.length === 1 ? loads[0].id : null)

  const { data, isLoading } = useTicketPrintData(orderId, activeLoadId)
  const [batch, setBatch] = useState<Record<string, any>[] | null>(null)
  const [preparing, setPreparing] = useState(false)

  // Only ever print what is currently mounted.
  const sheets = batch ?? (data ? [data] : [])

  useEffect(() => {
    if (!open) { setSelected(null); setBatch(null); setPreparing(false) }
  }, [open])

  /** Fetches every ticket's payload up front, then prints one continuous job. */
  const printAll = async () => {
    if (!orderId || loads.length === 0) return
    setPreparing(true)
    try {
      const payloads = await Promise.all(
        loads.map((l) =>
          api.get(`/orders/${orderId}/trucks/${l.id}/print`).then((r) => r.data.data),
        ),
      )
      setBatch(payloads)
      // Let the portal commit before handing off to the print dialog.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      window.print()
    } finally {
      setPreparing(false)
    }
  }

  const printOne = async () => {
    setBatch(null)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    window.print()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {showList ? `Trucks${orderNumber ? ` — ${orderNumber}` : ''}` : 'Waybill & payment receipt'}
            </DialogTitle>
            <DialogDescription>
              {showList
                ? `${loads.length} trucks ticketed — pick one to view, print or edit.`
                : data
                  ? `Truck ${data.truckNumber} of ${data.totalTrucks} · ${data.reference}`
                  : 'Preparing…'}
            </DialogDescription>
          </DialogHeader>

          {showList ? (
            <div className="space-y-2.5">
              <OrderProgress loads={loads} />

              <div className="space-y-1.5">
                {loads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSelected(l.id)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-foreground/15 p-3 text-left transition-colors duration-250 ease-luxe outline-none hover:bg-muted/60"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      {/* The index in the badge rather than the word "Truck":
                          "3" beside "of 6" is the thing being looked for on a
                          six-truck order, and it should be findable by
                          scanning down a column. */}
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-sm font-semibold text-muted-foreground">
                        {l.truckIndex}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {l.truckNumber || 'No plate yet'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {qty(l.quantity)} litres
                          {l.driverName ? ` · ${l.driverName}` : ''}
                        </p>
                        <TruckStages load={l} />
                      </div>
                    </div>
                    <Badge className={`${STATUS_TONE[l.status]} shrink-0`}>
                      {STATUS_LABEL[l.status]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          ) : isLoading || !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-accent" />
            </div>
          ) : (
            <WaybillPreview data={data} />
          )}

          <DialogFooter>
            {loads.length > 1 && !showList && (
              <Button variant="ghost" onClick={() => setSelected(null)}>
                <ArrowLeft data-icon="inline-start" />
                All trucks
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {loads.length > 1 && (
              <Button variant="outline" onClick={printAll} disabled={preparing}>
                {preparing ? <Loader2 className="animate-spin" /> : <Layers data-icon="inline-start" />}
                Print all {loads.length}
              </Button>
            )}
            {!showList && onEdit && (
              <Button variant="outline" onClick={onEdit} disabled={!data}>
                <Pencil data-icon="inline-start" />
                Edit
              </Button>
            )}
            {!showList && (
              <Button onClick={printOne} disabled={!data}>
                <Printer data-icon="inline-start" />
                Print
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The paper copy. One sheet per truck, each on its own page. */}
      {open && sheets.length > 0
        ? createPortal(
            <div id="ticket-print-root" className="hidden print:block">
              {sheets.map((s, i) => (
                <WaybillSheet key={`${s.reference}-${s.truckNumber}-${i}`} data={s} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
