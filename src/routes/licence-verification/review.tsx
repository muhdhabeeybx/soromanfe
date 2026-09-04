import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '#/components/ui/dialog'
import { ShieldCheck, FileText, Calendar, Loader2, CheckCircle, XCircle, User, Phone, Mail, Building2, Clock, MessageSquare } from 'lucide-react'
import { useLicenseDetails, useReviewLicense } from '#/lib/hooks/useCustomerLicenses'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/licence-verification/review')({
  beforeLoad: () => routeGuard('/licence-verification'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: LicenceReviewPage,
})

function getStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return <Badge className="bg-success text-success-foreground">Approved</Badge>
    case 'rejected':
      return <Badge variant="destructive">Rejected</Badge>
    case 'pending':
    default:
      return <Badge className="bg-warning text-warning-foreground">Pending</Badge>
  }
}

function isImage(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg)/i.test(url) || url.includes('/image/')
}

function isPdf(url: string) {
  return url.endsWith('.pdf') || url.includes('/raw/')
}

function LicenceReviewPage() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()
  const { data: license, isLoading, isError, error, refetch } = useLicenseDetails(id)
  const reviewLicense = useReviewLicense()

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve')
  const [reviewComment, setReviewComment] = useState('')

  const handleBack = () => {
    window.history.length > 1
      ? window.history.back()
      : navigate({ to: '/licence-verification/' as any })
  }

  const openReviewDialog = (action: 'approve' | 'reject') => {
    setReviewAction(action)
    setReviewComment('')
    setReviewDialogOpen(true)
  }

  const handleReview = async () => {
    if (!license) return
    await reviewLicense.mutateAsync({
      id: license.id,
      approve: reviewAction === 'approve',
      comment: reviewComment,
    })
    setReviewDialogOpen(false)
    refetch()
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageLoader message="Loading license details..." />
      </div>
    )
  }

  if (isError || !license) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageError
          message={(error as any)?.message || 'Failed to load license'}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs
        items={[
          { label: 'Licence Verification', href: '/licence-verification' },
          { label: 'Review' },
        ]}
      />

      <div className="flex items-center justify-between">
        <PageHeader
      eyebrow="Admin"
      title="License Review"
      description={`{license.companyName}`}
      backAction={handleBack}
    />
        {license.status === 'pending' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-success text-success hover:bg-success/10 hover:text-success"
              onClick={() => openReviewDialog('approve')}
            >
              <CheckCircle className="size-4 mr-1.5" />
              Approve
            </Button>
            <Button
              variant="destructive"
              onClick={() => openReviewDialog('reject')}
            >
              <XCircle className="size-4 mr-1.5" />
              Reject
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - License Preview */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                License Document
              </CardTitle>
            </CardHeader>
            <CardContent>
              {license.licenseUrl ? (
                isImage(license.licenseUrl) ? (
                  <div className="rounded-lg border bg-background overflow-hidden">
                    <img
                      src={license.licenseUrl}
                      alt={license.companyName}
                      className="w-full max-h-[70svh] object-contain"
                    />
                  </div>
                ) : isPdf(license.licenseUrl) ? (
                  <iframe
                    src={license.licenseUrl}
                    className="w-full h-[70svh] rounded border"
                    title="License PDF"
                  />
                ) : (
                  <div className="flex items-center gap-2 p-8 border rounded-lg justify-center text-muted-foreground">
                    <FileText className="size-5" />
                    <span>Unsupported file format</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-2 p-8 border rounded-lg justify-center text-muted-foreground">
                  <FileText className="size-5" />
                  <span>No file uploaded</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                Verification Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                {getStatusBadge(license.status)}
              </div>
              {license.verifiedByName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Reviewed by
                  </span>
                  <span className="text-sm font-normal">
                    {license.verifiedByName}
                  </span>
                </div>
              )}
              {license.verifiedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Reviewed at
                  </span>
                  <span className="text-sm">
                    {new Date(license.verifiedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {license.verificationComment && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MessageSquare className="size-3.5" />
                    Comment
                  </div>
                  <p className="text-sm p-3 rounded-lg bg-muted/50 border">
                    {license.verificationComment}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-5 text-primary" />
                Customer Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2.5">
                <User className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-normal">
                    {license.customerName || `Customer #${license.customerId}`}
                  </p>
                </div>
              </div>
              {license.customerCompanyName && (
                <div className="flex items-center gap-2.5">
                  <Building2 className="size-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Company</p>
                    <p className="text-sm font-normal">
                      {license.customerCompanyName}
                    </p>
                  </div>
                </div>
              )}
              {license.customerPhone && (
                <div className="flex items-center gap-2.5">
                  <Phone className="size-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <PhoneLink value={license.customerPhone} className="text-sm font-normal" />
                  </div>
                </div>
              )}
              {license.customerEmail && (
                <div className="flex items-center gap-2.5">
                  <Mail className="size-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <EmailLink value={license.customerEmail} className="text-sm font-normal" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* License Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                License Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Company Name</p>
                <p className="text-sm font-normal">{license.companyName}</p>
              </div>
              {license.expiryDate && (
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="size-3" /> Expiry Date
                  </p>
                  <p className="text-sm font-normal">
                    {new Date(license.expiryDate).toLocaleDateString()}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" /> Submitted
                </p>
                <p className="text-sm">
                  {new Date(license.createdAt).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'Approve License' : 'Reject License'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {reviewAction === 'approve'
                ? `Approve license for "${license.companyName}"?`
                : `Reject license for "${license.companyName}"?`}
            </p>
            <div>
              <Label>
                Comment {reviewAction === 'reject' ? '(required)' : '(optional)'}
              </Label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={
                  reviewAction === 'approve'
                    ? 'Optional approval note...'
                    : 'Reason for rejection...'
                }
                className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewDialogOpen(false)}
              disabled={reviewLicense.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={reviewAction === 'approve' ? 'default' : 'destructive'}
              onClick={handleReview}
              disabled={
                reviewLicense.isPending ||
                (reviewAction === 'reject' && !reviewComment.trim())
              }
            >
              {reviewLicense.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1.5" />
                  Processing...
                </>
              ) : reviewAction === 'approve' ? (
                'Approve'
              ) : (
                'Reject'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
