import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useLocation } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  ArrowLeft,
  Store,
  Edit,
  Landmark,
  Mail,
  Phone,
  MapPin,
  Calendar,
  AlertCircle,
  Loader2,
  Wallet,
  CheckCircle2,
  BanknoteIcon,
  Hourglass,
} from 'lucide-react'
import { useVendorDetails, type Vendor } from '#/lib/hooks/useVendors'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'
import { naira } from '#/routes/pfi/-pfi-utils'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/vendors/details')({
  beforeLoad: () => routeGuard('/vendors'),
  component: VendorDetails,
})

const STATUS_LABELS: Record<string, string> = {
  pending: 'With Expenditure Officer',
  verified: 'With CFO',
  audit_approved: 'Awaiting final approval',
  admin_approved: 'Approved — awaiting payment',
  paid: 'Paid',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-foreground',
  verified: 'bg-info/15 text-info',
  audit_approved: 'bg-info/25 text-info',
  admin_approved: 'bg-accent/15 text-accent',
  paid: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
  changes_requested: 'bg-warning/15 text-warning',
}

function VendorDetails() {
  const navigate = useNavigate()
  const location = useLocation()

  const stateData = location.state as { vendor?: Vendor } | undefined
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const vendorIdFromUrl = searchParams?.get('id') || searchParams?.get('vendorId') || ''

  const stateVendor = stateData?.vendor
  const vendorId = stateVendor?.id || vendorIdFromUrl

  const { data, isLoading } = useVendorDetails(vendorId)
  const vendor = data?.vendor || stateVendor
  const summary = data?.summary
  const expenses = data?.expenses || []

  if (isLoading && !vendor) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-3">Loading vendor details...</p>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigate({ to: '/vendors' })}>
            <ArrowLeft className="size-4" />
          </Button>
        </div>
        <Card className="p-12 text-center border-dashed">
          <AlertCircle className="size-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold">Vendor Not Found</h2>
          <p className="text-sm text-muted-foreground mt-1">The requested vendor could not be found.</p>
          <Button className="mt-4" onClick={() => navigate({ to: '/vendors' })}>Return to List</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto pb-12">
      <Breadcrumbs items={[{ label: 'Vendors', href: '/vendors' }, { label: vendor.name }]} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          eyebrow="Expenses"
          title="Vendor Details"
          description="Contact information, bank details, and complete expense history for this vendor"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: '/vendors/form' as any, state: { vendor, isEdit: true } as any })}
        >
          <Edit className="size-4 mr-2" /> Edit Vendor
        </Button>
      </div>

      <Card className="bg-card border-border/60 overflow-hidden">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="size-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Store className="size-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-semibold text-foreground tracking-tight text-balance">{vendor.name}</h2>
                {vendor.status === 'Active' ? (
                  <Badge className="bg-accent/15 text-accent border-accent/30 font-normal">Active</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                )}
              </div>
              {vendor.contactPerson && <p className="text-base font-semibold text-muted-foreground mt-1">{vendor.contactPerson}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <StatCardGrid count={5}>
          <StatCard icon={<Wallet />} label="Total Requested" value={naira(summary.totalRequested)} />
          <StatCard icon={<CheckCircle2 />} label="Total Approved" value={naira(summary.totalApproved)} />
          <StatCard icon={<BanknoteIcon />} label="Total Paid" value={naira(summary.totalPaid)} />
          <StatCard icon={<Hourglass />} label="Outstanding" value={naira(summary.outstanding)} tone={summary.outstanding > 0 ? 'amber' : undefined} />
          <StatCard icon={<Calendar />} label="Expenses Raised" value={summary.expenseCount} description={summary.lastPaymentDate ? `Last paid ${new Date(summary.lastPaymentDate).toLocaleDateString()}` : 'Never paid'} />
        </StatCardGrid>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 border-border/60">
          <CardHeader className="border-b border-border/40 pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Landmark className="size-4 text-primary" /> Vendor Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4 text-sm">
            {vendor.phone && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1"><Phone className="size-3.5" /> Phone</p>
                <PhoneLink value={vendor.phone} className="text-foreground font-semibold mt-0.5 block" />
              </div>
            )}
            {vendor.email && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1"><Mail className="size-3.5" /> Email</p>
                <EmailLink value={vendor.email} className="text-foreground font-semibold mt-0.5 block" />
              </div>
            )}
            {vendor.address && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1"><MapPin className="size-3.5" /> Address</p>
                <p className="text-foreground mt-0.5">{vendor.address}</p>
              </div>
            )}
            {vendor.taxId && (
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Tax / Registration ID</p>
                <p className="text-foreground font-mono mt-0.5">{vendor.taxId}</p>
              </div>
            )}
            {vendor.bankName && (
              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground font-normal uppercase">Bank Details</p>
                <p className="text-foreground font-semibold mt-0.5">{vendor.bankName}</p>
                <p className="text-foreground font-mono text-xs mt-0.5">{vendor.accountNumber} · {vendor.accountName}</p>
              </div>
            )}
            {vendor.createdAt && (
              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1"><Calendar className="size-3.5" /> Date Added</p>
                <p className="text-xs text-foreground mt-0.5">
                  {new Date(vendor.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-border/60">
          <CardHeader className="border-b border-border/40 pb-3">
            <CardTitle className="text-base font-semibold">Expense History ({expenses.length})</CardTitle>
            <CardDescription className="text-xs">Every expense request raised against this vendor</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {expenses.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-xs text-muted-foreground">No expenses raised against this vendor yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>PFI</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Paid From</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className={cn(MICRO, 'font-mono')}>{e.reference_number}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(e.expense_date).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs">{e.pfi_number || '—'}</TableCell>
                        <TableCell className="text-xs">{e.category_name}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{e.description || '—'}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{naira(Number(e.amount))}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{naira(e.amount_paid == null ? null : Number(e.amount_paid))}</TableCell>
                        <TableCell className="text-xs">{e.bank_paid_from || '—'}</TableCell>
                        <TableCell>
                          <Badge className={cn('font-normal text-xs', STATUS_TONE[e.status] || 'bg-muted')}>
                            {STATUS_LABELS[e.status] || e.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
