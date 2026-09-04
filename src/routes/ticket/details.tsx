import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, 
  Warehouse, Package, Building2, MapPin, CheckSquare, Award
} from 'lucide-react'
import { useTicketDetails, useRedeemTicket } from '#/lib/hooks/useTickets'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/ticket/details')({
  beforeLoad: () => routeGuard('/ticket'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: TicketDetailsComponent,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(value)
}

function TicketDetailsComponent() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()
  const { data: ticket, isLoading } = useTicketDetails(id)
  const redeemMutation = useRedeemTicket()
  const [showRedeemDialog, setShowRedeemDialog] = useState(false)

  const handleBack = () => {
    window.history.length > 1 ? window.history.back() : navigate({ to: '/ticket' as any })
  }

  const handleRedeem = async () => {
    if (!ticket) return
    try {
      await redeemMutation.mutateAsync(ticket.ticketNumber)
      setShowRedeemDialog(false)
    } catch (err) {
      // Error handled in hook/toast
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Ticket Not Found</h2>
        <p className="text-muted-foreground max-w-sm">The requested ticket details could not be found or loaded.</p>
        <Button onClick={handleBack}><ArrowLeft className="size-4" /> Back to Tickets</Button>
      </div>
    )
  }

  const generatedDate = ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : 'N/A'

  const redeemedDate = ticket.redeemedAt ? new Date(ticket.redeemedAt).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : null

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
      eyebrow="Operations"
      title="Ticket Details"
      description="Verify and redeem pickup ticket"
      backAction={handleBack}
    />

      {/* Ticket Layout Card */}
      <div className="grid md:grid-cols-3 gap-6">

        {/* Ticket Left Column - Ticket/Receipt Design */}
        <Card className="md:col-span-2 relative overflow-hidden border-2 border-primary/20">
          <div className="bg-primary absolute top-0 left-0 w-2 h-full" />

          <CardContent className="p-6 md:p-8 space-y-6 pl-8">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-semibold text-primary uppercase bg-primary/10 px-2 py-0.5 rounded-full">Official Receipt</span>
                <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground mt-2 tracking-tight">{ticket.ticketNumber}</h2>
                <p className="text-xs text-muted-foreground mt-1">Generated on {generatedDate}</p>
              </div>
              <Badge className={ticket.status === 'Redeemed' ? 'bg-success text-success-foreground' : 'bg-primary text-primary-foreground'}>
                {ticket.status}
              </Badge>
            </div>

            {/* Visual Dotted Cutting Separator */}
            <div className="relative flex items-center py-4">
              <div className="flex-grow border-t border-dashed border-border" />
              <span className="absolute -left-11 size-6 rounded-full bg-background border-r border-border" />
              <span className="absolute -right-8 size-6 rounded-full bg-background border-l border-border" />
            </div>

            {/* Product pickup details */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 bg-muted/30 p-4 rounded-xl border border-border/50">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Product</p>
                <p className="text-base font-semibold mt-1 flex items-center gap-1.5">
                  <Package className="size-4 text-primary" />
                  {ticket.order?.product?.name || 'N/A'}
                </p>
                {ticket.order?.product?.sku && (
                  <p className="text-xs text-muted-foreground mt-0.5">SKU: {ticket.order.product.sku}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Quantity</p>
                <p className="text-base font-mono font-semibold mt-1 text-foreground">
                  {ticket.order?.quantity?.toLocaleString()} {ticket.order?.product?.unit || 'Liters'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">@ {formatCurrency(ticket.order?.price || 0)} / unit</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Fulfillment Method</p>
                <p className="text-sm font-semibold mt-1 capitalize flex items-center gap-1.5">
                  <Award className="size-3.5 text-info" />
                  {ticket.order?.deliveryType === 'delivery' ? 'Company Delivery' : 'Self Pickup'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Fulfillment Depot</p>
                <p className="text-sm font-semibold mt-1 flex items-center gap-1.5">
                  <Warehouse className="size-3.5 text-muted-foreground" />
                  {ticket.order?.depot?.name || 'N/A'}
                </p>
                {ticket.order?.depot?.code && (
                  <p className="text-xs text-muted-foreground mt-0.5">Code: {ticket.order.depot.code}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold">Fulfillment State</p>
                <p className="text-sm font-semibold mt-1 flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-primary" />
                  {ticket.order?.state || 'N/A'}
                </p>
              </div>
              {ticket.order?.pfiNumber && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-semibold">PFI reference</p>
                  <p className="text-sm font-mono font-semibold mt-1 text-foreground">
                    {ticket.order.pfiNumber || 'N/A'}
                  </p>
                </div>
              )}
            </div>

            {/* Payment Details */}
            {ticket.order?.virtualAccountNumber && (
              <div className="bg-success/5 p-4 rounded-xl border border-success/10 space-y-2">
                <h4 className="text-xs font-semibold text-success uppercase">Payment Account Details</h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Bank: </span>
                    <span className="font-semibold text-foreground">{ticket.order.virtualAccountBank}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-mono font-semibold text-foreground">{ticket.order.virtualAccountNumber}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Pricing details */}
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Order Ref</span>
              <span className="font-mono text-sm font-semibold text-primary underline cursor-pointer" onClick={() => navigate({ to: '/orders/details' as any, search: { id: ticket.order?._id || ticket.order?.id } as any })}>
                {ticket.order?.orderNumber}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Total Transaction Value</span>
              <span className="font-mono text-base font-semibold text-foreground">
                {formatCurrency(ticket.order?.totalAmount || 0)}
              </span>
            </div>

            {/* Redemption Details if already redeemed */}
            {ticket.status === 'Redeemed' && (
              <div className="bg-success/5 border border-success/20 rounded-xl p-4 space-y-2 mt-4">
                <h4 className="text-sm font-semibold text-success flex items-center gap-1.5">
                  <CheckCircle2 className="size-4" /> Ticket Redeemed
                </h4>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Redeemed At: <span className="font-semibold text-foreground">{redeemedDate || 'N/A'}</span></p>
                  {ticket.redeemedBy && (
                    <p>Redeemed By: <span className="font-semibold text-foreground">{ticket.redeemedBy.firstName} {ticket.redeemedBy.surname} (<EmailLink value={ticket.redeemedBy.email} />)</span></p>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            {ticket.status === 'Active' && (
              <div className="pt-4">
                <Button
                  size="lg"
                  className="w-full bg-success hover:bg-success-hover text-success-foreground font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  onClick={() => setShowRedeemDialog(true)}
                  disabled={redeemMutation.isPending}
                >
                  {redeemMutation.isPending ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <CheckSquare className="size-5" />
                  )}
                  Redeem Ticket & Confirm Pickup
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ticket Right Column - QR Code Display */}
        <div className="space-y-6">
          {/* ------------------------------------------------------------------
              QR PANEL — DISABLED

              The ticket QR exists only to be scanned, and scanning is off.
              To restore: uncomment this card and the blocks marked
              QR SCANNING — DISABLED in routes/ticket/index.tsx.

              <Card className="border border-border">
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-center gap-1.5">
                    <Ticket className="size-4 text-primary" /> Ticket QR Code
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center p-6 pt-2">
                  <div className="bg-white p-4 border border-border rounded-xl mb-4 w-full flex items-center justify-center max-w-[240px]">
                    <img
                      src={ticket.qrCodeDataUrl}
                      alt="Ticket QR Code"
                      className="w-full h-auto object-contain max-h-[200px]"
                    />
                  </div>
                  <p className="text-xs text-center text-muted-foreground max-w-[180px]">
                    Present this QR code to the terminal manager. Scanner validates
                    token and verifies product quantity.
                  </p>
                </CardContent>
              </Card>
          ------------------------------------------------------------------ */}

          {/* Customer info card */}
          <Card className="border border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-normal">Name</p>
                <p className="font-semibold text-foreground text-sm">{ticket.order?.customer?.name || 'N/A'}</p>
              </div>
              {ticket.order?.customer?.companyName && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-normal">Company</p>
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <Building2 className="size-3 text-muted-foreground" />
                    {ticket.order.customer.companyName}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-normal">Email</p>
                  <EmailLink value={ticket.order?.customer?.email} fallback="N/A" className="font-normal text-foreground truncate block" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-normal">Phone</p>
                  <PhoneLink value={ticket.order?.customer?.phone} fallback="N/A" className="font-normal text-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>

      <ConfirmDialog
        open={showRedeemDialog}
        onOpenChange={setShowRedeemDialog}
        title="Redeem Ticket"
        description={`Are you sure you want to redeem ticket ${ticket?.ticketNumber}? This will mark the order as Completed.`}
        confirmLabel="Redeem Ticket"
        onConfirm={handleRedeem}
        loading={redeemMutation.isPending}
      />
    </div>
  )
}
