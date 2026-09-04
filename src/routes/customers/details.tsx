import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Label } from '#/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { User, ArrowLeft, Edit, Trash2, Calendar, AlertCircle, Phone, Mail, Building2, MapPin, Wallet, Banknote, TrendingUp, Package, Loader2, SearchX, Warehouse, Clock, DollarSign, ArrowDownLeft, ArrowUpRight, Copy, CheckCircle, CreditCard, Hash, Fuel, Hourglass, Plus, X } from 'lucide-react'
import { useCustomerDetails, useDeleteCustomer, useUpdateCustomer } from '#/lib/hooks/useCustomers'
import { useOrderList } from '#/lib/hooks/useOrders'
import { useDepositList } from '#/lib/hooks/useDeposits'
import { useCommissions, useCommissionSummary } from '#/lib/hooks/useCommissions'
import { useExpectedPayments, useCreateExpectedPayment, useCancelExpectedPayment } from '#/lib/hooks/useExpectedPayments'
import { useToast } from '#/lib/hooks/useToast'
import { toNum } from '#/lib/utils'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { CustomerLicenses } from '#/components/CustomerLicenses'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/customers/details')({
  beforeLoad: () => routeGuard('/customers'),
  validateSearch: (search: Record<string, unknown>): { id?: string; customerId?: string } => {
    return {
      id: (search.id as string) || undefined,
      customerId: (search.customerId as string) || undefined,
    }
  },
  component: CustomerDetailPage,
})

