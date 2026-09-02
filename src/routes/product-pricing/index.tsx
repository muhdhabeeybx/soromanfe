import { useState, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { CommaInput } from '#/components/ui/comma-input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PANEL, PANEL_RAIL, MICRO } from '#/lib/panel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { Pencil, Power, Loader2, CheckCircle, Fuel, Warehouse, Eye, EyeOff, CircleSlash } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useDepots, useUpdateDepotProductPrices, useToggleDepotStatus } from '#/lib/hooks/useDepots'
import { useProductList } from '#/lib/hooks/useProducts'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/product-pricing/')({
  beforeLoad: () => routeGuard('/product-pricing'),
  component: ProductPricingPage,
})

interface ProductItem {
  id: string
  name: string
  sku?: string
  category?: string
}

/**
 * Which part of the country a depot belongs to.
 *
 * Resolved rather than read off `state`, because that column does not hold
 * one: the Warri depot's state is "Warri", Keonamex's is "Delta" and Oghara's
 * is "Oghara" — three spellings of one place. Sorting on the raw column would
 * scatter the Delta depots across three groups.
 */
const REGIONS = [
  { key: 'calabar', label: 'Calabar', match: /cross river|calabar/i },
  { key: 'lagos', label: 'Lagos', match: /lagos|apapa|ibeju|lekki/i },
  { key: 'rivers', label: 'Rivers', match: /rivers|port harcourt/i },
  { key: 'warri', label: 'Warri & Delta', match: /warri|delta|oghara/i },
] as const

/**
 * The order the desk reads these in: Calabar first, then Lagos led by Dangote
 * Refinery and AIPEC, then Rivers, then Warri. Anything that matches no region
 * falls to the end rather than being hidden.
 *
 * Both lists are here, in order, so changing the arrangement is a matter of
 * moving a line rather than unpicking a comparator.
 */
const REGION_ORDER = REGIONS.map((r) => r.key)

/** Depots that lead their region, by code. Everything else sorts by name. */
const DEPOT_PRIORITY = ['CLB', 'DRF', 'APC']

function regionOf(depot: { state?: string; city?: string }) {
  const haystack = `${depot.state ?? ''} ${depot.city ?? ''}`
  return REGIONS.find((r) => r.match.test(haystack))
}

