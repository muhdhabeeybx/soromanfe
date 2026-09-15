import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { PageEmpty } from '#/components/PageEmpty'
import { MICRO, PANEL, PANEL_RAIL } from '#/lib/panel'
import { cn } from '#/lib/utils'
import type { TruckLoad } from '#/lib/hooks/useTickets'
import {
  useOrderLookup, OrderSearch, TruckCard, GateDialog, useGateAction, localNow, gateTime,
} from './-security-shared'
import { routeGuard } from '#/lib/route-guard'
import { GateQueue, type GateTruck } from './-gate-queue'

export const Route = createFileRoute('/security/entry')({
  beforeLoad: () => routeGuard('/security/entry'),
  component: SecurityEntryPage,
})

function SecurityEntryPage() {
  const lookup = useOrderLookup()
  const { picked, order, loads } = lookup
  const unit = order?.productUnit || 'Litres'

  const [target, setTarget] = useState<TruckLoad | null>(null)
  const [enteredAt, setEnteredAt] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const { run, pending } = useGateAction(picked?.id)

  const openFor = (load: TruckLoad) => {
    setTarget(load)
    setEnteredAt(localNow())
    // Prefilled from the booking, but editable — the officer records who
    // actually turned up.
    setDriverName(load.driverName || '')
    setDriverPhone(load.driverPhone || '')
  }

  const submit = async () => {
    if (!target || !picked) return
    const ok = await run(
      `/orders/${picked.id}/gate-in`,
      { loadId: target.id, enteredAt, driverName, driverPhone },
      `Truck ${target.truckIndex} entered`,
    )
    if (ok) setTarget(null)
  }

  const awaiting = loads.filter((l) => !l.securityEnteredAt)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Security"
        title="Gate entry"
        description="Find the order, then record each truck as it arrives at the gate."
      />

      {/* OrderSearch renders its own panel — wrapping it again double-borders. */}
      <OrderSearch {...lookup} placeholder="Search by order reference, truck, or customer…" />

      {/* The queue, when nothing is picked. Searching is right when the
          paperwork is in hand; this is right when a truck has just pulled up
          and the officer has a plate and nothing else. Hidden once an order is
          open so the page is about that order. */}
      {!picked && (
        <GateQueue
          stage="entry"
          onPick={(t: GateTruck) => lookup.setPicked({ id: t.orderId, orderNumber: t.orderNumber })}
        />
      )}

      {picked &&
        (loads.length === 0 ? (
          <PageEmpty
            title="No tickets on this order"
            description="Tickets are generated at the loading desk before a truck can be cleared."
          />
        ) : (
          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={cn(MICRO, 'text-muted-foreground')}>
                {loads.length} truck{loads.length === 1 ? '' : 's'}
              </span>
              <span className="text-sm text-muted-foreground">{awaiting.length} awaiting entry</span>
            </div>
            <div className="space-y-3 p-4">
              {loads.map((l) => (
                <TruckCard key={l.id} load={l} unit={unit}>
                  {!l.securityEnteredAt ? (
                    <Button size="sm" onClick={() => openFor(l)}>
                      <LogIn data-icon="inline-start" />
                      Confirm entry
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {gateTime(l.securityEnteredAt)}
                    </span>
                  )}
                </TruckCard>
              ))}
            </div>
          </section>
        ))}


      <GateDialog
        title={target ? `Confirm entry — Truck ${target.truckIndex}` : 'Confirm entry'}
        description={target ? `${target.truckNumber} · ${picked?.orderNumber}` : ''}
        open={target !== null}
        onOpenChange={(o) => { if (!o) setTarget(null) }}
        pending={pending}
        submitLabel="Confirm entry"
        onSubmit={submit}
        fields={[
          { key: 'entered-at', label: 'Entry time', value: enteredAt, set: setEnteredAt, type: 'datetime-local' },
          { key: 'driver-name', label: "Driver's name", value: driverName, set: setDriverName, placeholder: 'As presented at the gate' },
          { key: 'driver-phone', label: "Driver's phone", value: driverPhone, set: setDriverPhone },
        ]}
      />
    </div>
  )
}
