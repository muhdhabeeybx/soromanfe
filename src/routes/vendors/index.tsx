import { useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import { Store, Plus, Search, Edit, Eye, X, Users, ShieldCheck } from 'lucide-react'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { useVendors } from '#/lib/hooks/useVendors'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/vendors/')({
  beforeLoad: () => routeGuard('/vendors'),
  component: VendorsIndex,
})

function getStatusBadge(status: string) {
  return status === 'Active' ? (
    <Badge className="bg-accent/15 text-accent border-accent/30 font-normal">{status}</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">{status}</Badge>
  )
}

function VendorsIndex() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  const { data: vendors = [], isLoading, isError, error, refetch } = useVendors({
    search: searchTerm || undefined,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
  })
  const hasFilters = !!(searchTerm || statusFilter !== 'ALL')

  const activeCount = vendors.filter((v) => v.status === 'Active').length

  const statsCards = [
    { title: 'Total Vendors', value: vendors.length, sub: `${activeCount} Active`, icon: Store, },
    { title: 'Active Vendors', value: activeCount, sub: 'Selectable when raising an expense', icon: ShieldCheck },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Expenses"
        title="Vendor Management"
        description="Vendors billed on expense requests. Save one here or straight from the expense form — either way it shows up on both."
        actions={
          <Button size="sm" className="shrink-0" onClick={() => navigate({ to: '/vendors/form' })}>
            <Plus className="size-4 mr-2" />
            Add Vendor
          </Button>
        }
      />

      {!isLoading && !isError && (
        <StatCardGrid count={statsCards.length}>
          {statsCards.map((card) => (
            <StatCard key={card.title} icon={<card.icon />} label={card.title} value={card.value} description={card.sub} />
          ))}
        </StatCardGrid>
      )}

      <Card className="border-border/50">
        <CardHeader className="border-b border-border/40 pb-4">
          <CardTitle className="text-xl">Vendor Directory</CardTitle>
          <CardDescription>Search, review, and manage vendors billed on expense requests</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by vendor name..."
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
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <PageLoader message="Loading vendors..." />
          ) : isError ? (
            <PageError message={(error as any)?.message || 'Failed to load'} onRetry={() => refetch()} />
          ) : vendors.length === 0 ? (
            <PageEmpty
              icon={<Store className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No vendors match your filters' : 'No vendors yet'}
              description={hasFilters ? 'No vendors match your search or filter parameters.' : 'Vendors saved here — or saved from an expense request — show up in this list.'}
              actionLabel="Add Vendor"
              onAction={() => navigate({ to: '/vendors/form' })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setStatusFilter('ALL') }}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {vendors.map((vendor) => (
                <Card
                  key={vendor.id}
                  className="card-hover border-border/60 hover:border-primary/40 bg-card/80 transition-all flex flex-col justify-between overflow-hidden group duration-250 ease-luxe"
                >
                  <CardContent className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <Store className="size-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground text-base tracking-tight leading-snug">{vendor.name}</h3>
                            {vendor.contactPerson && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                <Users className="size-3" /> {vendor.contactPerson}
                              </p>
                            )}
                          </div>
                        </div>
                        {getStatusBadge(vendor.status)}
                      </div>

                      {(vendor.phone || vendor.email) && (
                        <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                          {vendor.phone && <p><PhoneLink value={vendor.phone} /></p>}
                          {vendor.email && <p className="truncate"><EmailLink value={vendor.email} /></p>}
                        </div>
                      )}

                      {vendor.bankName && (
                        <div className="bg-muted/40 border border-border/50 rounded-lg p-2.5 text-xs">
                          <p className="text-muted-foreground uppercase font-semibold">{vendor.bankName}</p>
                          <p className="font-mono text-foreground mt-0.5">{vendor.accountNumber}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border/40">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs font-normal"
                        onClick={() => navigate({ to: '/vendors/details' as any, state: { vendor } as any })}
                      >
                        <Eye className="size-3.5 mr-1" /> View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-normal border-border/60"
                        onClick={() => navigate({ to: '/vendors/form' as any, state: { vendor, isEdit: true } as any })}
                      >
                        <Edit className="size-3.5 mr-1" /> Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
