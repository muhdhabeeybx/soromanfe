import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'

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

export const Route = createFileRoute('/security/exit')({
  beforeLoad: () => routeGuard('/security/exit'),
  component: SecurityExitPage,
})

function SecurityExitPage() {
  const lookup = useOrderLookup()
  const { picked, order, loads } = lookup
  const unit = order?.productUnit || 'Litres'

  const [target, setTarget] = useState<TruckLoad | null>(null)
  const [exitedAt, setExitedAt] = useState('')
  const [gantry, setGantry] = useState('')
  const [loaderName, setLoaderName] = useState('')
  const { run, pending } = useGateAction(picked?.id)

  const openFor = (load: TruckLoad) => {
    setTarget(load)
    setExitedAt(localNow())
    setGantry(load.gantry || '')
    setLoaderName(load.loaderName || '')
  }

  const submit = async () => {
    if (!target || !picked) return
    const ok = await run(
      `/orders/${picked.id}/trucks/${target.id}/gate-out`,
      { exitedAt, gantry, loaderName },
      `Truck ${target.truckIndex} exited`,
    )
    if (ok) setTarget(null)
  }

  const outstanding = loads.filter((l) => l.securityEnteredAt && !l.securityExitedAt)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Security"
        title="Gate exit"
        description="Clear each loaded truck off the yard, recording the arm it loaded from."
      />

      {/* OrderSearch renders its own panel — wrapping it again double-borders. */}
      <OrderSearch {...lookup} placeholder="Search by order reference, truck, or customer…" />

      {/* The yard, when nothing is picked. Searching is right when the
          paperwork is in hand; this is right when somebody wants to know what
          is still standing out there. Hidden once an order is open so the page
          is about that order. */}
      {!picked && (
        <GateQueue
          stage="exit"
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
              <span className="text-sm text-muted-foreground">
                {outstanding.length} still on the yard
              </span>
            </div>
            <div className="space-y-3 p-4">
              {loads.map((l) => {
                const entered = Boolean(l.securityEnteredAt)
                const exited = Boolean(l.securityExitedAt)
                return (
                  <TruckCard key={l.id} load={l} unit={unit}>
                    {exited ? (
                      <span className="text-xs text-muted-foreground">
                        {gateTime(l.securityExitedAt)}
                      </span>
                    ) : entered ? (
                      <Button variant="destructive" size="sm" onClick={() => openFor(l)}>
                        <LogOut data-icon="inline-start" />
                        Confirm exit
                      </Button>
                    ) : (
                      // The server enforces this too; saying so here saves a
                      // pointless round trip and a confusing 409.
                      <span className="text-xs text-muted-foreground/70">Not yet entered</span>
                    )}
                  </TruckCard>
                )
              })}
            </div>
          </section>
        ))}

      <GateDialog
        title={target ? `Confirm exit — Truck ${target.truckIndex}` : 'Confirm exit'}
        description={target ? `${target.truckNumber} · ${picked?.orderNumber}` : ''}
        open={target !== null}
        onOpenChange={(o) => { if (!o) setTarget(null) }}
        pending={pending}
        submitLabel="Confirm exit"
        onSubmit={submit}
        fields={[
          { key: 'exited-at', label: 'Exit time', value: exitedAt, set: setExitedAt, type: 'datetime-local' },
          { key: 'gantry', label: 'Arm', value: gantry, set: setGantry, placeholder: 'e.g. 3' },
          { key: 'loader-name', label: "Loader's name", value: loaderName, set: setLoaderName },
        ]}
      />
    </div>
  )
}
