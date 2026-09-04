import {
  AlertCircle,
  User,
  MapPin,
  Package,
  Truck,
  Warehouse,
  CircleDollarSign,
} from 'lucide-react'
import { formatCurrency } from '../utils/formatters'
import type { OrderWizardReturn } from '../hooks/useOrderWizard'
import { PhoneLink } from '#/components/ContactLink'

interface ReviewStepProps {
  wizard: OrderWizardReturn
}

/**
 * The order recap. Reads only — nothing here is a jump-to target, since the
 * form it summarises sits directly above it on the same page. To change
 * anything, scroll up and edit it there.
 */
export function ReviewStep({ wizard }: ReviewStepProps) {
  const {
    selectedCustomer,
    orderCompanyName,
    selectedDepot,
    selectedProduct,
    orderQuantity,
    deliveryType,
  } = wizard

  return (
    <div key="step-5" className="space-y-6 animate-fade-in">

      {/* Customer Section */}
      <div className="border rounded-xl divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <User className="size-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Customer</span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Customer Name</span>
            <span className="font-semibold text-foreground">{selectedCustomer?.name}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Buying For Company</span>
            <span className="font-semibold text-foreground">{orderCompanyName}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Phone</span>
            <PhoneLink value={selectedCustomer?.phone} className="font-semibold text-foreground" />
          </div>
        </div>
        {(selectedCustomer?.balance || 0) < 0 && (
          <div className="px-4 py-2 bg-destructive/5 flex items-center gap-2">
            <AlertCircle className="size-3.5 text-destructive" />
            <span className="text-xs text-destructive font-normal">Customer has a negative balance of {formatCurrency(selectedCustomer.balance)}</span>
          </div>
        )}
      </div>

      {/* Location Section */}
      <div className="border rounded-xl divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Location & Depot</span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Depot</span>
            <span className="font-semibold text-foreground">{selectedDepot?.name}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Depot Code</span>
            <span className="font-semibold text-foreground font-mono">{selectedDepot?.code}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">State</span>
            <span className="font-semibold text-foreground">{selectedDepot?.state}</span>
          </div>
        </div>
      </div>

      {/* Product Section */}
      <div className="border rounded-xl divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Product & Quantity</span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Product</span>
            <span className="font-semibold text-foreground">{selectedProduct?.product?.name}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">SKU</span>
            <span className="font-semibold text-foreground font-mono">{selectedProduct?.product?.sku}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Order Volume</span>
            <span className="font-semibold text-foreground">{Number(orderQuantity).toLocaleString()} {selectedProduct?.product?.unit || 'Liters'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Unit Price</span>
            <span className="font-semibold text-foreground">{formatCurrency(selectedProduct?.currentPrice)}</span>
          </div>
        </div>
      </div>

      {/* Delivery Section */}
      <div className="border rounded-xl divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <Truck className="size-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Loading Method</span>
        </div>
        <div className="p-4 text-sm">
          <div className="flex items-center gap-2">
            {deliveryType === 'pickup' ? <Warehouse className="size-4 text-primary" /> : <Truck className="size-4 text-primary" />}
            <span className="font-semibold text-foreground capitalize">{deliveryType === 'pickup' ? 'Depot Pickup' : 'Soroman Delivery'}</span>
          </div>
        </div>
      </div>

      {/* Total Amount */}
      <div className="p-5 border-2 border-primary/20 rounded-xl bg-primary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="size-5 text-primary" />
            <span className="font-semibold text-foreground">Total Amount Due</span>
          </div>
          <span className="text-2xl font-semibold text-primary">
            {formatCurrency(Number(orderQuantity) * selectedProduct?.currentPrice)}
          </span>
        </div>
      </div>
    </div>
  )
}
