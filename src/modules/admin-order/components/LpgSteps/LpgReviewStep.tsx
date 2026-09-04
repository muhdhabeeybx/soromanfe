import {
  User,
  Flame,
  Package,
  MapPin,
  DollarSign,
} from 'lucide-react'
import type { LpgOrderWizardReturn } from '../../hooks/useLpgOrderWizard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

interface LpgReviewStepProps {
  wizard: LpgOrderWizardReturn
}

export function LpgReviewStep({ wizard }: LpgReviewStepProps) {
  const {
    selectedCustomer,
    selectedStation,
    selectedCylinderSizeKg,
    cylinderQuantity,
    deliveryAddress,
    deliveryState,
    deliveryLga,
  } = wizard

  const totalWeightKg = (selectedCylinderSizeKg || 0) * (Number(cylinderQuantity) || 0)
  const pricePerKg = Number(selectedStation?.pricePerKg) || 0
  const subtotal = pricePerKg * totalWeightKg

  return (
    <div key="lpg-step-5" className="space-y-6 animate-fade-in">

      <div className="space-y-4">
        {/* Customer */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <User className="text-primary size-4" />
            <span className="font-semibold text-sm">Customer</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Name</span>
              <span className="font-normal">{selectedCustomer?.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Company</span>
              <span className="font-normal">{selectedCustomer?.companyName || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Phone</span>
              <PhoneLink value={selectedCustomer?.phone} className="font-normal" />
            </div>
            <div>
              <span className="text-muted-foreground block">Email</span>
              <EmailLink value={selectedCustomer?.email} className="font-normal" />
            </div>
          </div>
        </div>

        {/* Station */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="text-primary size-4" />
            <span className="font-semibold text-sm">LPG Station</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Station Name</span>
              <span className="font-normal">{selectedStation?.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Station Code</span>
              <span className="font-normal font-mono">{selectedStation?.code}</span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-muted-foreground block">Location</span>
              <span className="font-normal">{selectedStation?.address}, {selectedStation?.city}, {selectedStation?.state}</span>
            </div>
            {pricePerKg > 0 && (
              <div className="sm:col-span-2">
                <span className="text-muted-foreground block">Price Per Kg</span>
                <span className="font-semibold text-primary">{formatCurrency(pricePerKg)} / Kg</span>
              </div>
            )}
          </div>
        </div>

        {/* Cylinder */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Package className="text-primary size-4" />
            <span className="font-semibold text-sm">Cylinder Details</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Cylinder Size</span>
              <span className="font-semibold text-lg text-foreground">{selectedCylinderSizeKg} Kg</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Quantity</span>
              <span className="font-semibold text-lg text-foreground">{Number(cylinderQuantity).toLocaleString()} cylinder{Number(cylinderQuantity) > 1 ? 's' : ''}</span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-muted-foreground block">Total Weight</span>
              <span className="font-semibold text-foreground">{totalWeightKg.toLocaleString()} Kg</span>
            </div>
          </div>
          {pricePerKg > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
              <div className="flex items-center gap-1.5 text-xs">
                <DollarSign className="size-3 text-primary" />
                <span className="text-muted-foreground">Price per Kg:</span>
                <span className="font-semibold text-foreground">{formatCurrency(pricePerKg)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Estimated subtotal: {formatCurrency(subtotal)} (delivery price set during review)
              </p>
            </div>
          )}
          {pricePerKg === 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Pricing will be set when the station price per Kg is configured.
            </p>
          )}
        </div>

        {/* Delivery */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="text-primary size-4" />
            <span className="font-semibold text-sm">Delivery Location</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground block">Address</span>
            <span className="font-normal">{deliveryAddress}</span>
            {(deliveryState || deliveryLga) && (
              <p className="text-muted-foreground mt-1">
                {deliveryState}{deliveryLga ? `, ${deliveryLga}` : ''}
              </p>
            )}
          </div>
        </div>

        {/* Notice */}
        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
          <p className="text-sm text-primary">
            <strong>Note:</strong> Once submitted, the customer will receive an email and SMS confirming that their order request has been received and is under review. They will be notified again once the request is approved with pricing details.
          </p>
        </div>
      </div>
    </div>
  )
}
