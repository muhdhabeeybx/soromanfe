import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import { Separator } from '#/components/ui/separator'
import { Loader2, Save, CheckCircle, FileText, Edit, Trash2, User, Calendar, Banknote, MapPin, Package, ShieldAlert, Scale, DropletIcon, Ticket } from 'lucide-react'
import { usePfiDetails, useUpdatePfi, useDeletePfi } from '#/lib/hooks/usePfis'
import { unitNames } from '#/routes/pfi/-pfi-utils'
import { useAdminList } from '#/lib/hooks/useAdmin'
import { useToast } from '#/lib/hooks/useToast'
import { toNum } from '#/lib/utils'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/pfi/details')({
  beforeLoad: () => routeGuard('/pfi'),
  validateSearch: (search: Record<string, unknown>): { id: string } => {
    return {
      id: search.id as string || '',
    }
  },
  component: PFIDetails,
})

function fmtQty(n: number, decimals: number = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCurrency(n: number) {
  return `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PFIDetails() {
  const navigate = useNavigate()
  const toast = useToast()
  const { id } = Route.useSearch()

  const { data: pfi, isLoading, error: fetchError } = usePfiDetails(id)
  const { mutateAsync: updatePfi, isPending } = useUpdatePfi()
  const { mutateAsync: deletePfi, isPending: isDeleting } = useDeletePfi()
  const { data: adminsData } = useAdminList()

  const staff = Array.isArray(adminsData) ? adminsData : []

  const getOfficerName = (idOrName: string | number | null | undefined, storedName?: string | null) => {
    if (!idOrName && !storedName) return 'Unassigned'
    if (idOrName) {
      const found = staff.find((u: any) => String(u.id) === String(idOrName) || String(u._id) === String(idOrName))
      if (found) return found.full_name
    }
    if (storedName) return storedName
    return 'Unassigned'
  }

  const [form, setForm] = useState({
    closureDate: new Date().toISOString().split('T')[0],
    totalInflow: '',
    bank: '',
    purchaseCost: '',
    aggregateExpenses: '',
    handler: '',
    remarks: '',
  })

  const [error, setError] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  if (isLoading) {
    return <div className="flex h-[50svh] items-center justify-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
  }

  if (fetchError || !pfi) {
    return (
      <div className="flex flex-col items-center justify-center h-[50svh] space-y-4">
        <FileText className="size-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">PFI Not Found</h2>
        <p className="text-muted-foreground">The requested PFI details could not be loaded.</p>
        <Button onClick={() => navigate({ to: '/pfi' as any })}>Back to PFI List</Button>
      </div>
    )
  }

  const isGantry = pfi.pfiType === 'gantry'

  const rawUnit = pfi.productUnit || (Number(pfi.qtyVolumeMt || 0) > 0 && Number(pfi.startingQtyLitres || 0) === 0 ? 'MT' : 'Litres')
  const names = unitNames(rawUnit)
  const unit = names.short
  const uLower = rawUnit.toLowerCase()
  const isKg = uLower.includes('kg') || uLower.includes('kilogram')
  const isMt = uLower.includes('mt') || uLower.includes('ton')
  const isWeight = isKg || isMt

  const startingLitres = Number(pfi.startingQtyLitres || 0)
  const soldLitres = Number(pfi.soldQtyLitres || 0)
  const remainingLitres = Math.max(0, startingLitres - soldLitres)

  let qtyMt = Number(pfi.qtyVolumeMt || 0)
  if (qtyMt <= 0 && isKg && startingLitres > 0) {
    qtyMt = startingLitres / 1000
  } else if (qtyMt <= 0 && isMt && startingLitres > 0) {
    qtyMt = startingLitres
  }

  const primaryStarting = startingLitres
  const primarySold = soldLitres
  const primaryRemaining = remainingLitres
  const decimals = names.decimals

  const isActive = pfi.status === 'active'

  const unitPrice = toNum(pfi.unitPrice)
  const totalAmount = toNum(pfi.totalAmount)
  const purchaseCost = toNum(pfi.purchaseCost)

  let cumulativeCost = totalAmount
  if (cumulativeCost <= 0 && unitPrice > 0 && primaryStarting > 0) {
    cumulativeCost = primaryStarting * unitPrice
  }
  if (cumulativeCost <= 0 && purchaseCost > 0) {
    cumulativeCost = purchaseCost
  }

  let soldCost = 0
  let remainingCost = 0
  if (unitPrice > 0) {
    soldCost = primarySold * unitPrice
    remainingCost = primaryRemaining * unitPrice
  } else if (primaryStarting > 0 && cumulativeCost > 0) {
    soldCost = (primarySold / primaryStarting) * cumulativeCost
    remainingCost = (primaryRemaining / primaryStarting) * cumulativeCost
  }

  const handleEdit = () => {
    navigate({ to: '/pfi/form', search: { id: String(pfi._id || pfi.id) } as any })
  }

  const handleDelete = () => { setShowDeleteDialog(true) }
  const confirmDelete = async () => {
    const targetId = pfi?._id || pfi?.id
    if (!targetId) return
    try {
      await deletePfi(String(targetId))
      navigate({ to: '/pfi' as any })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Failed to delete PFI')
    } finally {
      setShowDeleteDialog(false)
    }
  }

  const handleClosePfi = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      await updatePfi({
        id,
        data: {
          status: 'finished',
          closureDate: form.closureDate || undefined,
          totalInflow: form.totalInflow ? Number(form.totalInflow.replace(/,/g, '')) : undefined,
          closureBank: form.bank.trim() || undefined,
          purchaseCost: form.purchaseCost ? Number(form.purchaseCost.replace(/,/g, '')) : undefined,
          aggregateExpenses: form.aggregateExpenses ? Number(form.aggregateExpenses.replace(/,/g, '')) : undefined,
          closureHandler: form.handler.trim() || undefined,
          closureRemarks: form.remarks.trim() || undefined,
        }
      })
      navigate({ to: '/pfi' as any })
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to close PFI')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'PFIs', href: '/pfi' }, { label: pfi?.pfiNumber || 'Details' }]} />
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Admin"
      title="PFI Profile Details"
      description="Monitor PFI transaction logs, weight & volume metrics, assigned officers, and closure state"
    />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEdit}>
            <Edit className="size-4 mr-2" /> Edit PFI
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            <Trash2 className="size-4 mr-2" /> {isDeleting ? 'Deleting...' : 'Delete PFI'}
          </Button>
        </div>
      </header>

      {/* Hero Badge Panel */}
      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="size-12 bg-primary/10 rounded-full flex items-center justify-center text-primary shrink-0">
              <FileText className="size-6" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">PFI ID: {pfi._id}</Badge>
                <Badge variant="outline" className="font-normal text-xs">
                  {isWeight ? <Scale className="size-3 mr-1 text-info inline" /> : <DropletIcon className="size-3 mr-1 text-primary inline" />}
                  Unit: {names.plural}
                </Badge>
                <Badge variant="outline" className="font-normal text-xs">
                  {isGantry ? <Ticket className="size-3 mr-1 text-info inline" /> : <Package className="size-3 mr-1 text-primary inline" />}
                  {isGantry ? 'Gantry' : 'Coastal'}
                </Badge>
                {isActive ? (
                  <Badge className="bg-success text-success-foreground">Active</Badge>
                ) : (
                  <Badge variant="secondary">Finished</Badge>
                )}
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground mt-1 tracking-tight">{pfi.pfiNumber}</h2>
              <p className="text-muted-foreground mt-0.5 text-xs flex items-center gap-1.5">
                {pfi.description || 'Pro Forma Invoice details and logistics status'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Card 1: PFI Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <MapPin className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Information & Location</CardTitle>
                <CardDescription className="text-xs">Date, product and terminal origin details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <dl className="grid grid-cols-1 gap-4">
              <div>
                <dt className="text-muted-foreground font-normal">Date Created</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.pfiDate ? new Date(pfi.pfiDate).toLocaleDateString() : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Location</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.locationName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Product</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.productName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Measurement Unit</dt>
                <dd className="font-semibold text-foreground mt-0.5">{names.plural}</dd>
              </div>
              {/* A gantry allocation is never weighed in MT — there is one
                  quantity, in the product's own unit. */}
              {isGantry ? (
                <div>
                  <dt className="text-muted-foreground font-normal">Number of Tickets</dt>
                  <dd className="font-semibold text-foreground mt-0.5">
                    {pfi.ticketCount == null ? '—' : pfi.ticketCount.toLocaleString()}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt className="text-muted-foreground font-normal">Qty Volume (MT)</dt>
                  <dd className="font-semibold text-foreground mt-0.5">{qtyMt > 0 ? `${fmtQty(qtyMt, 2)} MT` : '—'}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground font-normal">Unit Price</dt>
                <dd className="font-semibold text-foreground mt-0.5">
                  {unitPrice > 0 ? `₦${unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${unit}` : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Card 2: Vessel & Surveyor — coastal only. A gantry batch is
            collected at the loading gantry, so there is no vessel to name and
            no discharge for a surveyor to measure. */}
        {!isGantry && (
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <Package className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Vessel & Surveyor Logs</CardTitle>
                <CardDescription className="text-xs">Vessel broker name, vessel name, surveyor contact</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-muted-foreground font-normal">Vessel Broker</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.vesselBroker || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Vessel Name</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.vesselName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Surveyor Name</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.surveyorName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Surveyor Phone</dt>
                <dd className="font-semibold text-foreground mt-0.5">{pfi.surveyorPhone || '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        )}

        {/* Card 3: Assigned Officers */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <User className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Assigned Personnel</CardTitle>
                <CardDescription className="text-xs">Compliance, security and product managers</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <dl className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div>
                <dt className="text-muted-foreground font-normal">Audit Officer</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.auditOfficerId, pfi.auditOfficerName)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Product Officer</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.productOfficerId, pfi.productOfficerName)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">IT Compliance Officer</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.itComplianceOfficerId, pfi.itComplianceOfficerName)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Security Exit Officer</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.securityExitOfficerId, pfi.securityExitOfficerName)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Commission Officer</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.commissionOfficerId, pfi.commissionOfficerName)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground font-normal">Sales Manager</dt>
                <dd className="font-semibold text-foreground mt-0.5">{getOfficerName(pfi.salesManagerId, pfi.salesManagerName)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Card 4: Quantities & Financial Cost Breakdown */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <Banknote className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Quantities & Financial Value Breakdown</CardTitle>
                <CardDescription className="text-xs">Inventory metrics and cumulative PFI cost allocation</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Starting Qty ({unit})</p>
                <p className="text-lg font-semibold text-foreground mt-1">{fmtQty(primaryStarting, decimals)} {unit}</p>
                {startingLitres > 0 && isWeight && (
                  <p className="text-xs text-muted-foreground">({fmtQty(startingLitres)} L)</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Total PFI Cost</p>
                <p className="text-lg font-semibold text-primary mt-1">{fmtCurrency(cumulativeCost)}</p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Sold Qty ({unit})</p>
                <p className="text-lg font-semibold text-accent mt-1">{fmtQty(primarySold, decimals)} {unit}</p>
                <p className="text-xs font-semibold text-accent mt-0.5">Sold Cost: {fmtCurrency(soldCost)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Remaining Qty ({unit})</p>
                <p className="text-lg font-semibold text-warning mt-1">{fmtQty(primaryRemaining, decimals)} {unit}</p>
                <p className="text-xs font-semibold text-warning mt-0.5">Rem Cost: {fmtCurrency(remainingCost)}</p>
              </div>
            </div>
            {primaryStarting > 0 && (
              <div className="space-y-1 mt-2">
                <div className="h-2 bg-muted rounded-full overflow-hidden w-full">
                  <div className="h-full bg-accent rounded-full transition-all duration-700 ease-luxe" style={{ width: `${Math.min(100, (primarySold / primaryStarting) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{((primarySold / primaryStarting) * 100).toFixed(1)}% sold ({fmtCurrency(soldCost)})</span>
                  <span>{((primaryRemaining / primaryStarting) * 100).toFixed(1)}% left ({fmtCurrency(remainingCost)})</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 5: Closure Card */}
        <div className="md:col-span-2">
          {isActive ? (
            <Card className="border-primary/20">
              <CardHeader className="bg-primary/5 border-b border-primary/10">
                <CardTitle className="text-primary flex items-center gap-2">
                  <CheckCircle className="size-5" />
                  Close PFI
                </CardTitle>
                <CardDescription>Enter final closure details to mark this PFI as finished.</CardDescription>
              </CardHeader>
              <form onSubmit={handleClosePfi}>
                <CardContent className="space-y-4 pt-6">
                  {error && (
                    <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm font-normal mb-4 flex items-center gap-2">
                      <ShieldAlert className="size-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Closure Date</Label>
                      <Input type="date" value={form.closureDate} onChange={e => setForm({ ...form, closureDate: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Closure Bank</Label>
                      <Input placeholder="e.g. Zenith Bank" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Total Inflow (₦)</Label>
                      <Input type="number" placeholder="0.00" value={form.totalInflow} onChange={e => setForm({ ...form, totalInflow: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Purchase Cost (₦)</Label>
                      <Input type="number" placeholder="0.00" value={form.purchaseCost} onChange={e => setForm({ ...form, purchaseCost: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Aggregate Expenses (₦)</Label>
                      <Input type="number" placeholder="0.00" value={form.aggregateExpenses} onChange={e => setForm({ ...form, aggregateExpenses: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Closure Handler</Label>
                      <Input placeholder="Name of handler" value={form.handler} onChange={e => setForm({ ...form, handler: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Closure Remarks</Label>
                    <Input placeholder="Any final remarks..." value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-3 bg-muted/50 p-4 border-t">
                  <Button type="submit" className="w-full sm:w-auto" disabled={isPending}>
                    {isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                    Finish PFI
                  </Button>
                </CardFooter>
              </form>
            </Card>
          ) : (
            <Card>
              <CardHeader className="border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                    <Calendar className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Closure Summary</CardTitle>
                    <CardDescription className="text-xs">Final closure audit details</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 text-sm">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <dt className="text-muted-foreground font-normal">Closure Date</dt>
                    <dd className="font-semibold text-foreground mt-0.5">{pfi.closureDate ? new Date(pfi.closureDate).toLocaleDateString() : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-normal">Closure Bank</dt>
                    <dd className="font-semibold text-foreground mt-0.5">{pfi.closureBank || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-normal">Total Inflow</dt>
                    <dd className="font-semibold text-success mt-0.5">{pfi.totalInflow ? fmtCurrency(toNum(pfi.totalInflow)) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-normal">Purchase Cost</dt>
                    <dd className="font-semibold text-destructive mt-0.5">{pfi.purchaseCost ? fmtCurrency(toNum(pfi.purchaseCost)) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-normal">Aggregate Expenses</dt>
                    <dd className="font-semibold text-destructive mt-0.5">{pfi.aggregateExpenses ? fmtCurrency(toNum(pfi.aggregateExpenses)) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-normal">Closure Handler</dt>
                    <dd className="font-semibold text-foreground mt-0.5">{pfi.closureHandler || '—'}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground font-normal">Remarks</dt>
                    <dd className="text-foreground mt-0.5">{pfi.closureRemarks || 'No remarks provided.'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete PFI"
        description="Are you sure you want to permanently delete this PFI and all associated data? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </div>
  )
}
