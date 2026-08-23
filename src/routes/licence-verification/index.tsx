import { useState, useEffect } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  ShieldCheck,
  Search,
  X,
  Eye,
  CheckCircle,
  XCircle,
  FileText,
  Calendar,
  Building2,
  Clock,
} from 'lucide-react'
import { useAllLicenses } from '#/lib/hooks/useCustomerLicenses'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import type { CustomerLicense } from '#/lib/types'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/licence-verification/')({
  beforeLoad: () => routeGuard('/licence-verification'),
  component: LicenceVerification,
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

function LicenceVerification() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)

  const [previewLicense, setPreviewLicense] = useState<CustomerLicense | null>(null)

  const { data, isLoading, isError, error, refetch } = useAllLicenses({
    page: currentPage,
    limit: pageSize,
    search: searchTerm || undefined,
    status: selectedStatus !== 'all' ? selectedStatus : undefined,
  })

  const licenses = data?.licenses || []
  const totalItems = data?.pagination?.total ?? licenses.length
  const totalPages = data?.pagination?.pages ?? Math.ceil(totalItems / pageSize)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedStatus])

  const hasFilters = Boolean(searchTerm || selectedStatus !== 'all')

  return (
    <div className="space-y-6">
      <PageHeader
      eyebrow="Admin"
      title="Licence Verification"
      description="Review and verify customer DPR/NUPRC licenses."
      />

      {!isLoading && !isError && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard tone="amber" icon={<Clock />} label="Pending" value={licenses.filter((l) => l.status === 'pending').length || '—'} />
                <StatCard icon={<CheckCircle />} label="Approved" value={licenses.filter((l) => l.status === 'approved').length || '—'} />
                <StatCard tone="red" icon={<XCircle />} label="Rejected" value={licenses.filter((l) => l.status === 'rejected').length || '—'} />
                </div>
                )}
                <FilterBar>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
              <Input
              type="text"
              placeholder="Search by company name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              />
              {searchTerm && (
              <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors duration-250 ease-luxe"
              aria-label="Clear search"
              >
              <X className="size-2.5" />
              </button>
              )}
              </div>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
              </Select>
              </div>
                </FilterBar>

                <Card>

                <CardContent>
                {isLoading ? (
                <PageLoader message="Loading licenses..." />
                ) : isError ? (
                <PageError
                message={(error as any)?.message || 'Failed to load licenses'}
                onRetry={() => refetch()}
                />
                ) : licenses.length === 0 ? (
                <PageEmpty
                icon={<ShieldCheck className="size-6 text-muted-foreground" />}
                title={hasFilters ? 'No licenses match your filters' : 'No licenses yet'}
                description={
                hasFilters
                ? 'Try adjusting your search or filter criteria.'
                : 'Customer licenses will appear here once added.'
                }
                hasFilters={hasFilters}
                onClearFilters={() => {
                setSearchTerm('')
                setSelectedStatus('all')
                }}
                />
                ) : (
                <>
                <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Expiry Date</TableHead>
                <TableHead className="hidden lg:table-cell">Reviewed By</TableHead>
                <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {licenses.map((license) => (
                <TableRow
                key={license.id}
                className="cursor-pointer hover:bg-muted transition"
                onClick={() =>
                navigate({
                to: '/licence-verification/review',
                search: { id: String(license.id) },
                } as any)
                }
                >
                <TableCell>
                <div className="flex items-center gap-2">
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-normal truncate max-w-[150px]">
                {license.customerName || `Customer #${license.customerId}`}
                </span>
                </div>
                </TableCell>
                <TableCell>
                <span className="font-normal">{license.companyName}</span>
                </TableCell>
                <TableCell>{getStatusBadge(license.status)}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {license.expiryDate ? (
                <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                {new Date(license.expiryDate).toLocaleDateString()}
                </span>
                ) : (
                '—'
                )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                {license.verifiedByName || '—'}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                {new Date(license.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={(e) => {
                e.stopPropagation()
                setPreviewLicense(license)
                }}
                >
                <Eye className="size-4" />
                </Button>
                </TableCell>
                </TableRow>
                ))}
                </TableBody>
                </Table>
                </div>
                <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                setPageSize(size)
                setCurrentPage(1)
                }}
                />
                </>
                )}
                </CardContent>
                </Card>
                {/* Preview Dialog */}
                <Dialog
                open={!!previewLicense}
                onOpenChange={(open) => {
                if (!open) setPreviewLicense(null)
                }}
                >
                <DialogContent className="max-w-2xl">
                <DialogHeader>
                <DialogTitle>
                {previewLicense?.companyName} — License
                </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                {previewLicense?.status && (
                <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status:</span>
                {getStatusBadge(previewLicense.status)}
                {previewLicense.verifiedByName && (
                <span className="text-muted-foreground">
                by {previewLicense.verifiedByName}
                </span>
                )}
                </div>
                )}
                {previewLicense?.verificationComment && (
                <div className="text-sm p-3 rounded-lg bg-muted/50 border">
                <span className="text-muted-foreground">Comment: </span>
                {previewLicense.verificationComment}
                </div>
                )}
                {previewLicense?.licenseUrl &&
                (isImage(previewLicense.licenseUrl) ? (
                <img
                src={previewLicense.licenseUrl}
                alt="License"
                className="max-h-[60svh] rounded object-contain mx-auto"
                />
                ) : isPdf(previewLicense.licenseUrl) ? (
                <iframe
                src={previewLicense.licenseUrl}
                className="w-full h-[60svh] rounded border"
                title="License PDF"
                />
                ) : (
                <div className="flex items-center gap-2 p-4 border rounded">
                <FileText className="size-5" />
                <span>Unsupported file format</span>
                </div>
                ))}
                </div>
                </DialogContent>
                </Dialog>
    </div>
  )
}
