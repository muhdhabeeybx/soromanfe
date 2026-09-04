import { useState, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardHeader, CardTitle, CardContent } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import {
  Plus, Search, Download, Eye,
  Users, Phone, Wallet, UserCheck, UserX, UserMinus,
  MapPin, Mail, CreditCard, Clock, User, Fuel,
  ShieldAlert, AlertTriangle
} from 'lucide-react'
import { useDeliveryCustomerList, useDeleteDeliveryCustomer } from '#/lib/hooks/useDeliveryCustomers'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

type DeliveryCustomer = {
  _id: string
  id?: string
  customerType: 'customer' | 'filling_station'
  customerCode?: string
  name: string
  phoneNumber: string
  altPhoneNumber?: string
  email?: string
  homeAddress?: string
  officeAddress?: string
  passportPhoto?: string
  contactPerson?: string
  contactPersonPhone?: string
  stationAddress?: string
  tankCapacity?: number
  pumpCount?: number
  paystackCustomerId?: string
  virtualAccountNumber?: string
  virtualAccountBank?: string
  creditLimit?: number
  outstanding?: number
  totalSalesValue?: number
  totalPayments?: number
  totalQty?: number
  status: 'active' | 'dormant' | 'suspended'
  notes?: string
  lastTransactionDate?: string | null
  createdAt?: string
  updatedAt?: string
  _autoDormant?: boolean
}

export const Route = createFileRoute('/delivery-customer/')({
  beforeLoad: () => routeGuard('/delivery-customer'),
  component: DeliveryCustomerListRoute,
})

const AUTO_DORMANT_DAYS = 60
const LEGACY_TYPE_PREFIX = '__type:filling_station__'

const cleanNotes = (notes?: string): string =>
  notes?.startsWith(LEGACY_TYPE_PREFIX)
    ? notes.slice(LEGACY_TYPE_PREFIX.length)
    : (notes || '')

