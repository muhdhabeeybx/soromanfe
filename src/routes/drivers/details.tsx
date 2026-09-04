import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#/components/ui/card'
import { User, Truck, ShieldAlert, ArrowLeft, Edit, Trash2, Calendar, AlertCircle, Star, Phone, Mail, FileText, Gauge } from 'lucide-react'
import { useDriverDetails, useDeleteDriver } from '#/lib/hooks/useDrivers'
import { useToast } from '#/lib/hooks/useToast'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/drivers/details')({
  beforeLoad: () => routeGuard('/drivers'),
  validateSearch: (search: Record<string, unknown>): { id?: string; driverId?: string } => ({
    id: (search.id as string) || undefined,
    driverId: (search.driverId as string) || undefined,
  }),
  component: DriverDetailPage,
})

function getStatusBadge(status: string) {
  switch (status) {
    case 'On Trip': return <Badge className="bg-success text-success-foreground">{status}</Badge>
    case 'Active': return <Badge className="bg-info text-info-foreground">{status}</Badge>
    case 'Off Duty': return <Badge className="bg-warning text-warning-foreground">{status}</Badge>
    default: return <Badge variant="outline">{status}</Badge>
  }
}

function getSafetyColor(score: number) {
  if (score >= 95) return 'text-success bg-success/10 border-success/20'
  if (score >= 80) return 'text-warning bg-warning/10 border-warning/20'
  return 'text-destructive bg-destructive/10 border-destructive/20'
}

function getSafetyBarColor(score: number) {
  if (score >= 95) return 'bg-success'
  if (score >= 80) return 'bg-warning'
  return 'bg-destructive'
}

function getRatingStars(rating: number) {
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      stars.push(<Star key={i} className="size-4 text-warning fill-warning" />)
    } else if (i - rating < 1 && i - rating > 0) {
      stars.push(<Star key={i} className="size-4 text-warning fill-warning/50" />)
    } else {
      stars.push(<Star key={i} className="size-4 text-muted-foreground/30" />)
    }
  }
  return stars
}

function getComplianceStatus(dateStr: string | null | undefined) {
  if (!dateStr) return { label: 'Not Provided', color: 'text-muted-foreground', alert: false }

  const expiry = new Date(dateStr)
  if (isNaN(expiry.getTime())) return { label: 'Invalid Date', color: 'text-muted-foreground', alert: false }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffTime = expiry.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { label: `Expired (${Math.abs(diffDays)} days ago)`, color: 'text-destructive font-semibold bg-destructive/5 px-2 py-0.5 rounded border border-destructive/10', alert: true }
  } else if (diffDays <= 30) {
    return { label: `Expiring soon (${diffDays} days left)`, color: 'text-warning font-semibold bg-warning/5 px-2 py-0.5 rounded border border-warning/10', alert: true }
  } else {
    return { label: `Valid (${diffDays} days left)`, color: 'text-success bg-success/5 px-2 py-0.5 rounded border border-success/10', alert: false }
  }
}

function DriverDetailPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const searchParams = Route.useSearch()
  const deleteDriver = useDeleteDriver()
  const toast = useToast()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const driverState = (router.history.location.state as any)?.driver
  const driverId = searchParams.id || searchParams.driverId || driverState?._id || driverState?.id || (router.history.location.state as any)?.id

  const { data: driverDetails, isLoading } = useDriverDetails(driverId)

  const driver = driverDetails || driverState

  const handleBack = () => {
    window.history.length > 1 ? window.history.back() : navigate({ to: '/drivers/' as any })
  }

  const handleDelete = () => {
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!driver?._id) return
    try {
      await deleteDriver.mutateAsync(driver._id || driver.id)
      setShowDeleteDialog(false)
      navigate({ to: '/drivers/' as any })
    } catch {
      toast.error('Failed to delete driver')
    }
  }

  const handleEdit = () => {
    navigate({ to: '/drivers/form', state: { driver, isEdit: true } as any })
  }

  if (!driver && isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">No Driver Selected</h2>
        <p className="text-muted-foreground max-w-sm">Please select a driver from the directory to view details.</p>
        <Button onClick={() => navigate({ to: '/drivers/' as any })}><ArrowLeft className="size-4" /> Back to Drivers</Button>
      </div>
    )
  }

  const licenseStatus = getComplianceStatus(driver.licenseExpiry)
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase()
  }

  const assignedTruckName = driver.assignedTruckPlate || driver.assignedTruck
  const assignedTruckId = driver.assignedTruckId || driver.assignedTruckRef?._id || driver.assignedTruckRef

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'Drivers', href: '/drivers' }, { label: driver?.name || 'Details' }]} />

      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Transport"
      title="Driver Profile"
      description="License credentials, safety metrics, and contact information"
      backAction={handleBack}
    />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEdit}>
            <Edit className="size-4" /> Edit Profile
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteDriver.isPending}>
            <Trash2 className="size-4" /> {deleteDriver.isPending ? 'Removing...' : 'Remove Driver'}
          </Button>
        </div>
      </header>

      {/* Hero Badge Panel */}
      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="size-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-semibold shrink-0">
              {getInitials(driver.name)}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">DL: {driver.licenseNumber}</Badge>
                {getStatusBadge(driver.status)}
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground mt-2 tracking-tight">{driver.name}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm flex items-center gap-1.5">
                License Class {driver.licenseClass} &bull;{' '}
                {assignedTruckName && assignedTruckName !== 'None' && assignedTruckId ? (
                  <button
                    onClick={() => navigate({ to: '/trucks/details' as any, search: { id: assignedTruckId } as any, state: { id: assignedTruckId } } as any)}
                    className="text-foreground hover:text-primary font-normal transition-colors underline underline-offset-2 duration-250 ease-luxe"
                  >
                    Assigned to {assignedTruckName}
                  </button>
                ) : assignedTruckName && assignedTruckName !== 'None' ? (
                  `Assigned to ${assignedTruckName}`
                ) : (
                  'No truck assigned'
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* Card 1: License & Credentials */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <FileText className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">License & Credentials</CardTitle>
                <CardDescription className="text-xs">Driving license details and validity</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">License Number</p>
                <p className="text-lg font-semibold font-mono text-foreground mt-1">{driver.licenseNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">License Class</p>
                <p className="text-lg font-semibold text-foreground mt-1">{driver.licenseClass}</p>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs text-muted-foreground font-normal uppercase">License Expiry</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm font-semibold text-foreground">
                  {driver.licenseExpiry ? new Date(driver.licenseExpiry).toLocaleDateString() : 'N/A'}
                </span>
                <span className={`text-xs ${licenseStatus.color}`}>
                  {licenseStatus.label}
                </span>
              </div>
            </div>

            {licenseStatus.alert && (
              <div className="mt-2 p-3 bg-destructive/5 border border-destructive/10 rounded flex items-start gap-2">
                <ShieldAlert className="size-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive-foreground font-normal">
                  Attention: License requires immediate renewal. Driver may not be legally permitted to operate.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Contact & Assignment */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <User className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Contact & Truck Assignment</CardTitle>
                <CardDescription className="text-xs">Communication details and vehicle assignment</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <EmailLink value={driver.email} fallback="Not provided" className="text-sm font-normal text-foreground" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <PhoneLink value={driver.phone} fallback="Not provided" className="text-sm font-normal text-foreground" />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-3">
                <Truck className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Assigned Truck</p>
                  {assignedTruckName && assignedTruckName !== 'None' && assignedTruckId ? (
                    <button
                      onClick={() => navigate({ to: '/trucks/details' as any, search: { id: assignedTruckId } as any, state: { id: assignedTruckId } } as any)}
                      className="text-sm font-semibold text-foreground hover:text-primary transition-colors underline underline-offset-2 duration-250 ease-luxe"
                    >
                      {assignedTruckName}
                    </button>
                  ) : (
                    <p className="text-sm font-semibold text-foreground">
                      {assignedTruckName && assignedTruckName !== 'None' ? assignedTruckName : 'Unassigned'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Performance & Safety */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <Star className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Performance & Safety</CardTitle>
                <CardDescription className="text-xs">Driver rating and safety metrics</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Driver Rating</p>
                <div className="flex items-center gap-1.5 mt-2">
                  {getRatingStars(driver.rating || 0)}
                  <span className="text-sm font-semibold text-foreground ml-1">{(driver.rating || 0).toFixed(1)}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Safety Score</p>
                <div className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold ${getSafetyColor(driver.safetyScore || 0)}`}>
                  <Gauge className="size-3" /> {driver.safetyScore || 0}%
                </div>
              </div>
            </div>

            {/* Safety Score Bar */}
            <div className="space-y-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden w-full">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${getSafetyBarColor(driver.safetyScore || 0)}`}
                  style={{ width: `${driver.safetyScore || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {(driver.safetyScore || 0) >= 95 ? 'Excellent safety record' :
                 (driver.safetyScore || 0) >= 80 ? 'Acceptable - monitor closely' :
                 'Below threshold - review required'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Status & Activity */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <Calendar className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Status & Activity</CardTitle>
                <CardDescription className="text-xs">Current operational status and record timestamps</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Current Status</p>
              <div className="mt-2">
                {getStatusBadge(driver.status)}
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Record Created</p>
                <p className="text-sm font-normal text-foreground">
                  {driver.createdAt ? new Date(driver.createdAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Updated</p>
                <p className="text-sm font-normal text-foreground">
                  {driver.updatedAt ? new Date(driver.updatedAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Card 5: Previous Trucks History */}
      <Card className="md:col-span-2">
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
              <Truck className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Previous Trucks History</CardTitle>
              <CardDescription className="text-xs">Historical log of trucks this driver has been assigned to</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {!driver.previousTrucks || driver.previousTrucks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No previous truck assignment records found.</p>
          ) : (
            <div className="divide-y divide-border">
              {driver.previousTrucks.map((record: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between py-3 hover:bg-muted/10 px-2 rounded-lg transition-colors duration-250 ease-luxe">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {record.truckPlate?.charAt(0) || '?'}
                    </div>
                    <div>
                      {record.truckRef && typeof record.truckRef === 'object' ? (
                        <button
                          onClick={() => navigate({ to: '/trucks/details' as any, search: { id: record.truckRef._id || record.truckRef } as any, state: { id: record.truckRef._id || record.truckRef } } as any)}
                          className="font-normal text-sm text-foreground hover:text-primary transition-colors text-left block duration-250 ease-luxe"
                        >
                          {record.truckPlate}
                          {record.truckRef.model && (
                            <span className="text-xs text-muted-foreground font-normal ml-1.5">({record.truckRef.model})</span>
                          )}
                        </button>
                      ) : (
                        <span className="font-normal text-sm text-foreground">{record.truckPlate}</span>
                      )}
                      <p className="text-xs text-muted-foreground">Assigned on: {new Date(record.assignedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Remove Driver"
        description="Are you sure you want to permanently remove this driver from the system? This action cannot be undone."
        confirmLabel="Remove Driver"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={deleteDriver.isPending}
      />
    </div>
  )
}
