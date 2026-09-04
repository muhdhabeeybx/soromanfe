import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { CommaInput } from '#/components/ui/comma-input'
import { ArrowLeft, Package, MapPin, DollarSign, Calendar, Clock, CheckCircle, XCircle, User, FileText, Mail, Phone, Flame, Hourglass } from 'lucide-react'
import { useLpgOrderRequestDetails, useReviewLpgOrderRequest } from '#/lib/hooks/useLpgOrders'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { getErrorMessage } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/lpg-order-request/review')({
  beforeLoad: () => routeGuard('/lpg-order-request'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: ReviewPage,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(value)
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

function statusBadge(status: string) {
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

function ReviewPage() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()

  const { data: request, isLoading, isError, error, refetch } = useLpgOrderRequestDetails(id)
  const reviewMutation = useReviewLpgOrderRequest()

  const [pricePerKg, setPricePerKg] = useState('')
  const [deliveryPrice, setDeliveryPrice] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)

  const handleApprove = async () => {
    if (!request) return
    try {
      await reviewMutation.mutateAsync({
        id: request.id,
        data: {
          deliveryPrice: deliveryPrice || '0',
          expectedArrivalDate: expectedDate || new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
          action: 'approve',
        },
      })
      setShowApproveConfirm(false)
      navigate({ to: '/lpg-order-request' })
    } catch {
      // Error handled by mutation hook
    }
  }

  const handleReject = async () => {
    if (!request) return
    try {
      await reviewMutation.mutateAsync({
        id: request.id,
        data: { action: 'reject' },
      })
      setShowRejectConfirm(false)
      navigate({ to: '/lpg-order-request' })
    } catch {
      // Error handled by mutation hook
    }
  }

  if (isLoading) {
    return <PageLoader message="Loading request details..." />
  }

  if (isError) {
    return <PageError message={getErrorMessage(error)} onRetry={refetch} />
  }

  if (!request) {
    return (
      <PageError
        title="Request Not Found"
        message="The LPG order request you're looking for doesn't exist."
        onRetry={() => navigate({ to: '/lpg-order-request' })}
      />
    )
  }

  const totalWeightKg = Number(request.cylinderSizeKg) * Number(request.cylinderQuantity)
  const stationPricePerKg = Number(request.pricePerKg) || 0
  const computedTotal = (stationPricePerKg * totalWeightKg) + (parseFloat(deliveryPrice) || 0)
  const reviewerName = [request.reviewerFirstName, request.reviewerSurname].filter(Boolean).join(' ') || 'N/A'

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[
        { label: 'LPG Order Requests', href: '/lpg-order-request' },
        { label: request.requestNumber },
      ]} />

      <PageHeader
      eyebrow="LPG Home Delivery"
      title="Review LPG Order Request"
      description={`{request.requestNumber}`}
      actions={
        <>
          {statusBadge(request.status)}
        </>
      }
    />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Request Details */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <FileText className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Request Details</CardTitle>
                <CardDescription className="text-xs">Customer-submitted order information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="flex items-center gap-3">
              <User className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="text-sm font-semibold text-foreground">{request.customerName}</p>
                {request.companyName && (
                  <p className="text-xs text-muted-foreground">{request.companyName}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <EmailLink value={request.customerEmail} fallback="N/A" className="text-sm font-normal text-foreground" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Phone className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Phone</p>
                <PhoneLink value={request.customerPhone} fallback="N/A" className="text-sm font-normal text-foreground" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Flame className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">LPG Station</p>
                <p className="text-sm font-semibold text-foreground">{request.stationName}</p>
                <p className="text-xs text-muted-foreground">{request.stationCode} &bull; {request.stationCity}, {request.stationState}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Package className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Cylinder Details</p>
                <p className="text-sm font-semibold text-foreground">{request.cylinderSizeKg} Kg x {request.cylinderQuantity} cylinders</p>
                <p className="text-xs text-muted-foreground">Total weight: {totalWeightKg.toLocaleString()} Kg</p>
              </div>
            </div>
            {stationPricePerKg > 0 && (
              <div className="flex items-center gap-3">
                <DollarSign className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Price Per Kg (from station)</p>
                  <p className="text-sm font-semibold text-foreground">{formatCurrency(stationPricePerKg)} / Kg</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <MapPin className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Delivery Address</p>
                <p className="text-sm font-normal text-foreground">{request.deliveryAddress}</p>
                {request.deliveryState && (
                  <p className="text-xs text-muted-foreground">{request.deliveryState}{request.deliveryLga ? `, ${request.deliveryLga}` : ''}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="size-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Submitted</p>
                <p className="text-sm font-normal text-foreground">{formatDate(request.createdAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Review Panel */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                <DollarSign className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Pricing & Approval</CardTitle>
                <CardDescription className="text-xs">
                  {request.status === 'Pending Review' ? 'Set pricing and approve or reject this request' : 'Review details and outcome'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {request.status === 'Pending Review' ? (
              <>
                <div>
                  <Label className="text-xs">Price Per Kg (₦) — from station</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₦</span>
                    <Input
                      className="pl-8 h-10 text-right font-mono font-semibold bg-muted/50"
                      value={stationPricePerKg ? stationPricePerKg.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                      readOnly
                      disabled
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Set on the LPG station. Update the station to change this price.</p>
                </div>
                <div>
                  <Label className="text-xs">Delivery Price (₦)</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₦</span>
                    <CommaInput
                      className="pl-8 h-10 text-right font-mono font-semibold"
                      placeholder="0"
                      value={deliveryPrice}
                      onValueChange={setDeliveryPrice}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Expected Arrival Date</Label>
                  <Input
                    type="date"
                    className="h-10 mt-1"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>

                {/* Computed Total */}
                <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal ({totalWeightKg.toLocaleString()} Kg × {stationPricePerKg ? formatCurrency(stationPricePerKg) : '—'})</span>
                    <span className="font-mono font-semibold">{stationPricePerKg ? formatCurrency(stationPricePerKg * totalWeightKg) : '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Delivery</span>
                    <span className="font-mono font-semibold">{deliveryPrice ? formatCurrency(parseFloat(deliveryPrice)) : '₦0'}</span>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <span className="font-semibold text-foreground">Total Amount</span>
                    <span className="font-mono font-semibold text-lg text-foreground">
                      {stationPricePerKg ? formatCurrency(computedTotal) : '—'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="destructive"
                    className="flex-1 gap-2"
                    onClick={() => setShowRejectConfirm(true)}
                    disabled={reviewMutation.isPending}
                  >
                    <XCircle className="size-4" />
                    Reject
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    onClick={() => setShowApproveConfirm(true)}
                    disabled={!stationPricePerKg || reviewMutation.isPending}
                  >
                    <CheckCircle className="size-4" />
                    Approve Request
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  {request.pricePerKg != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Price Per Kg</span>
                      <span className="font-mono font-semibold">{formatCurrency(Number(request.pricePerKg))}/Kg</span>
                    </div>
                  )}
                  {request.deliveryPrice != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Delivery Price</span>
                      <span className="font-mono font-semibold">{formatCurrency(Number(request.deliveryPrice))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Amount</span>
                    <span className="font-mono font-semibold text-lg">{formatCurrency(Number(request.totalAmount))}</span>
                  </div>
                  {request.expectedArrivalDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Expected Arrival</span>
                      <span className="font-normal">{request.expectedArrivalDate}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Reviewed By</span>
                    <span className="font-normal">{reviewerName}</span>
                  </div>
                  {request.reviewedAt && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Reviewed At</span>
                      <span className="font-normal">{formatDate(request.reviewedAt)}</span>
                    </div>
                  )}
                </div>

                <div className="pt-4">
                  <Button variant="outline" className="w-full" onClick={() => navigate({ to: '/lpg-order-request' })}>
                    <ArrowLeft className="size-4 mr-2" />
                    Back to Requests
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={showApproveConfirm}
        onOpenChange={setShowApproveConfirm}
        title="Approve LPG Order Request"
        description={
          `You're about to approve this LPG cooking gas order request.\n\n` +
          `Customer: ${request.customerName}\n` +
          `Cylinders: ${request.cylinderQuantity}x ${request.cylinderSizeKg}Kg\n` +
          `Total Weight: ${totalWeightKg.toLocaleString()} Kg\n` +
          `Total: ${formatCurrency(computedTotal)}\n\n` +
          `A confirmation email and SMS will be sent to the customer.`
        }
        confirmLabel="Approve & Send Confirmation"
        onConfirm={handleApprove}
        loading={reviewMutation.isPending}
      />

      <ConfirmDialog
        open={showRejectConfirm}
        onOpenChange={setShowRejectConfirm}
        title="Reject LPG Order Request"
        description={
          `Are you sure you want to reject request ${request.requestNumber}?\n\n` +
          `Customer: ${request.customerName}\n` +
          `Cylinders: ${request.cylinderQuantity}x ${request.cylinderSizeKg}Kg\n\n` +
          `This action cannot be undone.`
        }
        variant="destructive"
        confirmLabel="Reject Request"
        onConfirm={handleReject}
        loading={reviewMutation.isPending}
      />
    </div>
  )
}
