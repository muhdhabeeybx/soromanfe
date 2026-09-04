import { useState, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Button } from '#/components/ui/button'

import {
  ArrowLeft, User, Phone, MapPin, Building2, ShieldAlert,
  FileText, Loader2, DollarSign, Trash2, CreditCard,
  Fuel, Wallet, Camera, Landmark, Pencil, Clock, AlertTriangle
} from 'lucide-react'
import { useDeliveryCustomerDetails, useDeleteDeliveryCustomer } from '#/lib/hooks/useDeliveryCustomers'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/delivery-customer/details')({
  beforeLoad: () => routeGuard('/delivery-customer'),
  validateSearch: (search: Record<string, unknown>) => ({
    customerId: (search.customerId as string) || '',
  }),
  component: DeliveryCustomerDetailsView,
})

const formatMoney = (n: number | string | undefined | null) => {
  const num = Number(n) || 0
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatQty = (n: number | string | undefined | null) => {
  const num = Number(n) || 0
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function DeliveryCustomerDetailsView() {
  const navigate = useNavigate()
  const routerState = useRouterState()
  const searchParams = Route.useSearch()
  const state = (routerState.location.state || {}) as { customer?: any }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const targetCustomerId = String(searchParams.customerId || state.customer?._id || state.customer?.id || '')
  const { data: fetchedCustomer, isLoading } = useDeliveryCustomerDetails(targetCustomerId)
  const deleteMutation = useDeleteDeliveryCustomer()

  const rawCustomer = state.customer || fetchedCustomer

  // Normalize fields to handle both camelCase and snake_case
  const customer = useMemo(() => {
    if (!rawCustomer) return null
    const c = rawCustomer
    const bankDetails = c.bankDetails || c.bank_details || {}
    return {
      id: c._id || c.id,
      customerType: c.customerType || c.customer_type || 'customer',
      customerCode: c.customerCode || c.customer_code || '',
      name: c.name || c.customer_name || 'Unnamed Customer',
      phoneNumber: c.phoneNumber || c.phone_number || '',
      altPhoneNumber: c.altPhoneNumber || c.alt_phone_number || '',
      email: c.email || '',
      homeAddress: c.homeAddress || c.home_address || '',
      officeAddress: c.officeAddress || c.office_address || '',
      stationAddress: c.stationAddress || c.station_address || '',
      passportPhoto: c.passportPhoto || c.passport_photo || '',
      contactPerson: c.contactPerson || c.contact_person || '',
      contactPersonPhone: c.contactPersonPhone || c.contact_person_phone || '',
      tankCapacity: c.tankCapacity || c.tank_capacity || 0,
      pumpCount: c.pumpCount || c.pump_count || 1,
      creditLimit: Number(c.creditLimit || c.outstanding_limit || 0),
      outstanding: Number(c.outstanding || c.current_balance || 0),
      totalSalesValue: Number(c.totalSalesValue || c.total_value_given || 0),
      totalPayments: Number(c.totalPayments || c.total_payments_received || 0),
      totalQty: Number(c.totalQty || 0),
      bankName: bankDetails.bankName || c.bankName || c.bank_name || '',
      accountNumber: bankDetails.accountNumber || c.accountNumber || c.account_number || '',
      accountName: bankDetails.accountName || c.accountName || c.account_name || '',
      status: c.status || 'active',
      notes: c.notes || '',
      lastTransactionDate: c.lastTransactionDate || c.last_transaction_date || null,
      createdAt: c.createdAt || c.created_at || null,
    }
  }, [rawCustomer])

  const handleDelete = async () => {
    if (!customer?.id) return
    try {
      await deleteMutation.mutateAsync(String(customer.id))
      setShowDeleteConfirm(false)
      navigate({ to: '/delivery-customer' })
    } catch {
      // Error handled in hook toast
    }
  }

  if (!customer && isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-8 text-center max-w-md mx-auto my-12 bg-card rounded-xl border border-border">
        <ShieldAlert className="size-10 mx-auto text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg">Delivery Customer Not Found</h3>
        <p className="text-sm text-muted-foreground mt-1">Please select a valid customer from the directory list.</p>
        <Button onClick={() => navigate({ to: '/delivery-customer' })} className="mt-4">
          Back to Directory
        </Button>
      </div>
    )
  }

  const isStation = customer.customerType === 'filling_station'
  const hasCreditLimit = customer.creditLimit > 0
  const isOverLimit = hasCreditLimit && customer.outstanding > customer.creditLimit
  const isNearLimit = hasCreditLimit && !isOverLimit && customer.outstanding >= customer.creditLimit * 0.8

  return (
    <div className="space-y-6 pb-12 animate-fade-in max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => navigate({ to: '/delivery-customer' })}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <PageHeader
      eyebrow="Truck Sales"
      title={customer.name}
      actions={
        <>
          <p className="text-muted-foreground text-sm mt-0.5">
          Phone: <PhoneLink value={customer.phoneNumber} className="font-semibold" />
          {customer.email && <> • <EmailLink value={customer.email} className="font-semibold" /></>}
          </p>
        </>
      }
    />
        </div>

        <div className="flex gap-2">
          {isStation && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer border-warning/30 text-warning hover:bg-warning/10"
              onClick={() =>
                navigate({
                  to: '/filing-stations/details',
                  search: { stationId: String(customer.id) },
                })
              }
            >
              <Fuel className="size-3.5 mr-1.5" /> Station Ledger
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={() =>
              navigate({
                to: '/delivery-customer/form',
                search: { customerId: String(customer.id) },
                state: { customer } as any,
              })
            }
          >
            <Pencil className="size-3.5 mr-1.5" /> Edit Profile
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="cursor-pointer"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="size-3.5 mr-1.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Customer Header Card with Passport Photo & Main Info */}
      <Card className="bg-card/60 backdrop-blur-sm border-primary/10 overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
            {/* Passport Photo Display */}
            <div className="shrink-0">
              {isStation ? (
                <div className="size-24 rounded-xl bg-warning/10 border-2 border-warning/20 flex items-center justify-center text-warning">
                  <Fuel className="size-11" />
                </div>
              ) : customer.passportPhoto ? (
                <div className="relative group">
                  <img
                    src={customer.passportPhoto}
                    alt={customer.name}
                    className="size-24 rounded-xl object-cover border-2 border-primary/20 transition-transform group-hover:scale-105 duration-250 ease-luxe"
                  />
                  <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-normal pointer-events-none duration-250 ease-luxe">
                    Passport
                  </div>
                </div>
              ) : (
                <div className="size-24 rounded-xl border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center text-muted-foreground">
                  <Camera className="size-7" />
                  <span className="text-xs mt-1 font-normal">No Photo</span>
                </div>
              )}
            </div>

            {/* Profile Overview */}
            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{customer.name}</h2>
                <p className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground font-semibold">
                    {customer.customerCode || 'N/A'}
                  </span>
                  <span>Registered: {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : 'N/A'}</span>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm pt-1">
                <div>
                  <span className="text-xs text-muted-foreground block font-normal">Primary Phone</span>
                  <PhoneLink value={customer.phoneNumber} fallback="N/A" className="font-semibold" />
                </div>

                {customer.altPhoneNumber && (
                  <div>
                    <span className="text-xs text-muted-foreground block font-normal">Alt Phone</span>
                    <PhoneLink value={customer.altPhoneNumber} className="font-semibold" />
                  </div>
                )}

                {customer.email && (
                  <div>
                    <span className="text-xs text-muted-foreground block font-normal">Email Address</span>
                    <EmailLink value={customer.email} className="font-semibold text-foreground truncate block" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial & Operational Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Credit Limit</div>
              <div className="text-xl font-semibold text-foreground mt-0.5">
                {hasCreditLimit ? `₦${formatMoney(customer.creditLimit)}` : 'No Limit'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-accent/10 text-accent">
              <CreditCard className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Outstanding Balance</div>
              <div className={`text-xl font-semibold mt-0.5 flex items-center gap-1 ${isOverLimit ? 'text-destructive' : isNearLimit ? 'text-warning' : 'text-foreground'}`}>
                ₦{formatMoney(customer.outstanding)}
                {isOverLimit && <ShieldAlert className="size-4 text-destructive" />}
                {isNearLimit && <AlertTriangle className="size-4 text-warning" />}
              </div>
            </div>
            <div className={`p-3 rounded-xl ${isOverLimit ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
              <Wallet className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Total Quantity Sold</div>
              <div className="text-xl font-semibold text-foreground mt-0.5">
                {formatQty(customer.totalQty)} Litres
              </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/10 text-muted-foreground">
              <Fuel className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-normal">Last Activity</div>
              <div className="text-sm font-semibold text-foreground mt-0.5">
                {customer.lastTransactionDate
                  ? new Date(customer.lastTransactionDate).toLocaleDateString()
                  : 'No transactions'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-muted/10 text-muted-foreground">
              <Clock className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Contact, Delivery Addresses & Specs */}
        <div className="lg:col-span-2 space-y-6">

          {/* Classification Specs: Station vs Customer */}
          {isStation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Fuel className="size-4 text-warning" /> Filling Station Details & Management
                </CardTitle>
                <CardDescription>Site management and fuel storage specs.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <User className="size-5 text-warning shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Manager's Name</div>
                    <div className="font-semibold text-foreground">{customer.contactPerson || 'N/A'}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Phone className="size-5 text-warning shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Manager's Phone</div>
                    <PhoneLink value={customer.contactPersonPhone} fallback="N/A" className="font-semibold" />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Fuel className="size-5 text-warning shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Tank Storage Capacity</div>
                    <div className="font-semibold text-foreground">{formatQty(customer.tankCapacity)} Litres</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <Building2 className="size-5 text-warning shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Dispensing Pumps</div>
                    <div className="font-semibold text-foreground">{customer.pumpCount || 1} Pumps</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="size-4 text-primary" /> Customer Profile & Photo
                </CardTitle>
                <CardDescription>Personal identification and uploaded passport photo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-muted/30 rounded-xl">
                  {customer.passportPhoto ? (
                    <img
                      src={customer.passportPhoto}
                      alt={customer.name}
                      className="size-20 rounded-xl object-cover border border-border"
                    />
                  ) : (
                    <div className="size-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground bg-muted/40">
                      <Camera className="size-6" />
                    </div>
                  )}
                  <div className="space-y-1 text-center sm:text-left">
                    <h4 className="font-semibold text-foreground">{customer.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {customer.passportPhoto ? 'Passport Photo Verified' : 'No passport photo uploaded for this customer.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Delivery & Addresses */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-4 text-primary" /> Delivery & Site Addresses
              </CardTitle>
              <CardDescription>Primary dispatch and drop-off locations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {isStation ? (
                <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                  <MapPin className="size-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-muted-foreground font-normal">Station Address</div>
                    <div className="font-semibold text-foreground">{customer.stationAddress || 'No station address specified'}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                    <MapPin className="size-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground font-normal">Home Address</div>
                      <div className="font-semibold text-foreground">{customer.homeAddress || 'No home address specified'}</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                    <Building2 className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground font-normal">Office Address</div>
                      <div className="font-semibold text-foreground">{customer.officeAddress || 'No office address specified'}</div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Bank Details & Notes */}
        <div className="space-y-6">

          {/* Bank & Settlement Account Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="size-4 text-primary" /> Bank & Settlement Account
              </CardTitle>
              <CardDescription>Registered banking credentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="p-3 bg-muted/30 rounded-xl space-y-1">
                <span className="text-xs text-muted-foreground font-normal">Bank Name</span>
                <div className="font-semibold text-foreground">{customer.bankName || 'Not specified'}</div>
              </div>

              <div className="p-3 bg-muted/30 rounded-xl space-y-1">
                <span className="text-xs text-muted-foreground font-normal">Account Number</span>
                <div className="font-semibold font-mono text-foreground">{customer.accountNumber || 'Not specified'}</div>
              </div>

              <div className="p-3 bg-muted/30 rounded-xl space-y-1">
                <span className="text-xs text-muted-foreground font-normal">Account Name</span>
                <div className="font-semibold text-foreground">{customer.accountName || 'Not specified'}</div>
              </div>
            </CardContent>
          </Card>

          {/* Financial Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="size-4 text-primary" /> Sales & Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between items-center p-2.5 bg-muted/20 rounded-lg">
                <span className="text-xs text-muted-foreground">Total Sales Value</span>
                <span className="font-semibold text-foreground">₦{formatMoney(customer.totalSalesValue)}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 bg-muted/20 rounded-lg">
                <span className="text-xs text-muted-foreground">Total Payments Received</span>
                <span className="font-semibold text-accent">₦{formatMoney(customer.totalPayments)}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 bg-muted/20 rounded-lg">
                <span className="text-xs text-muted-foreground">Net Outstanding</span>
                <span className={`font-semibold ${isOverLimit ? 'text-destructive' : 'text-foreground'}`}>
                  ₦{formatMoney(customer.outstanding)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 text-muted-foreground" /> Notes & Remarks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-xl min-h-[80px] whitespace-pre-line">
                {customer.notes || 'No notes added for this customer.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <ShieldAlert className="size-7" />
              <h3 className="font-semibold text-lg text-foreground">Delete Customer Profile</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{customer.name}</strong> ({customer.customerCode || 'N/A'})? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Customer'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
