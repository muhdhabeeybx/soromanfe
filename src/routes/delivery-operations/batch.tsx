import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Truck } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '#/components/ui/empty'
import { DeliveryBatchPanel } from '#/components/DeliveryBatchPanel'
import { usePfiDetail } from '#/lib/hooks/usePfis'
import { routeGuard } from '#/lib/route-guard'
import { PANEL, PANEL_BODY, PANEL_RAIL, MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/delivery-operations/batch')({
  beforeLoad: () => routeGuard('/delivery-operations'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: search.id ? Number(search.id) : undefined,
  }),
  component: DeliveryBatchPage,
})

/**
 * One delivery batch: where it may be sold, and what each truck carried.
 *
 * A delivery allocation is a PFI — the same table, the same finance report
 * line, the same expense chart — so it is not a parallel record. What makes it
 * a delivery batch is the two things a cargo has no use for: an allowlist of
 * depots that may sell from it, and a manifest of what each truck loaded.
 *
 * ── This page no longer creates anything ──────────────────────────────────
 *
 * It used to, on a form that took a name and a depot and left the trucks to a
 * second step, because locations and trucks are addressed by a PFI id and
 * there is no id until the batch exists. That sequencing is real, but staging
 * it across two screens was the wrong place to solve it: it made the primary
 * action on the inventory page lead somewhere that could not finish the job.
 * Creating a batch is now one dialog on that page, and the sequencing lives in
 * useCreateDeliveryBatch. What is left here is what a batch page should be —
 * the batch as it stands, and the two things about it that are edited after
 * the fact.
 *
 * The quantity is deliberately not editable. It is not typed; it is the sum of
 * what the trucks loaded, rebuilt server-side whenever the manifest is saved.
 */
function DeliveryBatchPage() {
  const { id } = Route.useSearch()

  // usePfiDetail answers with the batch plus its expenses, movements and
  // orders; only the batch itself is wanted here.
  const { data: detail, isLoading } = usePfiDetail(id ?? null)
  const pfi = detail?.pfi

  if (id == null) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader
          eyebrow="Delivery Inventory"
          title="Delivery batch"
          description="Open a batch from the inventory to edit its locations and manifest."
        />
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia><Truck /></EmptyMedia>
            <EmptyTitle>No batch chosen</EmptyTitle>
            <EmptyDescription>
              Batches are created from the inventory page, where New Batch takes the code, the
              depot, the trucks and what each one loaded in one go.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/delivery-operations">
              <Button>
                <ArrowLeft data-icon="inline-start" />
                Back to inventory
              </Button>
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Delivery Inventory"
        title={pfi?.pfiNumber || 'Delivery batch'}
        description="Where this batch may be sold, and what each truck actually carried."
        actions={
          <div className="flex gap-2">
            <Link to="/delivery-operations">
              <Button variant="outline">
                <ArrowLeft data-icon="inline-start" />
                Back to inventory
              </Button>
            </Link>
            {/* Selling a load is a different job from recording one, and it is
                done per truck — a customer, a rate, a destination, an offload
                date. That is the allocation register, keyed by this batch's
                code. This button used to point at the old Allocate Trucks
                screen under the label "Allocate to customers", which is not
                what that screen did. */}
            {pfi?.pfiNumber && (
              <Link to="/delivery-operations/allocation-details" search={{ code: pfi.pfiNumber }}>
                <Button>
                  <Truck data-icon="inline-start" />
                  Sell these loads
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <>
          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>Batch</span>
            </div>
            <div className={cn(PANEL_BODY, 'grid gap-4 sm:grid-cols-4')}>
              <Fact label="Batch" value={pfi?.pfiNumber || '—'} />
              <Fact label="Loaded from" value={pfi?.locationName || '—'} />
              <Fact label="Product" value={pfi?.productName || '—'} />
              <Fact
                label="Quantity"
                value={`${Number(pfi?.startingQtyLitres ?? 0).toLocaleString()} ${pfi?.productUnit || 'L'}`}
                hint="From the manifest"
              />
            </div>
          </section>

          <DeliveryBatchPanel
            pfiId={id}
            productUnit={pfi?.productUnit}
            loadedAtDepotId={pfi?.locationId ?? null}
          />
        </>
      )}
    </div>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className={cn(MICRO, 'text-muted-foreground')}>{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
      {hint && <p className={cn(MICRO, 'text-muted-foreground/70')}>{hint}</p>}
    </div>
  )
}