const toNum = (v: string | number | undefined | null): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const fmtMoney = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Check if customer hasn't had transactions in 60+ days */
function isAutoDormant(lastTxnDate?: string | Date | null): boolean {
  if (!lastTxnDate) return false
  try {
    const diffTime = Math.abs(new Date().getTime() - new Date(lastTxnDate).getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays >= AUTO_DORMANT_DAYS
  } catch {
    return false
  }
}

function getDaysSinceTxn(lastTxnDate?: string | Date | null): number | null {
  if (!lastTxnDate) return null
  try {
    const diffTime = Math.abs(new Date().getTime() - new Date(lastTxnDate).getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

const statusConfig = {
  active: { label: 'Active', cls: 'bg-accent/10 text-accent border-accent/20', icon: UserCheck },
  dormant: { label: 'Dormant', cls: 'bg-warning/10 text-warning border-warning/20', icon: UserMinus },
  suspended: { label: 'Suspended', cls: 'bg-destructive/10 text-destructive border-destructive/20', icon: UserX },
}

function DeliveryCustomerListRoute() {
  const navigate = useNavigate()
  const deleteMutation = useDeleteDeliveryCustomer()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'customer' | 'filling_station'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'dormant' | 'suspended' | 'auto-dormant'>('all')

  // Drill-down Modal State
  const [selectedCustomer, setSelectedCustomer] = useState<DeliveryCustomer | null>(null)

  // Delete Modal State
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: rawCustomers, isLoading } = useDeliveryCustomerList({
    search: search.trim(),
    type: typeFilter === 'all' ? undefined : typeFilter,
  })

  // Format and standardize backend fields (supporting snake_case & camelCase)
  const customers = useMemo(() => {
    if (!rawCustomers) return []
    const list = Array.isArray(rawCustomers)
      ? rawCustomers
      : (rawCustomers.customers || rawCustomers.data || [])
    if (!Array.isArray(list)) return []

    return list.map((c) => {
      const name = c.name || c.customer_name || 'Unnamed'
      const phoneNumber = c.phoneNumber || c.phone_number || ''
      const altPhoneNumber = c.altPhoneNumber || c.alt_phone_number || ''
      const email = c.email || ''
      const homeAddress = c.homeAddress || c.home_address || ''
      const officeAddress = c.officeAddress || c.office_address || ''
      const stationAddress = c.stationAddress || c.station_address || ''
      const contactPerson = c.contactPerson || c.contact_person || ''
      const contactPersonPhone = c.contactPersonPhone || c.contact_person_phone || ''
      const passportPhoto = c.passportPhoto || c.passport_photo || ''
      const creditLimit = toNum(c.creditLimit || c.outstanding_limit)
      const outstanding = toNum(c.outstanding || c.current_balance)
      const totalSalesValue = toNum(c.totalSalesValue || c.total_value_given)
      const totalPayments = toNum(c.totalPayments || c.total_payments_received)
      const totalQty = toNum(c.totalQty)
      const lastTransactionDate = c.lastTransactionDate || c.last_transaction_date || null
      const paystackCustomerId = c.paystackCustomerId || ''
      const virtualAccountNumber = c.virtualAccountNumber || ''
      const virtualAccountBank = c.virtualAccountBank || ''

      const autoDormant = (c.status === 'active' || !c.status) && isAutoDormant(lastTransactionDate)

      return {
        ...c,
        _id: c._id || c.id,
        name,
        phoneNumber,
        altPhoneNumber,
        email,
        homeAddress,
        officeAddress,
        stationAddress,
        contactPerson,
        contactPersonPhone,
        passportPhoto,
        creditLimit,
        outstanding,
        totalSalesValue,
        totalPayments,
        totalQty,
        paystackCustomerId,
        virtualAccountNumber,
        virtualAccountBank,
        notes: cleanNotes(c.notes),
        lastTransactionDate,
        _autoDormant: autoDormant,
      } as DeliveryCustomer & { _autoDormant: boolean }
    })
  }, [rawCustomers])

  // Filter list
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (typeFilter !== 'all' && c.customerType !== typeFilter) return false

      if (statusFilter === 'auto-dormant') {
        if (!c._autoDormant) return false
      } else if (statusFilter !== 'all') {
        if (c.status !== statusFilter) return false
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const textToSearch = `${c.name} ${c.phoneNumber} ${c.altPhoneNumber || ''} ${c.customerCode || ''} ${c.contactPerson || ''} ${c.email || ''}`.toLowerCase()
        if (!textToSearch.includes(q)) return false
      }

      return true
    })
  }, [customers, typeFilter, statusFilter, search])

  // Metrics
  const stats = useMemo(() => {
    const total = customers.length
    const regular = customers.filter((c) => c.customerType === 'customer').length
    const stations = customers.filter((c) => c.customerType === 'filling_station').length
    const autoDormantCount = customers.filter((c) => c._autoDormant).length
    const totalCreditLimit = customers.reduce((sum, c) => sum + (c.creditLimit || 0), 0)
    const totalQtySold = customers.reduce((sum, c) => sum + (c.totalQty || 0), 0)

    return { total, regular, stations, autoDormantCount, totalCreditLimit, totalQtySold }
  }, [customers])

  // Handle Delete
  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      if (selectedCustomer && selectedCustomer._id === deleteTarget.id) {
        setSelectedCustomer(null)
      }
    } catch {
      // Error handled by mutation toast
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredCustomers.length === 0) return
    const headers = [
      'S/N', 'Classification', 'Name', 'Phone', 'Alt Phone', 'Email',
      'Address', 'Contact Person', 'Credit Limit (NGN)', 'Outstanding (NGN)',
      'Status', 'Auto-Dormant', 'Days Inactive', 'Notes'
    ]
    const rows = filteredCustomers.map((c, idx) => {
      const days = getDaysSinceTxn(c.lastTransactionDate)
      return [
        idx + 1,
        c.customerType === 'filling_station' ? 'Filling Station' : 'Individual Customer',
        `"${c.name}"`,
        `"${c.phoneNumber}"`,
        `"${c.altPhoneNumber || 'N/A'}"`,
        c.email || 'N/A',
        `"${c.stationAddress || c.homeAddress || c.officeAddress || 'N/A'}"`,
        `"${c.contactPerson || 'N/A'}"`,
        c.creditLimit || 0,
        c.outstanding || 0,
        c.status || 'active',
        c._autoDormant ? 'Yes' : 'No',
        days !== null ? days : 'N/A',
        `"${(c.notes || '').replace(/"/g, '""')}"`,
      ]
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `delivery-customers-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
      eyebrow="Truck Sales"
      title="Delivery Customers Database"
      description="Comprehensive customer profiles, credit limit tracking, and auto-dormancy monitoring."
      actions={
        <>
          <div className="flex items-center gap-2">
          <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={filteredCustomers.length === 0}
          className="cursor-pointer"
          >
          <Download className="size-4 mr-2" /> Export CSV
          </Button>
          <Button
          onClick={() => navigate({ to: '/delivery-customer/form' as any })}
          className="cursor-pointer"
          >
          <Plus className="size-4 mr-2" /> Add Delivery Customer
          </Button>
          </div>
        </>
      }
    />

      {/* Metric Summary Cards */}
      <StatCardGrid count={4}>
        <StatCard icon={<Users />} label="Total directory" value={stats.total} />
        <StatCard icon={<User />} label="Regular customers" value={stats.regular} />
        <StatCard tone="amber" icon={<Fuel />} label="Filling stations" value={stats.stations} />
        <StatCard
          icon={<Wallet />}
          label="Total credit limit"
          value={`₦${stats.totalCreditLimit.toLocaleString()}`}
        />
      </StatCardGrid>

      {/* Filter and Search Bar */}
      <Card className="bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
 />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Type selector */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
 >
              <option value="all">All Classifications</option>
              <option value="customer">Regular Customers</option>
              <option value="filling_station">Filling Stations</option>
            </select>

            {/* Status selector */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
 >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="suspended">Suspended</option>
              <option value="auto-dormant">⏰ Auto-Dormant (60d+)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Directory Table */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base font-normal">
            Directory Entries ({filteredCustomers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading delivery customers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              No delivery customers found matching your filters.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredCustomers.map((c, idx) => {
                const isStation = c.customerType === 'filling_station'
                const statusInfo = statusConfig[c.status] || statusConfig.active
                const StatusIcon = statusInfo.icon
                const daysInactive = getDaysSinceTxn(c.lastTransactionDate)
                const creditLimit = toNum(c.creditLimit)
                const outstanding = toNum(c.outstanding)
                const hasLimit = creditLimit > 0
                const isOverLimit = hasLimit && outstanding > creditLimit
                const isNearLimit = hasLimit && !isOverLimit && outstanding >= creditLimit * 0.8

                return (
                  <div
                    key={c._id}
                    className="p-4 hover:bg-muted/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer duration-250 ease-luxe"
                    onClick={() => setSelectedCustomer(c)}
 >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground font-mono mt-2 w-6">{idx + 1}.</span>

                      <div
                        className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${isStation
 ? 'bg-warning/10 text-warning'
 : 'bg-primary/10 text-primary'
 }`}
 >
                        {isStation ? <Fuel className="size-5" /> : <User className="size-5" />}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base truncate">{c.name}</span>
                          <Badge variant="outline" className="font-mono text-xs uppercase">
                            {c.customerCode || (isStation ? 'STATION' : 'CUSTOMER')}
                          </Badge>
                          <Badge className={`text-xs border capitalize font-normal flex items-center gap-1 ${statusInfo.cls}`}>
                            <StatusIcon className="size-3" /> {statusInfo.label}
                          </Badge>
                          {c._autoDormant && (
                            <Badge className="bg-warning/10 text-warning border-warning/20 text-xs flex items-center gap-1">
                              <Clock className="size-2.5" /> Auto-Dormant ({daysInactive ? `${daysInactive}d` : '60d+'})
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
                          {c.phoneNumber && (
                            <span className="flex items-center gap-1">
                              <Phone className="size-3" /> <PhoneLink value={c.phoneNumber} className="font-semibold" />
                              {c.altPhoneNumber && (
                                <span className="ml-1 text-muted-foreground">/ <PhoneLink value={c.altPhoneNumber} className="font-semibold" /></span>
                              )}
                            </span>
                          )}
                          {c.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="size-3" /> <EmailLink value={c.email} />
                            </span>
                          )}
                          <span className="flex items-center gap-1 truncate max-w-xs">
                            <MapPin className="size-3" /> {c.stationAddress || c.homeAddress || c.officeAddress || 'No Address'}
                          </span>
                          {hasLimit && (
                            <span className="flex items-center gap-1 font-semibold text-accent">
                              <CreditCard className="size-3" /> Limit: ₦{fmtMoney(creditLimit)}
                            </span>
                          )}
                          {outstanding > 0 && (
                            <span className={`flex items-center gap-1 font-semibold ${isOverLimit ? 'text-destructive' : isNearLimit ? 'text-warning' : 'text-foreground'}`}>
                              {isOverLimit && <ShieldAlert className="size-3" />}
                              {isNearLimit && <AlertTriangle className="size-3" />}
                              Outst: ₦{fmtMoney(outstanding)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end md:self-center" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={() => setSelectedCustomer(c)}
                        title="Quick Profile View"
 >
                        <Eye className="size-3.5 mr-1" /> Quick View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={() =>
                          navigate({
                            to: '/delivery-customer/details',
                            search: { customerId: c._id },
                            state: { customer: c } as any,
                          })
                        }
 >
                        Details
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick View Dialog Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-xl w-full p-6 space-y-4 max-h-[90svh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {selectedCustomer.customerType === 'filling_station' ? (
                  <div className="p-3 rounded-xl bg-warning/10 text-warning">
                    <Fuel className="size-6" />
                  </div>
                ) : selectedCustomer.passportPhoto ? (
                  <img
                    src={selectedCustomer.passportPhoto}
                    alt={selectedCustomer.name}
                    className="size-12 rounded-xl object-cover border border-border"
 />
                ) : (
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <User className="size-6" />
                  </div>
                )}
                <div>
                  <h3 className="font-semibold text-lg">{selectedCustomer.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selectedCustomer.customerCode || (selectedCustomer.customerType === 'filling_station' ? 'STATION' : 'CUSTOMER')}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>
                ✕
              </Button>
            </div>

            {selectedCustomer._autoDormant && (
              <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl text-warning text-xs flex items-center gap-2">
                <Clock className="size-4" />
                <span>
                  <strong>Auto-Dormant Alert:</strong> Inactive for {getDaysSinceTxn(selectedCustomer.lastTransactionDate) ?? '60+'} days. Consider reaching out to re-engage.
                </span>
              </div>
            )}

            <div className="space-y-3 text-sm">
              {/* Profile Details */}
              <div className="bg-muted/30 p-3 rounded-xl space-y-2">
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Classification</span>
                  <span className="font-semibold capitalize flex items-center gap-1">
                    {selectedCustomer.customerType === 'filling_station' ? (
                      <><Fuel className="size-3.5 text-warning" /> Filling Station</>
                    ) : (
                      <><User className="size-3.5 text-primary" /> Regular Customer</>
                    )}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Primary Phone</span>
                  <PhoneLink value={selectedCustomer.phoneNumber} className="font-semibold" />
                </div>

                {selectedCustomer.altPhoneNumber && (
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Alt Phone</span>
                    <PhoneLink value={selectedCustomer.altPhoneNumber} className="font-semibold" />
                  </div>
                )}

                {selectedCustomer.email && (
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Email</span>
                    <EmailLink value={selectedCustomer.email} className="font-semibold" />
                  </div>
                )}

                {selectedCustomer.customerType === 'filling_station' && selectedCustomer.contactPerson && (
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Station Manager</span>
                    <span className="font-semibold">
                      {selectedCustomer.contactPerson}
                      {selectedCustomer.contactPersonPhone && (
                        <> (<PhoneLink value={selectedCustomer.contactPersonPhone} />)</>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              <div className="bg-muted/30 p-3 rounded-xl space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
                  <Wallet className="size-3" /> Financial Summary
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Credit Limit</span>
                    <span className="font-semibold text-foreground">
                      ₦{fmtMoney(toNum(selectedCustomer.creditLimit))}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Outstanding</span>
                    <span className={`font-semibold ${toNum(selectedCustomer.outstanding) > toNum(selectedCustomer.creditLimit) && toNum(selectedCustomer.creditLimit) > 0 ? 'text-destructive' : 'text-foreground'}`}>
                      ₦{fmtMoney(toNum(selectedCustomer.outstanding))}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Total Sales Value</span>
                    <span className="font-semibold text-foreground">
                      ₦{fmtMoney(toNum(selectedCustomer.totalSalesValue))}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Total Payments</span>
                    <span className="font-semibold text-accent">
                      ₦{fmtMoney(toNum(selectedCustomer.totalPayments))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Primary Address */}
              <div className="bg-muted/30 p-3 rounded-xl space-y-1">
                <span className="text-muted-foreground text-xs block font-normal">Primary Address</span>
                <span className="text-xs font-semibold">
                  {selectedCustomer.stationAddress || selectedCustomer.homeAddress || selectedCustomer.officeAddress || 'N/A'}
                </span>
              </div>

              {/* Notes */}
              {selectedCustomer.notes && (
                <div className="bg-muted/30 p-3 rounded-xl space-y-1">
                  <span className="text-muted-foreground text-xs block font-normal">Remarks / Notes</span>
                  <span className="text-xs text-foreground font-normal">{selectedCustomer.notes}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setSelectedCustomer(null)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const target = selectedCustomer
                  setSelectedCustomer(null)
                  navigate({
                    to: '/delivery-customer/details',
                    search: { customerId: target._id },
                    state: { customer: target } as any,
                  })
                }}
 >
                Full Profile Details
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <ShieldAlert className="size-7" />
              <h3 className="font-semibold text-lg text-foreground">Delete Customer Profile</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
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
