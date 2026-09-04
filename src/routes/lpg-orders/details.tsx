import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#/components/ui/card'
import { ArrowLeft, AlertCircle, MapPin, Calendar, Phone, Mail, Truck, FileCheck, Banknote, Copy, CheckCircle, Clock, XCircle, User, CircleDollarSign, Flame, Hourglass } from 'lucide-react'
import { useLpgOrderRequestDetails, useUpdateLpgOrderCollectionStatus } from '#/lib/hooks/useLpgOrders'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/lpg-orders/details')({
  beforeLoad: () => routeGuard('/lpg-orders'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: LpgOrderDetails,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(value)
}

function formatAccountName(name?: string) {
  if (!name) return 'N/A'
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .join(' ')
  return `SOROMANNIGERI/ ${initials}`
}

function formatDate(dateString: string) {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function paymentStatusBadge(status: string) {
  switch (status) {
    case 'Paid':
      return <Badge className="bg-accent/15 text-accent border-accent/20 gap-1"><CheckCircle className="size-3" /> Paid</Badge>
    case 'Unpaid':
      return <Badge className="bg-warning/15 text-warning border-warning/20 gap-1"><Clock className="size-3" /> Unpaid</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function collectionStatusBadge(status: string) {
  switch (status) {
    case 'Collected':
      return <Badge className="bg-accent/15 text-accent border-accent/20 gap-1"><CheckCircle className="size-3" /> Collected</Badge>
    case 'Dispatched':
      return <Badge className="bg-muted/15 text-muted-foreground border-border/20 gap-1"><Truck className="size-3" /> Dispatched</Badge>
    case 'Pending':
      return <Badge className="bg-warning/15 text-warning border-warning/20 gap-1"><Clock className="size-3" /> Pending</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function requestStatusBadge(status: string) {
  switch (status) {
    case 'Pending Review':
      return <Badge className="bg-warning/15 text-warning border-warning/20 gap-1"><Clock className="size-3" /> Pending Review</Badge>
    case 'Approved':
      return <Badge className="bg-accent/15 text-accent border-accent/20 gap-1"><CheckCircle className="size-3" /> Approved</Badge>
    case 'Rejected':
      return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" /> Rejected</Badge>
    case 'Cancelled':
      return <Badge variant="outline" className="gap-1"><XCircle className="size-3" /> Cancelled</Badge>
    case 'Expired':
      return <Badge className="bg-muted/50 text-muted-foreground border-muted/20 gap-1"><Hourglass className="size-3" /> Expired</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function LpgOrderDetails() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()

  const { data: request, isLoading, isError, error, refetch } = useLpgOrderRequestDetails(id)
  const updateCollectionMutation = useUpdateLpgOrderCollectionStatus()

  const [copied, setCopied] = useState(false)
  const [showCollectionConfirm, setShowCollectionConfirm] = useState(false)
  const [pendingCollectionStatus, setPendingCollectionStatus] = useState('')

  const handleUpdateCollection = (status: string) => {
    setPendingCollectionStatus(status)
    setShowCollectionConfirm(true)
  }

  const executeCollectionUpdate = async () => {
    if (!request || !pendingCollectionStatus) return
    await updateCollectionMutation.mutateAsync({ id: request.id, collectionStatus: pendingCollectionStatus })
    setShowCollectionConfirm(false)
    setPendingCollectionStatus('')
  }

  if (isLoading) {
    return <PageLoader message="Loading order details..." />
  }

  if (isError) {
    return <PageError message={(error as any)?.message || 'Failed to load order details'} onRetry={refetch} />
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Order Not Found</h2>
        <p className="text-muted-foreground max-w-sm">The requested order details could not be found or loaded.</p>
        <Button onClick={() => navigate({ to: '/lpg-orders/' as any })}><ArrowLeft className="size-4" /> Back to Orders</Button>
      </div>
    )
  }

  const reviewerName = [request.reviewerFirstName, request.reviewerSurname].filter(Boolean).join(' ') || 'N/A'
  const totalWeightKg = Number(request.cylinderSizeKg) * Number(request.cylinderQuantity)

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[
        { label: 'LPG Orders', href: '/lpg-orders' },
        { label: request.requestNumber },
      ]} />

      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="LPG Home Delivery"
      title="Order Details"
      description="Detailed breakdown of the LPG cooking gas order"
    />
      </header>

      {/* Main Order Card Header */}
      <Card className="card-hover">
        <CardContent className="bg-warning/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-5">
              <div className="size-16 bg-warning rounded-xl flex items-center justify-center text-warning-foreground shrink-0">
                <Flame className="size-7" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">ID: {request.id}</Badge>
                  {requestStatusBadge(request.status)}
                  {paymentStatusBadge(request.paymentStatus)}
                  {collectionStatusBadge(request.collectionStatus)}
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-foreground mt-2 tracking-tight">{request.requestNumber}</h2>
                <p className="text-muted-foreground mt-1 text-sm flex items-center gap-1.5">
                  <Calendar className="size-3.5 shrink-0" />
                  {formatDate(request.createdAt)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Summary & Pricing */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <CircleDollarSign className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Summary & Pricing</CardTitle>
                <CardDescription className="text-xs">Cylinder details, unit price, and total amount</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">LPG Station</span>
              <span className="font-semibold text-foreground">{request.stationName}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Cylinder Size</span>
              <span className="font-mono font-semibold text-foreground">{request.cylinderSizeKg} Kg</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Quantity</span>
              <span className="font-mono font-semibold text-foreground">
                {Number(request.cylinderQuantity).toLocaleString()} cylinders
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Total Weight</span>
              <span className="font-mono font-normal text-foreground">{totalWeightKg.toLocaleString()} Kg</span>
            </div>
            {request.pricePerKg && (
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Price Per Kg</span>
                <span className="font-mono font-normal text-foreground">{formatCurrency(Number(request.pricePerKg))}</span>
              </div>
            )}
            {request.deliveryPrice && (
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <span className="text-sm text-muted-foreground">Delivery Price</span>
                <span className="font-mono font-normal text-foreground">{formatCurrency(Number(request.deliveryPrice))}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2">
              <span className="text-base font-semibold text-foreground">Total Amount</span>
              <span className="font-mono text-lg font-semibold text-primary">
                {formatCurrency(Number(request.totalAmount) || 0)}
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
                <CardDescription className="text-xs">Client identification and contact details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Client Name</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{request.customerName || 'N/A'}</p>
            </div>
            {request.companyName && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Company</p>
                <p className="text-sm text-foreground mt-0.5">{request.companyName}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Email Address</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5 truncate">
                  <Mail className="size-3.5 text-muted-foreground shrink-0" />
                  <EmailLink value={request.customerEmail} fallback="N/A" className="truncate" />
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Phone Line</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted-foreground shrink-0" />
                  <PhoneLink value={request.customerPhone} fallback="N/A" />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delivery Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <MapPin className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Delivery Information</CardTitle>
                <CardDescription className="text-xs">Delivery address and location details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Delivery Address</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{request.deliveryAddress || 'N/A'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">State</p>
                <p className="text-sm text-foreground mt-0.5 flex items-center gap-1">
                  <MapPin className="size-3 text-primary shrink-0" />
                  {request.deliveryState || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">LGA</p>
                <p className="text-sm text-foreground mt-0.5">{request.deliveryLga || 'N/A'}</p>
              </div>
            </div>
            {request.expectedArrivalDate && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Expected Arrival</p>
                <p className="text-sm font-semibold text-foreground mt-0.5 flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-muted-foreground" />
                  {request.expectedArrivalDate}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Review Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-muted/10 flex items-center justify-center text-muted-foreground">
                <FileCheck className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Review Information</CardTitle>
                <CardDescription className="text-xs">Request review and approval details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Request Status</span>
              {requestStatusBadge(request.status)}
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Reviewed By</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{reviewerName}</p>
            </div>
            {request.reviewedAt && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Reviewed At</p>
                <p className="text-sm text-foreground mt-0.5">{formatDate(request.reviewedAt)}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment Information */}
      <Card className="card-hover">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
              <Banknote className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Payment Information</CardTitle>
              <CardDescription className="text-xs">Dedicated virtual account and payment status</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex justify-between items-center py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">Payment Status</span>
            {paymentStatusBadge(request.paymentStatus)}
          </div>
          {request.virtualAccountNumber && (
            <>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Bank</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{request.virtualAccountBank || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Account Number</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-lg font-semibold font-mono text-foreground">{request.virtualAccountNumber}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(request.virtualAccountNumber)
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
                <p className="text-sm font-semibold text-foreground mt-0.5">{request.virtualAccountName || formatAccountName(request.customerName)}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Collection Status */}
      <Card className="card-hover">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-muted/10 flex items-center justify-center text-muted-foreground">
              <Truck className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Collection Status</CardTitle>
              <CardDescription className="text-xs">Track the delivery and collection progress</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="flex justify-between items-center py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">Collection Status</span>
            {collectionStatusBadge(request.collectionStatus)}
          </div>
          <div className="flex items-center gap-4 pt-4">
            <div className={`flex-1 p-3 rounded-lg border text-center transition-colors ${request.collectionStatus === 'Pending' ? 'bg-warning/10 border-warning/30' : 'bg-muted/50 border-border'}`}>
              <Clock className={`size-5 mx-auto mb-1 ${request.collectionStatus === 'Pending' ? 'text-warning' : 'text-muted-foreground'}`} />
              <p className={`text-xs font-normal ${request.collectionStatus === 'Pending' ? 'text-warning' : 'text-muted-foreground'}`}>Pending</p>
            </div>
            <div className={`flex-1 p-3 rounded-lg border text-center transition-colors ${request.collectionStatus === 'Dispatched' ? 'bg-muted/10 border-border/30' : 'bg-muted/50 border-border'}`}>
              <Truck className={`size-5 mx-auto mb-1 ${request.collectionStatus === 'Dispatched' ? 'text-muted-foreground' : 'text-muted-foreground'}`} />
              <p className={`text-xs font-normal ${request.collectionStatus === 'Dispatched' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>Dispatched</p>
            </div>
            <div className={`flex-1 p-3 rounded-lg border text-center transition-colors ${request.collectionStatus === 'Collected' ? 'bg-accent/10 border-accent/30' : 'bg-muted/50 border-border'}`}>
              <CheckCircle className={`size-5 mx-auto mb-1 ${request.collectionStatus === 'Collected' ? 'text-accent' : 'text-muted-foreground'}`} />
              <p className={`text-xs font-normal ${request.collectionStatus === 'Collected' ? 'text-accent' : 'text-muted-foreground'}`}>Collected</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Actions */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="bg-primary/5 border-b border-primary/10">
          <CardTitle className="text-sm font-semibold text-primary">Order Actions</CardTitle>
          <CardDescription className="text-xs">Update payment and collection status</CardDescription>
        </CardHeader>
        <CardContent className="pt-6 flex flex-wrap gap-4">
          {request.paymentStatus === 'Paid' && request.collectionStatus === 'Pending' && (
            <Button
              className="bg-foreground text-background hover:bg-foreground cursor-pointer"
              onClick={() => handleUpdateCollection('Dispatched')}
              disabled={updateCollectionMutation.isPending}
            >
              <Truck className="size-4 mr-2" /> Mark as Dispatched
            </Button>
          )}

          {request.collectionStatus === 'Dispatched' && (
            <Button
              className="bg-accent text-accent-foreground hover:bg-accent cursor-pointer"
              onClick={() => handleUpdateCollection('Collected')}
              disabled={updateCollectionMutation.isPending}
            >
              <CheckCircle className="size-4 mr-2" /> Mark as Collected
            </Button>
          )}

          {request.paymentStatus === 'Paid' && request.collectionStatus === 'Collected' && (
            <span className="text-sm text-accent font-normal flex items-center gap-2">
              <CheckCircle className="size-4" /> Order completed
            </span>
          )}

          {request.status === 'Pending Review' && (
            <Button
              variant="outline"
              className="border-warning text-warning hover:bg-warning/10 cursor-pointer"
              onClick={() => navigate({ to: '/lpg-order-request/review' as any, search: { id: String(request.id) } as any })}
            >
              <FileCheck className="size-4 mr-2" /> Review Request
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showCollectionConfirm}
        onOpenChange={setShowCollectionConfirm}
        title="Update Collection Status"
        description={`Are you sure you want to mark this order as ${pendingCollectionStatus}?`}
        confirmLabel="Confirm"
        onConfirm={executeCollectionUpdate}
        loading={updateCollectionMutation.isPending}
      />
    </div>
  )
}
