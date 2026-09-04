import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import {
  ArrowLeft, Loader2, AlertCircle, ShoppingBag,
  User, Warehouse, Package, MapPin,
  Calendar, Info, Phone, Mail, Building2, Truck, FileCheck, Banknote, Copy, CheckCircle, Ticket as TicketIcon, XCircle, Hourglass, Plus, RefreshCw, Send,
} from 'lucide-react'
import { useOrderDetails, useReleaseOrder, useCancelOrder } from '#/lib/hooks/useOrders'
import { OrderStatusBadge } from './-order-status'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { OrderExpiryBadge } from './-order-expiry'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/orders/details')({
  beforeLoad: () => routeGuard('/orders'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: RouteComponent,
})

const toNum = (v: string | number | undefined | null): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(value)
}

function formatAccountName(name?: string) {
  if (!name) return 'N/A';
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .join(' ');
  return `SOROMANNIGERI/ ${initials}`;
}

function RouteComponent() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()
  const { data: order, isLoading, isError, error, refetch } = useOrderDetails(id)
  const [copied, setCopied] = useState(false)
  const releaseMutation = useReleaseOrder()
  const cancelMutation = useCancelOrder()
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const handleBack = () => {
    window.history.length > 1 ? window.history.back() : navigate({ to: '/orders/' as any })
  }

  const handleUpdateStatus = () => {
    if (!order) return
    setShowConfirmDialog(true)
  }

  const executeConfirmAction = async () => {
    if (!order) return
    await releaseMutation.mutateAsync({
      id: order._id || order.id,
      data: {}
    })
    setShowConfirmDialog(false)
  }

  const handleCancelOrder = async () => {
    if (!order) return
    await cancelMutation.mutateAsync({
      id: order._id || order.id,
      reason: cancelReason || undefined,
    })
    setShowCancelDialog(false)
    setCancelReason('')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-destructive/10 flex items-center justify-center text-destructive border border-destructive/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Failed to Load Order</h2>
        <p className="text-muted-foreground max-w-sm">
          {(error as any)?.message || 'A network error occurred while loading the order details.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw className="size-4 mr-2" /> Try Again</Button>
          <Button onClick={() => navigate({ to: '/orders/' as any })}><ArrowLeft className="size-4 mr-2" /> Back to Orders</Button>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Order Not Found</h2>
        <p className="text-muted-foreground max-w-sm">The requested order details could not be found or loaded.</p>
        <Button onClick={() => navigate({ to: '/orders/' as any })}><ArrowLeft className="size-4" /> Back to Orders</Button>
      </div>
    )
  }

  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : 'N/A'

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: order?.orderNumber || 'Details' }]} />
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Orders"
      title="Order Details"
      description="Detailed breakdown of the sales order and fulfillment status"
      backAction={handleBack}
    />
      </header>

      {/* Main Order Card Header */}
      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-5">
              <div className="size-16 bg-primary rounded-xl flex items-center justify-center text-primary-foreground shrink-0">
                <ShoppingBag className="size-7" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">ID: {order._id || order.id}</Badge>
                  <OrderStatusBadge status={order.status} />
                  <OrderExpiryBadge status={order.status} expiresAt={order.expiresAt} expiredAt={order.expiredAt} />
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-foreground mt-2 tracking-tight">Order {order.orderNumber}</h2>
                <p className="text-muted-foreground mt-1 text-sm flex items-center gap-1.5">
                  <Calendar className="size-3.5 shrink-0" />
                  {orderDate}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expired Order Banner */}
      {order.status === 'Expired' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive shrink-0">
                <Hourglass className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-destructive">This order has expired</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The payment window closed{order.expiredAt ? ` on ${new Date(order.expiredAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}. Please place a new order at current prices.
                </p>
              </div>
            </div>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shrink-0"
              onClick={() => navigate({ to: '/admin-order' as any })}
            >
              <Plus className="size-4 mr-2" /> Place New Order
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Order Info & Cost Breakdown */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Info className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Summary & Pricing</CardTitle>
                <CardDescription className="text-xs">Quantity, unit price, and total amount details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Fulfillment Type</span>
              <Badge variant="outline" className="capitalize font-semibold">
                {order.deliveryType === 'delivery' ? (
                  <span className="flex items-center gap-1"><Truck className="size-3" /> Delivery</span>
                ) : (
                  <span className="flex items-center gap-1"><Warehouse className="size-3" /> Pickup</span>
                )}
              </Badge>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Quantity Ordered</span>
              <span className="font-mono font-semibold text-foreground">
                {toNum(order.quantity)?.toLocaleString()} {order.productUnit || order.product?.unit || 'Liters'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Unit Price</span>
              <span className="font-mono font-normal text-foreground">
                {formatCurrency(toNum(order.price))} per {(order.productUnit || order.product?.unit) === 'Liters' ? 'Liter' : 'Unit'}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-base font-semibold text-foreground">Total Transaction Value</span>
              <span className="font-mono text-lg font-semibold text-primary">
                {formatCurrency(toNum(order.totalAmount))}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Customer Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <User className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Customer Profile</CardTitle>
                <CardDescription className="text-xs">Client identification and billing contact details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Client Name</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{order.customerName || order.customer?.name || 'N/A'}</p>
            </div>
            {(order.companyName || order.customerCompanyName || order.customer?.companyName) && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Company</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                  <Building2 className="size-3.5 text-muted-foreground" />
                  {order.companyName || order.customerCompanyName || order.customer?.companyName}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Email Address</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5 truncate">
                  <Mail className="size-3.5 text-muted-foreground shrink-0" />
                  <EmailLink value={order.customerEmail || order.customer?.email} fallback="N/A" className="truncate" />
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Phone Line</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted-foreground shrink-0" />
                  <PhoneLink value={order.customerPhone || order.customer?.phone} fallback="N/A" />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Product Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <Package className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Product Specifications</CardTitle>
                <CardDescription className="text-xs">Details of the purchased inventory item</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Product Name</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{order.productName || order.product?.name || 'N/A'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Product SKU / Code</p>
                <p className="text-sm font-mono text-foreground mt-0.5 font-semibold bg-muted border border-border px-2 py-0.5 rounded w-fit text-xs">
                  {order.productSku || order.product?.sku || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Category</p>
                <p className="text-sm text-foreground mt-0.5">{order.productCategory || order.product?.category || 'N/A'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Depot / Logistics Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <Warehouse className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Logistics & Depot Origin</CardTitle>
                <CardDescription className="text-xs">Location and depot processing this transaction</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Fulfillment Depot</p>
              <p className="text-sm font-semibold text-foreground mt-0.5 flex items-center gap-1.5">
                {order.depotName || order.depot?.name || 'N/A'}
                {(order.depotCode || order.depot?.code) && (
                  <Badge variant="outline" className="font-mono text-xs py-0 px-1.5">{order.depotCode || order.depot?.code}</Badge>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">LGA / City</p>
                <p className="text-sm text-foreground mt-0.5">{order.depotCity || order.depot?.city || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">State Region</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1">
                  <MapPin className="size-3 text-primary shrink-0" />
                  {order.state || order.depotState || order.depot?.state || 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PFI Source Information */}
        {/* {order.pfiId && (
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <FileCheck className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">PFI Source Inventory</CardTitle>
                  <CardDescription className="text-xs">Pro Forma Invoice linked to this order</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">PFI Number</p>
                <p className="text-sm font-semibold text-foreground mt-0.5 flex items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-xs">{order.pfiNumber}</Badge>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground font-normal uppercase">Starting Qty</p>
                  <p className="text-sm font-mono font-semibold text-foreground mt-0.5">
                    {toNum(order.startingQtyLitres).toLocaleString()} {order.productUnit || 'Litres'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-normal uppercase">Sold Qty</p>
                  <p className="text-sm font-mono font-semibold text-foreground mt-0.5">
                    {toNum(order.soldQtyLitres).toLocaleString()} {order.productUnit || 'Litres'}
                  </p>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground font-normal uppercase">PFI Status</span>
                <Badge className={order.pfiStatus === 'active' ? 'bg-success/10 text-success border border-success/20' : 'bg-muted text-muted-foreground border border-border'}>
                  {order.pfiStatus === 'active' ? 'Active' : 'Finished'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )} */}
      </div>

      {/* Payment Information */}
      {(order.virtualAccountNumber || order.paymentStatus) && (
        <Card className="card-hover">
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <Banknote className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Payment Information</CardTitle>
                <CardDescription className="text-xs">Bank paid into and payment status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Payment Status</span>
              {/* Three states, not two — a part-paid order has taken real
                  money, and colouring it like an unpaid one tells the desk to
                  chase a customer who has already paid. */}
              <Badge
                className={
                  order.paymentStatus === 'Paid'
                    ? 'bg-success text-success-foreground'
                    : order.paymentStatus === 'Part Paid'
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-warning text-warning-foreground'
                }
              >
                {order.paymentStatus || 'Unpaid'}
              </Badge>
            </div>
            {order.virtualAccountNumber && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground font-normal uppercase">Bank</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{order.virtualAccountBank || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-normal uppercase">Account Number</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-lg font-semibold font-mono text-foreground">{order.virtualAccountNumber}</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(order.virtualAccountNumber)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-250 ease-luxe"
                      title="Copy account number"
                    >
                      {copied ? <CheckCircle className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-normal uppercase">Account Name</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{order.virtualAccountName || formatAccountName(order.customerName || order.customer?.name)}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Admin Actions and Ticket Access */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="bg-primary/5 border-b border-primary/10">
          <CardTitle className="text-sm font-semibold text-primary">Order Actions & Ticket Management</CardTitle>
          <CardDescription className="text-xs">Update order status or view generated pickup tickets.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-center">
          {order.status === 'Paid' && order.deliveryType === 'pickup' && (
            <Button
              className="bg-info text-info-foreground hover:bg-info/90 cursor-pointer"
              onClick={() => handleUpdateStatus()}
              disabled={releaseMutation.isPending}
            >
              <Send className="size-4 mr-2" /> Release Order
            </Button>
          )}

          {order.status === 'Paid' && order.deliveryType === 'delivery' && (
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Truck className="size-4" /> Delivery orders are released with truck allocation from the ticketing page.
            </span>
          )}

          {/* Payment releases an order on its own now, so Released is where a
              paid order lands — cleared, but with no tickets cut yet. */}
          {order.status === 'Released' && (
            <span className="text-sm text-info font-medium flex items-center gap-1.5">
              <Truck className="size-4" /> Released for loading — generate the tickets to send trucks in
            </span>
          )}

          {order.status === 'Loading' && (
            <span className="text-sm text-info font-medium flex items-center gap-1.5">
              <Truck className="size-4" /> Order is at the depot — loading in progress
            </span>
          )}

          {order.status !== 'Completed' && order.status !== 'Cancelled' && order.status !== 'Expired' && order.status !== 'Loading' && (
            <Button
              variant="destructive"
              className="cursor-pointer"
              onClick={() => setShowCancelDialog(true)}
              disabled={cancelMutation.isPending}
            >
              <XCircle className="size-4 mr-2" /> Cancel Order
            </Button>
          )}

          {order.status === 'Cancelled' && (
            <span className="text-sm text-destructive font-normal flex items-center">Order was Cancelled</span>
          )}

          {order.status === 'Expired' && (
            <span className="text-sm text-destructive font-medium flex items-center gap-1.5">
              <Hourglass className="size-4" /> Order has expired — no actions available
            </span>
          )}

          {(order.paymentStatus === 'Paid' || order.status === 'Completed') && (
            <Button
              variant="outline"
              className="border-primary text-primary hover:bg-primary/10 cursor-pointer"
              onClick={() => {
                const suffix = order.id || order.orderNumber.replace(/^.*[\/]/, "")
                navigate({ to: '/ticket/details' as any, search: { id: `TCK-${suffix}` } as any })
              }}
            >
              <TicketIcon className="size-4 mr-2" /> View Ticket / Receipt QR
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        title="Release Order"
        description="Are you sure you want to release this order for loading at the depot?"
        confirmLabel="Release"
        onConfirm={executeConfirmAction}
        loading={releaseMutation.isPending}
      />

      <ConfirmDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title="Cancel Order"
        description="Are you sure you want to cancel this order? This will release any held wallet funds and restore stock."
        confirmLabel="Cancel Order"
        variant="destructive"
        onConfirm={handleCancelOrder}
        loading={cancelMutation.isPending}
      >
        <div className="mt-3">
          <label className="text-sm text-muted-foreground block mb-1.5">Reason (optional)</label>
          <Input
            placeholder="Enter cancellation reason..."
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}
