import { Truck, Warehouse } from 'lucide-react'
import { cn } from '#/lib/utils'

/**
 * How an order leaves the depot, and where it goes.
 *
 * Every list of orders carried a Location column holding the DEPOT — where
 * the product loads — and nothing at all about where it was headed or who was
 * driving. An order Soroman had undertaken to deliver to Ikeja read
 * identically to one the customer was coming to collect, on every screen the
 * desk works from.
 *
 * A line under the depot rather than a column of its own: the two answer one
 * question between them ("from where, to where"), and three already-wide
 * tables had no room for another heading.
 *
 * `deliveryAddress` is empty on pickups, on orders raised before the field
 * was asked for, and on those raised through flows that still do not ask. So
 * the fallback says the type alone rather than inventing a destination — a
 * delivery with nowhere recorded is a real state of affairs and worth seeing
 * as itself.
 */
export function OrderDestination({
  deliveryType,
  deliveryAddress,
  className,
}: {
  deliveryType?: string | null
  deliveryAddress?: string | null
  className?: string
}) {
  if (!deliveryType) return null
  const isDelivery = deliveryType === 'delivery'
  const to = (deliveryAddress || '').trim()

  return (
    <span
      className={cn(
        'mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap',
        isDelivery ? 'text-accent' : 'text-muted-foreground/70',
        className,
      )}
      title={isDelivery ? (to ? `Delivered by Soroman to ${to}` : 'Delivered by Soroman — no destination recorded') : 'Customer collects at the depot'}
    >
      {isDelivery ? <Truck className="size-3 shrink-0" /> : <Warehouse className="size-3 shrink-0" />}
      {isDelivery
        ? <span className="truncate">{to ? `To ${to}` : 'Delivery'}</span>
        : <span>Pickup</span>}
    </span>
  )
}
