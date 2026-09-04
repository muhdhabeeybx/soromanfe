import {
  User,
  ShieldPlus,
  Package,
  MapPin,
  Truck,
} from 'lucide-react'
import type { DangoteOrderWizardReturn } from '../../hooks/useDangoteOrderWizard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

interface DangoteReviewStepProps {
  wizard: DangoteOrderWizardReturn
}

export function DangoteReviewStep({ wizard }: DangoteReviewStepProps) {
  const {
    selectedCustomer,
    selectedLicense,
    selectedProduct,
    orderQuantity,
    quantityUnit,
    deliveryAddress,
    deliveryState,
    deliveryLga,
  } = wizard

  return (
    <div key="dangote-step-5" className="space-y-6 animate-fade-in">

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

        {/* Company & Licence */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <ShieldPlus className="text-primary size-4" />
            <span className="font-semibold text-sm">Company & Licence</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Company Name</span>
              <span className="font-normal">{selectedLicense?.companyName || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Licence Status</span>
              <span className="font-normal capitalize">{selectedLicense?.status || '—'}</span>
            </div>
            {selectedLicense?.expiryDate && (
              <div>
                <span className="text-muted-foreground block">Expiry Date</span>
                <span className="font-normal">{new Date(selectedLicense.expiryDate).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Product */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Package className="text-primary size-4" />
            <span className="font-semibold text-sm">Product</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Product</span>
              <span className="font-normal">{selectedProduct?.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Category</span>
              <span className="font-normal">{selectedProduct?.category}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Grade</span>
              <span className="font-normal">{selectedProduct?.gradeClass || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Supplier</span>
              <span className="font-normal">{selectedProduct?.supplier || 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* Quantity */}
        <div className="p-4 border rounded-xl bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Truck className="text-primary size-4" />
            <span className="font-semibold text-sm">Quantity</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground block">Order Quantity</span>
            <span className="font-semibold text-lg text-foreground">{Number(orderQuantity).toLocaleString()} {quantityUnit}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Pricing will be set during admin review.
          </p>
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
            <strong>Note:</strong> Once submitted, the customer will receive a notification confirming that their order request has been received and is under review. They will be notified again once the request is approved with pricing details.
          </p>
        </div>
      </div>
    </div>
  )
}
