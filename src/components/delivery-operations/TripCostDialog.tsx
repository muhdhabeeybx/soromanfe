import { useEffect, useMemo, useState } from 'react'
import { Loader2, Calculator, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '#/components/ui/dialog'
import { useSetTripCosts } from '#/lib/hooks/useDeliveryInventory'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'

/**
 * What a trip cost, entered once — for one truck or for a dozen.
 *
 * One dialog for both, because the figures and their arithmetic are identical
 * and two dialogs would be two places for the rounding to drift. What changes
 * between them is only what is said about the effect: editing one truck shows
 * its own margin working out live; applying to twelve says so plainly and
 * warns before overwriting any that were already costed by hand.
 *
 * ── Four inputs, five results ─────────────────────────────────────────────
 *
 * Only diesel litres, diesel price, feeding and product price are stored. AGO
 * value, total expenses, cost per litre, landing cost and margin all follow,
 * and are recomputed wherever they are read — a saved total would go stale the
 * moment a price was corrected.
 */

export interface CostableTruck {
  id: number
  truckNumber?: string | null
  quantityAllocated?: number | null
  rate?: number | string | null
  agoLitres?: number | null
  agoPrice?: number | null
  feedingAllowance?: number | null
  productPrice?: number | null
  costed?: boolean
}

const num = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const show = (n: number | null, suffix = '') =>
  n === null ? '—' : `${naira(n)}${suffix}`

export function TripCostDialog({
  open, onOpenChange, trucks,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** One truck edits it; several apply the same figures to all of them. */
  trucks: CostableTruck[]
}) {
  const save = useSetTripCosts()
  const bulk = trucks.length > 1
  const one = trucks.length === 1 ? trucks[0] : null

  const [agoLitres, setAgoLitres] = useState('')
  const [agoPrice, setAgoPrice] = useState('')
  const [feeding, setFeeding] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [clearBlank, setClearBlank] = useState(false)

  /**
   * A single truck's dialog opens on its own figures; a bulk one opens empty.
   *
   * Prefilling a bulk form from the first truck would make one truck's diesel
   * look like the batch's, and the first click would quietly spread it.
   */
  useEffect(() => {
    if (!open) return
    setClearBlank(false)
    if (one) {
      setAgoLitres(one.agoLitres != null ? String(one.agoLitres) : '')
      setAgoPrice(one.agoPrice != null ? String(one.agoPrice) : '')
      setFeeding(one.feedingAllowance != null ? String(one.feedingAllowance) : '')
      setProductPrice(one.productPrice != null ? String(one.productPrice) : '')
    } else {
      setAgoLitres(''); setAgoPrice(''); setFeeding(''); setProductPrice('')
    }
  }, [open, one])

  /**
   * The arithmetic, shown while it is typed.
   *
   * Mirrors lib/tripCosts.js on the server, which is the authority — this is a
   * preview so the person entering can see a wrong digit before saving, not a
   * second source of truth. Null propagates the same way: an unknown input
   * gives an unknown result rather than a flattering zero.
   */
  const preview = useMemo(() => {
    const l = num(agoLitres)
    const p = num(agoPrice)
    const f = num(feeding)
    const pp = num(productPrice)
    const qty = Number(one?.quantityAllocated ?? 0)
    const rate = one?.rate == null ? null : Number(one.rate)

    const agoValue = l !== null && p !== null ? l * p : null
    const total = agoValue === null && f === null ? null : (agoValue ?? 0) + (f ?? 0)
    const cpl = total !== null && qty > 0 ? total / qty : null
    const landing = cpl === null && pp === null ? null : (cpl ?? 0) + (pp ?? 0)
    const margin = rate !== null && cpl !== null && pp !== null ? rate - (landing ?? 0) : null

    return { agoValue, total, cpl, landing, margin, marginValue: margin !== null && qty ? margin * qty : null }
  }, [agoLitres, agoPrice, feeding, productPrice, one])

  const entered = [agoLitres, agoPrice, feeding, productPrice].some((v) => v.trim() !== '')
  const alreadyCosted = bulk ? trucks.filter((t) => t.costed).length : 0

  const submit = () => {
    save.mutate(
      {
        ids: trucks.map((t) => t.id),
        agoLitres: num(agoLitres),
        agoPrice: num(agoPrice),
        feedingAllowance: num(feeding),
        productPrice: num(productPrice),
        clearBlank,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {bulk ? `Trip costs for ${trucks.length} trucks` : `Trip costs — ${one?.truckNumber || 'truck'}`}
          </DialogTitle>
          <DialogDescription>
            {bulk
              ? 'The same figures applied to every truck ticked. Leave a field blank to leave it as it is.'
              : `${Number(one?.quantityAllocated ?? 0).toLocaleString('en-NG')} litres loaded${one?.rate ? ` · sold at ${naira(Number(one.rate))}` : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ago-litres">AGO given (litres)</Label>
              <Input
                id="ago-litres" inputMode="decimal" value={agoLitres}
                onChange={(e) => setAgoLitres(e.target.value)} placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ago-price">AGO price (₦ per litre)</Label>
              <Input
                id="ago-price" inputMode="decimal" value={agoPrice}
                onChange={(e) => setAgoPrice(e.target.value)} placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feeding">Feeding allowance (₦)</Label>
              <Input
                id="feeding" inputMode="decimal" value={feeding}
                onChange={(e) => setFeeding(e.target.value)} placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-price">Product price (₦ per litre)</Label>
              <Input
                id="product-price" inputMode="decimal" value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)} placeholder="0"
              />
            </div>
          </div>

          {/* The working, live. A wrong digit is far easier to catch against a
              margin than against the four numbers that produced it. */}
          {!bulk && (
            <div className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
              <p className={cn(MICRO, 'mb-2 flex items-center gap-1.5 text-muted-foreground')}>
                <Calculator className="size-3" />
                Works out to
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <Row label="AGO value" value={show(preview.agoValue)} />
                <Row label="Total expenses" value={show(preview.total)} />
                <Row label="Cost per litre" value={show(preview.cpl)} />
                <Row label="Landing cost" value={show(preview.landing)} />
                <Row
                  label="Margin per litre"
                  value={show(preview.margin)}
                  tone={preview.margin === null ? undefined : preview.margin >= 0 ? 'good' : 'bad'}
                />
                <Row
                  label="Margin on load"
                  value={show(preview.marginValue)}
                  tone={preview.marginValue === null ? undefined : preview.marginValue >= 0 ? 'good' : 'bad'}
                />
              </dl>
              {preview.margin === null && entered && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  A margin needs the product price and a selling rate on the row. Until both are
                  there it stays blank rather than showing the whole rate as profit.
                </p>
              )}
            </div>
          )}

          {bulk && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={clearBlank}
                  onCheckedChange={(v: boolean | 'indeterminate') => setClearBlank(v === true)}
                  className="mt-0.5"
                />
                <span className="text-muted-foreground">
                  Treat a blank field as <span className="font-medium text-foreground">clear it</span>,
                  not <span className="font-medium text-foreground">leave it</span>. Use this to undo a
                  bulk entry made by mistake.
                </span>
              </label>

              {alreadyCosted > 0 && !clearBlank && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span>
                    {alreadyCosted} of these {trucks.length} already {alreadyCosted === 1 ? 'has' : 'have'}{' '}
                    costs entered. Whatever you fill in below replaces theirs.
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {bulk ? `${trucks.length} trucks selected` : one?.truckNumber || ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending || (!entered && !clearBlank)}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {bulk ? `Apply to ${trucks.length}` : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right font-medium tabular-nums',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-500',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </>
  )
}