function getStatusBadge(status: string) {
  switch (status) {
    case 'Active': return <Badge className="bg-success text-success-foreground">{status}</Badge>
    case 'Inactive': return <Badge className="bg-warning text-warning-foreground">{status}</Badge>
    default: return <Badge variant="outline">{status}</Badge>
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

/** How this customer said they'd pay, ahead of the transfer showing up. Purely advisory. */
function ExpectedPaymentsCard({ customerId }: { customerId: string | number | undefined }) {
  const { data: expectedPayments = [], isLoading } = useExpectedPayments({ customerId, status: 'pending' })
  const createExpectedPayment = useCreateExpectedPayment()
  const cancelExpectedPayment = useCancelExpectedPayment()
  const [open, setOpen] = useState(false)
  const [expectedAmount, setExpectedAmount] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  const submit = async () => {
    if (!customerId) return
    await createExpectedPayment.mutateAsync({
      customerId,
      expectedAmount: expectedAmount ? Number(expectedAmount) : undefined,
      reference: reference.trim(),
      note: note.trim(),
    })
    setExpectedAmount('')
    setReference('')
    setNote('')
    setOpen(false)
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
              <Hourglass className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Expected Payments</CardTitle>
              <CardDescription className="text-xs">How the customer said they'd pay, before the transfer shows up</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!customerId}>
            <Plus className="size-3.5 mr-1.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : expectedPayments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing pending. Add a note when this customer says they're about to pay.
          </p>
        ) : (
          <ul className="space-y-2">
            {expectedPayments.map((ep) => (
              <li key={ep.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-normal text-foreground">
                    {ep.expectedAmount ? formatCurrency(Number(ep.expectedAmount)) : 'Amount not given'}
                    {ep.orderNumber && <span className="ml-2 text-xs text-muted-foreground font-mono">for {ep.orderNumber}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[ep.reference, ep.note].filter(Boolean).join(' — ') || 'No further detail'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={cancelExpectedPayment.isPending}
                  onClick={() => cancelExpectedPayment.mutate(ep.id)}
                  title="Cancel — this note is no longer relevant"
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Note an expected payment</DialogTitle>
            <DialogDescription>
              Optional detail that makes this customer's bank transfer easy to spot later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cust-ep-amount" className="text-xs">Expected amount</Label>
              <Input id="cust-ep-amount" type="number" step="0.01" placeholder="0.00" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-ep-ref" className="text-xs">Reference they'll use</Label>
              <Input id="cust-ep-ref" placeholder="e.g. their phone number" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-ep-note" className="text-xs">Note</Label>
              <Textarea id="cust-ep-note" rows={2} placeholder="e.g. Says she'll transfer today" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createExpectedPayment.isPending} onClick={submit}>
              {createExpectedPayment.isPending ? 'Saving…' : 'Save note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function CustomerDetailPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const search = Route.useSearch()
  const deleteCustomer = useDeleteCustomer()
  const updateCustomer = useUpdateCustomer()
  const toast = useToast()
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const customerState = (router.history.location.state as any)?.customer
  const customerId = search.id || search.customerId || customerState?._id || customerState?.id || (router.history.location.state as any)?.id

  const { data: customerDetails, isLoading } = useCustomerDetails(customerId ? String(customerId) : '')

  const { data: orderData, isLoading: ordersLoading } = useOrderList(
    customerId ? { customer: String(customerId), limit: 100 } : undefined
  )

  const { data: depositData, isLoading: depositsLoading } = useDepositList(
    customerId ? { customer: String(customerId), limit: 100 } : undefined
  )

  const { data: commissionData, isLoading: commissionsLoading } = useCommissions(
    customerId ? { customerId: String(customerId), limit: 100 } : undefined
  )

  const { data: commissionSummary } = useCommissionSummary(
    customerId ? { customerId: String(customerId) } : undefined
  )

  const customer = customerDetails || customerState

  const handleBack = () => {
    window.history.length > 1 ? window.history.back() : navigate({ to: '/customers/' as any })
  }

  const handleDelete = () => {
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!customer?._id) return
    try {
      await deleteCustomer.mutateAsync(customer._id || customer.id)
      setShowDeleteDialog(false)
      navigate({ to: '/customers/' as any })
    } catch {
      toast.error('Failed to delete customer')
    }
  }

  const handleEdit = () => {
    navigate({ to: '/customers/form', state: { customer, isEdit: true } as any })
  }

  if (!customer && isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">No Customer Selected</h2>
        <p className="text-muted-foreground max-w-sm">Please select a customer from the directory to view details.</p>
        <Button onClick={() => navigate({ to: '/customers/' as any })}><ArrowLeft className="size-4" /> Back to Customers</Button>
      </div>
    )
  }

  const getInitials = (name: string) => {
    const parts = (name || '').split(' ')
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase()
  }

  const orders = orderData?.orders || []
  const totalOrders = orders.length
  const completedOrders = orders.filter((o: any) => o.status === 'Completed').length
  const pendingOrders = orders.filter((o: any) => o.status === 'Pending').length
  const totalValue = orders.reduce((sum: number, o: any) => sum + toNum(o.totalAmount), 0)

  const deposits = depositData?.deposits || []
  const totalDeposits = deposits.length
  const totalCredits = deposits.filter((d: any) => d.type === 'credit').reduce((sum: number, d: any) => sum + toNum(d.amount), 0)
  const totalDebits = deposits.filter((d: any) => d.type === 'debit').reduce((sum: number, d: any) => sum + toNum(d.amount), 0)

  const customerCommissions = commissionData?.commissions || []
  const totalCommissions = customerCommissions.length
  const totalCommissionAmount = commissionSummary?.pendingAmount || 0
  const totalCommissionQuantity = commissionSummary?.totalQuantity || 0

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'Customers', href: '/customers' }, { label: customer?.name || 'Details' }]} />

      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Orders"
      title="Customer Profile"
      description="Account details, deposits, and contact information"
      backAction={handleBack}
    />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleEdit}>
            <Edit className="size-4" /> Edit Profile
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteCustomer.isPending}>
            <Trash2 className="size-4" /> {deleteCustomer.isPending ? 'Removing...' : 'Remove Customer'}
          </Button>
        </div>
      </header>

      {/* Hero Badge Panel */}
      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="size-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-semibold shrink-0">
              {getInitials(customer.name)}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {customer.companyName && <Badge variant="outline" className="text-xs"><Building2 className="size-2.5 mr-1" />{customer.companyName}</Badge>}
                {getStatusBadge(customer.status)}
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground mt-2 tracking-tight">{customer.name}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm flex items-center gap-1.5">
                {customer.address ? customer.address : 'No address provided'}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-muted-foreground font-normal uppercase">Account Balance</p>
              <p className="text-2xl font-semibold text-foreground mt-1">{formatCurrency(toNum(customer.balance))}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* Card 1: Contact Information */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <User className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Contact Information</CardTitle>
                <CardDescription className="text-xs">Phone, email, and address details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <EmailLink value={customer.email} fallback="Not provided" className="text-sm font-normal text-foreground" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <PhoneLink value={customer.phone} fallback="Not provided" className="text-sm font-normal text-foreground" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Address</p>
                  <p className="text-sm font-normal text-foreground">{customer.address || 'Not provided'}</p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-3">
                <Building2 className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Company</p>
                  <p className="text-sm font-semibold text-foreground">{customer.companyName || 'Not provided'}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Financial Summary */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <Wallet className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Financial Summary</CardTitle>
                <CardDescription className="text-xs">Balance, deposits, and payment history</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-2">
                  <Wallet className="size-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Balance</span>
                </div>
                <span className="text-lg font-semibold text-foreground">{formatCurrency(toNum(customer.balance))}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-2">
                  <Banknote className="size-4 text-success" />
                  <span className="text-sm text-muted-foreground">Current Deposit</span>
                </div>
                <span className="text-lg font-semibold text-success">{formatCurrency(toNum(customer.deposit))}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-info" />
                  <span className="text-sm text-muted-foreground">Previous Deposit</span>
                </div>
                <span className="text-lg font-semibold text-info">{formatCurrency(toNum(customer.previousDeposit))}</span>
              </div>
            </div>
          </CardContent>
        </Card>



        {/* DPR / NUPRC Licenses */}
        <CustomerLicenses customerId={Number(customerId)} />

        {/* Card 4: Status & Activity */}
        <Card className="md:col-span-2">
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <Calendar className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Status & Activity</CardTitle>
                <CardDescription className="text-xs">Current account status and record timestamps</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Account Status</p>
                <div className="mt-2">
                  {getStatusBadge(customer.status)}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Record Created</p>
                <p className="text-sm font-normal text-foreground mt-2">
                  {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-normal uppercase">Last Updated</p>
                <p className="text-sm font-normal text-foreground mt-2">
                  {customer.updatedAt ? new Date(customer.updatedAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-border">
              <label className="flex items-start gap-3 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={!!customer.marketingOptOut}
                  disabled={updateCustomer.isPending}
                  onChange={(e) => updateCustomer.mutate({ id: String(customer.id ?? customer._id), data: { marketingOptOut: e.target.checked } })}
                  className="mt-1 size-4 rounded border-input text-primary accent-primary cursor-pointer"
                />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-normal text-foreground">Do not send marketing messages</span>
                  <span className="text-xs text-muted-foreground">Excludes this customer from Messaging segment sends (price updates, announcements). Transactional order/ticket messages are unaffected.</span>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Order History */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Package className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Order History</CardTitle>
                <CardDescription className="text-xs">All orders placed by this customer</CardDescription>
              </div>
            </div>
            <Badge variant="secondary">{totalOrders} order{totalOrders !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-xl bg-muted border border-border mb-4">
                <SearchX className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-normal text-foreground">No orders found</p>
              <p className="text-xs text-muted-foreground mt-1">This customer hasn&apos;t placed any orders yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Package className="size-3.5 text-primary" />
                    <span className="text-xs text-muted-foreground">Total</span>
                  </div>
                  <span className="text-sm font-semibold">{totalOrders}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Clock className="size-3.5 text-warning" />
                    <span className="text-xs text-muted-foreground">Pending</span>
                  </div>
                  <span className="text-sm font-semibold text-warning">{pendingOrders}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-3.5 text-success" />
                    <span className="text-xs text-muted-foreground">Completed</span>
                  </div>
                  <span className="text-sm font-semibold text-success">{completedOrders}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <DollarSign className="size-3.5 text-info" />
                    <span className="text-xs text-muted-foreground">Total Value</span>
                  </div>
                  <span className="text-sm font-semibold">{formatCurrency(totalValue)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order No.</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Depot</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order: any) => (
                      <TableRow
                        key={order._id || order.id}
                        className="hover:bg-muted/50 transition cursor-pointer"
                        onClick={() => navigate({ to: '/orders/details' as any, search: { id: order._id || order.id } as any })}
                      >
                        <TableCell className="font-mono font-semibold text-primary">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm font-normal">
                            <Package className="size-3.5 text-muted-foreground" />
                            {order.productName || order.product?.name || 'Unknown'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Warehouse className="size-3 text-muted-foreground" />
                            <span>{order.depotName || order.depot?.name || 'Unknown'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-normal">
                          {order.quantity?.toLocaleString()} {order.productUnit || order.product?.unit || 'Liters'}
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          {formatCurrency(toNum(order.totalAmount))}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {order.deliveryType}
                          </Badge>
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Deposit History */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <Banknote className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Deposit History</CardTitle>
                <CardDescription className="text-xs">Customer account payments and deductions</CardDescription>
              </div>
            </div>
            <Badge variant="secondary">{totalDeposits} transaction{totalDeposits !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {depositsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : deposits.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-xl bg-muted border border-border mb-4">
                <SearchX className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-normal text-foreground">No deposit records found</p>
              <p className="text-xs text-muted-foreground mt-1">Deposit transactions will appear here once recorded.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Banknote className="size-3.5 text-primary" />
                    <span className="text-xs text-muted-foreground">Transactions</span>
                  </div>
                  <span className="text-sm font-semibold">{totalDeposits}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <ArrowDownLeft className="size-3.5 text-success" />
                    <span className="text-xs text-muted-foreground">Total Credits</span>
                  </div>
                  <span className="text-sm font-semibold text-success">{formatCurrency(totalCredits)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="size-3.5 text-destructive" />
                    <span className="text-xs text-muted-foreground">Total Debits</span>
                  </div>
                  <span className="text-sm font-semibold text-destructive">{formatCurrency(totalDebits)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Recorded By</TableHead>
                      <TableHead className="text-right">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deposits.map((deposit: any) => (
                      <TableRow key={deposit._id || deposit.id} className="hover:bg-muted/50 transition">
                        <TableCell className="text-xs text-muted-foreground">
                          {deposit.createdAt
                            ? new Date(deposit.createdAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {deposit.type === 'credit' ? (
                            <Badge className="bg-success text-success-foreground text-xs gap-1">
                              <ArrowDownLeft className="size-3" />
                              Credit
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <ArrowUpRight className="size-3" />
                              Debit
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={`font-semibold ${deposit.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                          {deposit.type === 'credit' ? '+' : '-'}{formatCurrency(toNum(deposit.amount))}
                        </TableCell>
                        <TableCell className="text-sm">
                          {deposit.description || '—'}
                          {deposit.reference && (
                            <span className="block text-xs text-muted-foreground font-mono mt-0.5">Ref: {deposit.reference}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {deposit.recorderFirstName || deposit.recorderSurname
                            ? `${deposit.recorderFirstName || ''} ${deposit.recorderSurname || ''}`.trim()
                            : typeof deposit.recordedBy === 'object' && deposit.recordedBy !== null
                            ? `${(deposit.recordedBy as any).firstName || (deposit.recordedBy as any).first_name || ''} ${(deposit.recordedBy as any).surname || (deposit.recordedBy as any).last_name || ''}`.trim()
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-normal">
                          {formatCurrency(toNum(deposit.balanceAfter))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Expected Payments */}
      <ExpectedPaymentsCard customerId={customerId} />

      {/* Commission History */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <DollarSign className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Commission History</CardTitle>
                <CardDescription className="text-xs">Commissions earned by this customer</CardDescription>
              </div>
            </div>
            <Badge variant="secondary">{totalCommissions} commission{totalCommissions !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {commissionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : customerCommissions.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-xl bg-muted border border-border mb-4">
                <SearchX className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-normal text-foreground">No commissions found</p>
              <p className="text-xs text-muted-foreground mt-1">Commissions will appear here once orders are paid and commission rates are set.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <DollarSign className="size-3.5 text-primary" />
                    <span className="text-xs text-muted-foreground">Commissions</span>
                  </div>
                  <span className="text-sm font-semibold">{totalCommissions}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Fuel className="size-3.5 text-info" />
                    <span className="text-xs text-muted-foreground">Total Quantity</span>
                  </div>
                  <span className="text-sm font-semibold">{totalCommissionQuantity.toLocaleString()} L</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center gap-2">
                    <Banknote className="size-3.5 text-success" />
                    <span className="text-xs text-muted-foreground">Total Earned</span>
                  </div>
                  <span className="text-sm font-semibold text-success">{formatCurrency(totalCommissionAmount)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order Ref</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Depot</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerCommissions.map((c) => (
                      <TableRow key={c.id} className="hover:bg-muted/50 transition">
                        <TableCell className="font-mono font-semibold text-primary text-sm">
                          {c.orderNumber}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.orderCreatedAt ? new Date(c.orderCreatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">{c.depotName}</TableCell>
                        <TableCell className="text-sm">{c.productName}</TableCell>
                        <TableCell className="font-normal text-sm">{c.quantity.toLocaleString()} L</TableCell>
                        <TableCell className="text-sm text-muted-foreground">₦{c.commissionRate}/L</TableCell>
                        <TableCell className="text-right font-semibold text-foreground">
                          {formatCurrency(c.commissionAmount)}
                        </TableCell>
                        <TableCell>
                          {c.status === 'paid' ? (
                            <Badge className="bg-success text-success-foreground text-xs">Credited</Badge>
                          ) : (
                            <Badge className="bg-warning/15 text-warning border-warning/20 text-xs">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Remove Customer"
        description="Are you sure you want to permanently remove this customer from the system? This action cannot be undone."
        confirmLabel="Remove Customer"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={deleteCustomer.isPending}
      />
    </div>
  )
}
