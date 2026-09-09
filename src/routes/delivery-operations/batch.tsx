import { useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import { DeliveryBatchPanel } from '#/components/DeliveryBatchPanel'
import { useCreatePfi, usePfiDetail, useDepotsForFilter } from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
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
 * Create a delivery batch, then say where it may be sold and what carried it.
 *
 * A delivery allocation is a PFI — the same table, the same finance report
 * line, the same expense chart — so this creates one with pfi_type
 * 'delivery' rather than inventing a parallel record. What makes it a
 * delivery batch is the two things a cargo has no use for: an allowlist of
 * depots that may sell from it, and a manifest of what each truck loaded.
 *
 * ── Why creation comes first, in its own step ──────────────────────────────
 *
 * Locations and trucks both hang off a PFI id, and there is no id until the
 * batch exists. Collecting all three on one form would mean holding a
 * manifest in memory and replaying it after the create succeeded — and
 * failing halfway would lose it. So the batch is created with the little it
 * needs, and everything else is edited against a row that already exists and
 * saves on its own.
 *
 * The quantity is deliberately absent from this form. It is not typed; it is
 * the sum of what the trucks loaded, and it appears once there is a manifest.
 */
function DeliveryBatchPage() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()

  const { data: depots = [] } = useDepotsForFilter()
  const { data: productData } = useProductList()
  const products = productData?.products ?? productData ?? []

  const createPfi = useCreatePfi()
  // usePfiDetail answers with the batch plus its expenses, movements and
  // orders; only the batch itself is wanted here.
  const { data: detail, isLoading } = usePfiDetail(id ?? null)
  const pfi = detail?.pfi

  const [pfiNumber, setPfiNumber] = useState('')
  const [depotId, setDepotId] = useState('')
  const [productId, setProductId] = useState('')
  const [description, setDescription] = useState('')

  const canCreate = pfiNumber.trim().length > 0 && depotId !== '' && !createPfi.isPending

  const create = async () => {
    const res = await createPfi.mutateAsync({
      pfiNumber: pfiNumber.trim(),
      pfiType: 'delivery',
      locationId: Number(depotId),
      productId: productId ? Number(productId) : undefined,
      description: description.trim(),
      // Zero until the manifest says otherwise. See the note above.
      startingQtyLitres: 0,
    })
    const created = res?.data?.pfi ?? res?.data
    if (created?.id) {
      navigate({ to: '/delivery-operations/batch', search: { id: Number(created.id) } })
    }
  }

  const heading = id ? (pfi?.pfiNumber || 'Delivery batch') : 'New delivery batch'

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Delivery Inventory"
        title={heading}
        description={
          id
            ? 'Where this batch may be sold, and what each truck actually carried.'
            : 'A delivery batch is a PFI. Name it and say where it loads, then add its locations and trucks.'
        }
        actions={
          <Link to="/delivery-operations">
            <Button variant="outline">
              <ArrowLeft data-icon="inline-start" />
              Back to inventory
            </Button>
          </Link>
        }
      />

      {!id ? (
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>The batch</span>
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-4 sm:grid-cols-2')}>
            <div className="space-y-1.5">
              <Label htmlFor="pfiNumber">Batch name</Label>
              <Input
                id="pfiNumber"
                value={pfiNumber}
                onChange={(e) => setPfiNumber(e.target.value)}
                placeholder="PFI-25C"
              />
              <p className={cn(MICRO, 'text-muted-foreground')}>
                Whatever the desk calls it. It is the PFI number, so it appears under this name
                everywhere a batch does.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="depot">Loaded from</Label>
              <NativeSelect id="depot" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value="">Select the depot it loads at…</option>
                {depots.map((d) => (
                  <option key={String(d.id ?? d._id)} value={String(d.id ?? d._id)}>{d.name}</option>
                ))}
              </NativeSelect>
              <p className={cn(MICRO, 'text-muted-foreground')}>
                Where the trucks load. Which locations may sell from it comes next.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="product">Product</Label>
              <NativeSelect id="product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {(products as Array<{ id?: number | string; _id?: string; name: string }>).map((p) => (
                  <option key={String(p.id ?? p._id)} value={String(p.id ?? p._id)}>{p.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Note</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="sm:col-span-2 flex items-center justify-between gap-3 border-t border-foreground/10 pt-4">
              {/* Said plainly, because a form with no quantity field on it
                  otherwise reads as one that is missing something. */}
              <p className="text-xs text-muted-foreground">
                No quantity here — a delivery batch is worth what its trucks loaded, so it is
                filled in by the manifest on the next step.
              </p>
              <Button disabled={!canCreate} onClick={create}>
                {createPfi.isPending && <Loader2 className="animate-spin" />}
                Create batch
              </Button>
            </div>
          </div>
        </section>
      ) : isLoading ? (
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
