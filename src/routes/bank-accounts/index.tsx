import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import {
  Landmark,
  Plus,
  Search,
  Edit,
  Eye,
  Trash2,
  Copy,
  Check,
  Warehouse,
  Flame,
  ShieldCheck,
  X,
  Loader2,
  Building2,
  Star,
} from 'lucide-react'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { useBankAccounts, useDeleteBankAccount } from '#/lib/hooks/useBankAccounts'
import { useDepots } from '#/lib/hooks/useDepots'
import { useLpgStations } from '#/lib/hooks/useLpgStations'
import { useToast } from '#/lib/hooks/useToast'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/bank-accounts/')({
  beforeLoad: () => routeGuard('/bank-accounts'),
  component: BankAccountsIndex,
})

function getStatusBadge(status: string) {
  switch (status) {
    case 'Active':
      return <Badge className="bg-accent/15 text-accent border-accent/30 font-normal">{status}</Badge>
    case 'Inactive':
      return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>
    case 'Suspended':
      return <Badge variant="destructive">{status}</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function BankAccountsIndex() {
  const navigate = useNavigate()
  const toast = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [copiedId, setCopiedId] = useState<string | number | null>(null)
  const [deletingId, setDeletingId] = useState<string | number | null>(null)

  const { data: bankAccounts = [], isLoading, isError, error, refetch } = useBankAccounts()
  const hasFilters = !!(searchTerm || statusFilter !== 'ALL')
  const { data: depots = [] } = useDepots()
  const { data: lpgStations = [] } = useLpgStations({ limit: 100 })
  const deleteBankAccount = useDeleteBankAccount()

  const handleCopyAccount = (accountNumber: string, id: string | number) => {
    navigator.clipboard.writeText(accountNumber)
    setCopiedId(id)
    toast.success(`Account number ${accountNumber} copied to clipboard`)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleDelete = async (id: string | number, name: string) => {
    if (window.confirm(`Are you sure you want to delete bank account "${name}"?`)) {
      setDeletingId(id)
      try {
        await deleteBankAccount.mutateAsync(id)
      } finally {
        setDeletingId(null)
      }
    }
  }

  const filteredAccounts = bankAccounts.filter((account) => {
    const matchesSearch =
      account.bankName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.accountNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (account.depots || []).some(
        (d) =>
          d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          d.code.toLowerCase().includes(searchTerm.toLowerCase())
      ) ||
      (account.lpgStations || []).some(
        (s) =>
          s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.code?.toLowerCase().includes(searchTerm.toLowerCase())
      )

    const matchesStatus = statusFilter === 'ALL' || account.status === statusFilter
    return matchesSearch && matchesStatus
  })

  // Linked locations count across all bank accounts
  // PFIs are the assignment now; depots are derived from them. Counting PFIs
  // is what tells you how much of the book is actually covered — two PFIs at
  // one location are two assignments, and counting locations hid that.
  const uniqueLinkedPfiIds = new Set(bankAccounts.flatMap((acc) => acc.pfiIds || []))
  const uniqueLinkedDepotIds = new Set(bankAccounts.flatMap((acc) => acc.depotIds || []))
  const uniqueLinkedStationIds = new Set(bankAccounts.flatMap((acc) => acc.lpgStationIds || []))
  const activeCount = bankAccounts.filter((a) => a.status === 'Active').length
  const defaultAccount = bankAccounts.find((a) => a.isDefault)

  const statsCards = [
    {
      title: 'Total Bank Accounts',
      value: bankAccounts.length,
      sub: `${activeCount} Active`,
      icon: Landmark,
      color: 'text-accent',
    },
    {
      title: 'Locations Connected',
      value: uniqueLinkedPfiIds.size + uniqueLinkedStationIds.size,
      sub: `${uniqueLinkedPfiIds.size} PFIs · ${uniqueLinkedDepotIds.size} Locations · ${uniqueLinkedStationIds.size} LPG Stations`,
      icon: Warehouse,
      color: 'text-muted-foreground',
    },
    {
      title: 'Primary Operating Account',
      value: defaultAccount ? defaultAccount.bankName : 'None set',
      sub: defaultAccount ? defaultAccount.accountNumber : 'Set a default account',
      icon: ShieldCheck,
      color: 'text-warning',
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section */}
      <PageHeader
      eyebrow="Finance"
      title="Bank Accounts Management"
      description="Manage corporate bank accounts and depot/station collection assignments. Multiple locations can share a single bank account."
      actions={
        <>
          <Button
          size="sm"
          className="shrink-0"
          onClick={() => navigate({ to: '/bank-accounts/form' })}
          >
          <Plus className="size-4 mr-2" />
          Add Bank Account
          </Button>
        </>
      }
    />

      {/* Stats Cards */}
      {!isLoading && !isError && (
        <StatCardGrid count={statsCards.length}>
          {statsCards.map((card) => (
            <StatCard
              key={card.title}
              icon={<card.icon />}
              label={card.title}
              value={card.value}
              description={card.sub}
            />
          ))}
        </StatCardGrid>
      )}

      {/* Main Content Card */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Bank Accounts Directory</CardTitle>
              <CardDescription>View, edit, and assign bank accounts to operational depots and LPG stations</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Filters */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by bank name, account number, depot, or station..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-9 bg-background/50"
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
            <div className="w-full md:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="Suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Accounts Grid */}
          {isLoading ? (
            <PageLoader message="Loading bank accounts..." />
          ) : isError ? (
            <PageError message={(error as any)?.message || 'Failed to load'} onRetry={() => refetch()} />
          ) : filteredAccounts.length === 0 ? (
            <PageEmpty
              icon={<Landmark className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No bank accounts match your filters' : 'No bank accounts yet'}
              description={hasFilters ? 'No bank accounts match your search or filter parameters.' : 'Get started by adding your first company bank account.'}
              actionLabel="Add Bank Account"
              onAction={() => navigate({ to: '/bank-accounts/form' })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setStatusFilter('ALL') }}
 />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
              {filteredAccounts.map((account) => {
                const assignedDepots = account.depots || []
                const assignedStations = account.lpgStations || []
                const totalLocations = assignedDepots.length + assignedStations.length

                return (
                  <Card
                    key={account.id}
                    className="card-hover border-border/60 hover:border-primary/40 bg-card/80 transition-all flex flex-col justify-between overflow-hidden group duration-250 ease-luxe"
 >
                    <CardContent className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        {/* Header: Bank Name & Badges */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                              <Building2 className="size-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-foreground text-base tracking-tight leading-snug">
                                {account.bankName}
                              </h3>
                              {account.branchName && (
                                <p className="text-xs text-muted-foreground truncate">{account.branchName}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {account.isDefault && (
                              <Badge className="bg-warning/15 text-warning border-warning/30 gap-1 text-xs py-0.5 px-2">
                                <Star className="size-3 fill-warning" /> Default
                              </Badge>
                            )}
                            {getStatusBadge(account.status)}
                          </div>
                        </div>

                        {/* Account Number Box */}
                        <div className="bg-muted/40 border border-border/50 rounded-lg p-3 my-3 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">
                              Account Number ({account.currency})
                            </p>
                            <p className="text-lg font-mono font-semibold text-foreground">
                              {account.accountNumber}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() => handleCopyAccount(account.accountNumber, account.id)}
                            title="Copy Account Number"
 >
                            {copiedId === account.id ? (
                              <Check className="size-4 text-accent" />
                            ) : (
                              <Copy className="size-4" />
                            )}
                          </Button>
                        </div>

                        {/* Account Name */}
                        <div className="mb-3">
                          <p className="text-xs text-muted-foreground uppercase font-normal">Account Name</p>
                          <p className="text-sm font-semibold text-foreground truncate">{account.accountName}</p>
                        </div>

                        {/* Linked Depots & Stations Section */}
                        <div className="mt-4 pt-3 border-t border-border/40 space-y-2.5">
                          {/* Depots */}
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground font-normal flex items-center gap-1.5">
                                <Warehouse className="size-3.5 text-primary" /> Depots ({assignedDepots.length})
                              </span>
                              {totalLocations > 1 && (
                                <span className="text-xs text-warning font-semibold bg-warning/10 px-1.5 py-0.5 rounded border border-warning/20">
                                  Shared Account
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto pr-1">
                              {assignedDepots.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No depots assigned</span>
                              ) : (
                                assignedDepots.map((depot) => (
                                  <Badge
                                    key={depot.id}
                                    variant="secondary"
                                    className="text-xs bg-primary/10 text-primary border border-primary/20 font-normal py-0.5"
 >
                                    {depot.name} ({depot.code})
                                  </Badge>
                                ))
                              )}
                            </div>
                          </div>

                          {/* LPG Stations */}
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground font-normal flex items-center gap-1.5">
                                <Flame className="size-3.5 text-primary" /> LPG Stations ({assignedStations.length})
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto pr-1">
                              {assignedStations.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No stations assigned</span>
                              ) : (
                                assignedStations.map((station) => (
                                  <Badge
                                    key={station.id}
                                    variant="secondary"
                                    className="text-xs bg-primary/15 text-primary border border-primary/30 font-normal py-0.5"
 >
                                    {station.name} ({station.code})
                                  </Badge>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Actions Footer */}
                      <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-border/40">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs font-normal"
                          onClick={() =>
                            navigate({
                              to: '/bank-accounts/details' as any,
                              state: { bankAccount: account } as any,
                            })
                          }
 >
                          <Eye className="size-3.5 mr-1" /> View Details
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-normal border-border/60"
                          onClick={() =>
                            navigate({
                              to: '/bank-accounts/form' as any,
                              state: { bankAccount: account, isEdit: true } as any,
                            })
                          }
 >
                          <Edit className="size-3.5 mr-1" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs font-normal text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                          disabled={deletingId === account.id}
                          onClick={() => handleDelete(account.id, account.bankName)}
 >
                          {deletingId === account.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