/** Suspended depots sort below active ones, whatever their region. */
function isSuspended(status: string) {
  return status !== 'Active' && status !== 'High Capacity'
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'Active':
      return <Badge className="bg-accent/15 text-accent border-accent/20">Active</Badge>
    case 'High Capacity':
      return <Badge className="bg-warning/15 text-warning border-warning/20">High Capacity</Badge>
    case 'Maintenance':
    case 'Suspended':
      return <Badge variant="destructive">Suspended</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function ProductPricingPage() {
  // Determine if user can edit prices (super_admin, admin, or finance)
  const isReadOnly = false // allow logged-in users to manage unless restricted

  const { data: depots = [], isLoading: isLoadingDepots, isError, error, refetch } = useDepots()
  const { data: productsResponse, isLoading: isLoadingProducts } = useProductList({ productType: 'soroman' })

  /**
   * Suspended depots are hidden by default.
   *
   * Nine of the thirteen are suspended, so showing everything made the four
   * places actually trading a minority of the page.
   */
  const [showSuspended, setShowSuspended] = useState(false)

  const updatePricesMutation = useUpdateDepotProductPrices()
  const toggleStatusMutation = useToggleDepotStatus()

  const [editingDepot, setEditingDepot] = useState<any | null>(null)
  const [tempPrices, setTempPrices] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Only products that appear on the Products page (productType: soroman)
  // are shown here — depot pricing entries for other product types (e.g.
  // Dangote products) are intentionally not surfaced as pricing columns.
  const allProducts = useMemo(() => {
    const globalProducts = productsResponse?.products || []
    const list: ProductItem[] = globalProducts.map((p: any) => ({
      id: String(p.id || p._id),
      name: p.name,
      sku: p.sku,
      category: p.category,
    }))

    // Sort products logically (Petrol/PMS first, Diesel/AGO second, Kerosene/DPK third, then rest)
    return list.sort((a, b) => {
      const nameA = a.name.toLowerCase()
      const nameB = b.name.toLowerCase()
      if (nameA.includes('petrol') || nameA.includes('pms')) return -1
      if (nameB.includes('petrol') || nameB.includes('pms')) return 1
      if (nameA.includes('diesel') || nameA.includes('ago')) return -1
      if (nameB.includes('diesel') || nameB.includes('ago')) return 1
      return nameA.localeCompare(nameB)
    })
  }, [productsResponse])

  /**
   * Active first, then by region in reading order, then the region's lead
   * depots, then alphabetically. Suspended depots keep the same arrangement
   * but sit below everything active.
   */
  const orderedDepots = useMemo(() => {
    const rank = (d: any) => {
      const region = regionOf(d)
      const priority = DEPOT_PRIORITY.indexOf(d.code)
      return [
        isSuspended(d.status) ? 1 : 0,
        region ? REGION_ORDER.indexOf(region.key) : REGION_ORDER.length,
        priority === -1 ? DEPOT_PRIORITY.length : priority,
        String(d.name || '').toLowerCase(),
      ] as const
    }
    return [...depots]
      .filter((d: any) => showSuspended || !isSuspended(d.status))
      .sort((a: any, b: any) => {
        const ra = rank(a)
        const rb = rank(b)
        for (let i = 0; i < ra.length; i++) {
          if (ra[i] < rb[i]) return -1
          if (ra[i] > rb[i]) return 1
        }
        return 0
      })
  }, [depots, showSuspended])

  const suspendedCount = useMemo(
    () => depots.filter((d: any) => isSuspended(d.status)).length,
    [depots],
  )

  // Open Edit Dialog for a depot
  const openEdit = (depot: any) => {
    const prices: Record<string, string> = {}

    allProducts.forEach((prod) => {
      const existingPrice = (depot.productPrices || []).find((pp: any) => {
        const ppId = String(pp.productId || pp.product?._id || pp.product?.id)
        return ppId === prod.id || pp.productName?.toLowerCase() === prod.name.toLowerCase()
      })
      if (existingPrice) {
        // A stored 0 must come back as "0", not as blank — blank means "leave
        // alone" on save, so rendering it that way would quietly make an
        // un-priced product un-editable back to un-priced.
        prices[prod.id] = existingPrice.currentPrice == null ? '' : String(existingPrice.currentPrice)
      } else {
        prices[prod.id] = ''
      }
    })

    setTempPrices(prices)
    setEditingDepot(depot)
  }

  // Handle Save Prices
  const handleSave = async () => {
    if (!editingDepot) return
    setSaving(true)
    try {
      /**
       * Zero is a real, savable value: it is how this system records "we do
       * not sell this product at this depot", and it is what 40 of the 48
       * rows in the live table already hold.
       *
       * This used to filter zeros OUT of the payload, because the backend
       * rejected them. Combined with prices being upserted and never deleted,
       * that made taking a product off sale impossible — blank left the old
       * price untouched, and 0 was refused. Both of the things the dialog told
       * people to do did nothing.
       *
       * Blank still means "leave alone", which is the only sense it can have
       * against an upsert. Zero is the way to un-price.
       */
      const productPricesPayload = allProducts
        .filter((p) => {
          const raw = tempPrices[p.id]
          if (raw === undefined || raw.trim() === '') return false
          return Number.isFinite(parseFloat(raw))
        })
        .map((p) => ({
          product: p.id,
          currentPrice: parseFloat(tempPrices[p.id]),
        }))

      await updatePricesMutation.mutateAsync({
        depotId: editingDepot.id,
        productPrices: productPricesPayload,
      })

      setEditingDepot(null)
      setTempPrices({})
    } catch {
      // Error notification handled by mutation
    } finally {
      setSaving(false)
    }
  }

  // Handle Toggle Status
  const handleToggleStatus = (depot: any) => {
    // The backend's depot status enum is Active / Maintenance / High Capacity
    // — there is no "Suspended" value. "Maintenance" is what the "Suspend"
    // action actually sets; getStatusBadge displays it as "Suspended".
    const newStatus = depot.status === 'Active' ? 'Maintenance' : 'Active'
    toggleStatusMutation.mutate({ depotId: depot.id, status: newStatus })
  }

  const isLoading = isLoadingDepots || isLoadingProducts

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Operations"
        title="Depot Product Pricing"
        description="Current selling price per product at each depot hub."
      />

      {isLoading ? (
        <PageLoader message="Loading depot product prices..." />
      ) : isError ? (
        <PageError message={(error as any)?.message || 'Failed to load depots'} onRetry={() => refetch()} />
      ) : depots.length === 0 ? (
        <PageEmpty
          icon={<Warehouse className="size-8 text-muted-foreground" />}
          title="No depots configured"
          description="Create depots in the Depots module first."
        />
      ) : (
        /**
         * A matrix: one row per depot, one column per product.
         *
         * This was a grid of cards, each repeating the product list down its
         * own body. The question this page exists to answer — what does PMS
         * cost across our depots, and where is it not sold — could not be read
         * off it at all: you had to open every card and hold the numbers in
         * your head. A row per depot puts the comparison on one axis and the
         * products on the other, which is the shape of the data.
         */
        <div className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>
              {orderedDepots.length} depot{orderedDepots.length === 1 ? '' : 's'} ·{' '}
              {allProducts.length} product{allProducts.length === 1 ? '' : 's'} · price per unit
            </span>
            {suspendedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground"
                onClick={() => setShowSuspended((v) => !v)}
              >
                {showSuspended ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showSuspended ? 'Hide' : 'Show'} {suspendedCount} suspended
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[13rem]">Depot</TableHead>
                  <TableHead>Status</TableHead>
                  {allProducts.map((prod) => (
                    <TableHead key={prod.id} className="text-right whitespace-nowrap">
                      {prod.name}
                    </TableHead>
                  ))}
                  {!isReadOnly && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedDepots.map((depot: any) => {
                  // Lookup by product id, falling back to name for rows that
                  // predate the id being carried on the price record.
                  const priceMap = new Map<string, number>()
                  ;(depot.productPrices || []).forEach((pp: any) => {
                    const pid = String(pp.productId || pp.product?._id || pp.product?.id)
                    priceMap.set(pid, pp.currentPrice)
                    if (pp.productName) priceMap.set(pp.productName.toLowerCase(), pp.currentPrice)
                  })

                  return (
                    <TableRow
                      key={depot.id}
                      // The whole row opens the editor — the Edit button is
                      // still there for anyone looking for one, and the
                      // actions cell stops the click so Suspend never fires
                      // the dialog behind it.
                      className={cn(!isReadOnly && 'cursor-pointer')}
                      onClick={!isReadOnly ? () => openEdit(depot) : undefined}
                    >
                      <TableCell>
                        <div className="font-medium">{depot.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[depot.code, [depot.city, depot.state].filter(Boolean).join(', ')]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(depot.status)}</TableCell>

                      {allProducts.map((prod) => {
                        const raw = priceMap.get(prod.id) ?? priceMap.get(prod.name.toLowerCase())
                        const price = Number(raw)
                        const isSet = raw !== undefined && raw !== null && !isNaN(price)
                        // Zero is not a missing price, it is a decision: this
                        // depot does not sell this product. Said plainly, and
                        // differently from "nobody has set one yet".
                        const notSold = isSet && price === 0

                        return (
                          <TableCell key={prod.id} className="text-right whitespace-nowrap">
                            {!isSet ? (
                              <span className="text-xs text-muted-foreground/50 italic">Not set</span>
                            ) : notSold ? (
                              <span className="text-xs text-muted-foreground">Not sold here</span>
                            ) : (
                              <span className="font-mono text-sm font-semibold">
                                ₦{price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                              </span>
                            )}
                          </TableCell>
                        )
                      })}

                      {!isReadOnly && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(depot)}>
                              <Pencil data-icon="inline-start" />
                              Edit prices
                            </Button>
                            {/* Spelled out, both states. It was a bare power
                                icon, so what it would do — and to what — was
                                a guess until you clicked it. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'gap-1.5 whitespace-nowrap',
                                depot.status === 'Active'
                                  ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                                  : 'text-accent hover:bg-accent/10 hover:text-accent',
                              )}
                              onClick={() => handleToggleStatus(depot)}
                            >
                              <Power className="size-3.5" />
                              {depot.status === 'Active' ? 'Suspend location' : 'Activate location'}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Edit Prices Modal Dialog */}
      <Dialog
        open={!!editingDepot}
        onOpenChange={(open) => {
          if (!open) {
            setEditingDepot(null)
            setTempPrices({})
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Fuel className="size-5 text-primary" />
              Edit Depot Prices — {editingDepot?.name}
            </DialogTitle>
            <DialogDescription>
              Set the selling price per unit at this depot. Enter <strong>0</strong> for a
              product you do not sell here — it will not appear in the catalogue and cannot be
              ordered. Leaving a box blank keeps whatever price is already set.
            </DialogDescription>
          </DialogHeader>

          {editingDepot && (
            <div className="space-y-4 py-3 max-h-[60svh] overflow-y-auto pr-1">
              {/* Taking a whole depot off sale in one action. Thirteen products
                  typed to 0 by hand is thirteen chances to miss one, and a
                  missed one leaves the depot quietly still selling it. Fills
                  the boxes rather than saving — nothing moves until Save, so a
                  mis-click is undone by closing the dialog. */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-foreground/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Not selling anything at this depot?
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 whitespace-nowrap"
                  onClick={() =>
                    setTempPrices(Object.fromEntries(allProducts.map((p) => [p.id, '0'])))
                  }
                >
                  <CircleSlash className="size-3.5" />
                  Set all to 0
                </Button>
              </div>

              {allProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/20">
                  <div>
                    <Label className="text-sm font-semibold text-foreground">{product.name}</Label>
                    {product.sku && (
                      <span className="block text-xs text-muted-foreground font-mono">
                        SKU: {product.sku}
                      </span>
                    )}
                  </div>

                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono font-normal">
                      ₦
                    </span>
                    <CommaInput
                      className="pl-8 h-10 text-right font-mono font-semibold text-base"
                      placeholder="Not priced"
                      value={tempPrices[product.id] ?? ''}
                      onValueChange={(val) =>
                        setTempPrices((prev) => ({ ...prev, [product.id]: val }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
            <Button
              variant="outline"
              onClick={() => {
                setEditingDepot(null)
                setTempPrices({})
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
              {saving ? 'Saving…' : 'Save Prices'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
