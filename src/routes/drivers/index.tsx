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
import { Contact, Search, Plus, UserCheck, UserX, Star, Phone, Mail, Truck, FileText, X, SearchX, Loader2 } from 'lucide-react'
import { useDriverList } from '#/lib/hooks/useDrivers'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/drivers/')({
  beforeLoad: () => routeGuard('/drivers'),
  component: DriversDashboard,
})

function getSafetyColor(score: number) {
  if (score >= 95) return 'text-success'
  if (score >= 90) return 'text-warning'
  return 'text-destructive'
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'On Trip': return <Badge className="bg-success text-success-foreground">{status}</Badge>
    case 'Active': return <Badge className="bg-info text-info-foreground">{status}</Badge>
    case 'Off Duty': return <Badge className="bg-warning text-warning-foreground">{status}</Badge>
    default: return <Badge variant="outline">{status}</Badge>
  }
}

function DriversDashboard() {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)

  const { data, isLoading } = useDriverList({ search: searchTerm || undefined, status: selectedStatus !== 'all' ? selectedStatus : undefined })
  const drivers = data?.drivers || []

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedStatus])

  const totalItems = drivers.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedDrivers = drivers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )
  const stats = {
    total: data?.pagination?.total || 0,
    onTrip: drivers.filter((d: any) => d.status === 'On Trip').length,
    active: drivers.filter((d: any) => d.status === 'Active').length,
    offDuty: drivers.filter((d: any) => d.status === 'Off Duty').length,
  }
  const getInitials = (name: string) => { const parts = name.split(' '); return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
      eyebrow="Transport"
      title="Drivers Directory"
      description="Manage driver profiles, license records, safety scores, and schedule status."
      actions={
        <>
          <Button size="sm"  onClick={() => navigate({ to: '/drivers/form' })}><Plus className="size-4 mr-2" />Register New Driver</Button>
        </>
      }
    />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Contact />} label="Total Drivers" value={stats.total} />
        <StatCard icon={<Truck />} label="On Active Trip" value={stats.onTrip} />
        <StatCard icon={<UserCheck />} label="Available (Standby)" value={stats.active} />
        <StatCard tone="amber" icon={<UserX />} label="Off Duty" value={stats.offDuty} />
      </div>

      <FilterBar>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
        <Input type="text" placeholder="Search driver by name, DL..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors duration-250 ease-luxe" aria-label="Clear search"><X className="size-2.5" /></button>}
        </div>
        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
        <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
        <SelectContent>
        <SelectItem value="all">All Statuses</SelectItem>
        <SelectItem value="Active">Available (Standby)</SelectItem>
        <SelectItem value="On Trip">On Trip</SelectItem>
        <SelectItem value="Off Duty">Off Duty</SelectItem>
        </SelectContent>
        </Select>
        </div>
      </FilterBar>

      <Card>
        
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : drivers.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-xl bg-muted border border-border mb-4"><SearchX className="size-6 text-muted-foreground" /></div>
              <p className="text-sm font-normal text-foreground">No drivers found</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your search or filter criteria.</p>
              <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(''); setSelectedStatus('all') }} className="mt-4 text-primary"><X className="size-3.5" /> Clear filters</Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Driver</TableHead><TableHead>License Details</TableHead><TableHead className="hidden lg:table-cell">Assigned Vehicle</TableHead><TableHead>Safety Score</TableHead><TableHead className="hidden md:table-cell">Contact Info</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {paginatedDrivers.map((driver: any) => (
                      <TableRow key={driver._id} tabIndex={0} role="link" aria-label={`View ${driver.name}`} className="cursor-pointer hover:bg-muted transition" onClick={() => navigate({ to: '/drivers/details' as any, search: { id: driver._id || driver.id } as any, state: { driver } } as any)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate({ to: '/drivers/details' as any, search: { id: driver._id || driver.id } as any, state: { driver } } as any) } }}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="size-10 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-normal">{getInitials(driver.name)}</div>
                            <p className="font-normal">{driver.name}</p>
                          </div>
                        </TableCell>
                        <TableCell><div className="space-y-0.5"><div className="flex items-center gap-1 font-normal"><FileText className="size-3 text-muted-foreground" />{driver.licenseNumber}</div><div className="text-xs text-muted-foreground">{driver.licenseClass}</div></div></TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <Truck className="size-3.5 text-muted-foreground shrink-0" />
                            <span className={driver.assignedTruckPlate || driver.assignedTruck ? 'text-foreground' : 'text-muted-foreground font-normal'}>
                              {driver.assignedTruckPlate || driver.assignedTruck || 'Unassigned'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell><div className="flex items-center gap-1.5"><Star className="size-3.5 text-warning fill-warning" /><span className="font-semibold">{driver.rating}</span><span className={`text-xs font-normal ${getSafetyColor(driver.safetyScore)}`}>{driver.safetyScore}%</span></div></TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden md:table-cell"><div className="flex items-center gap-1"><Mail className="size-3" /><span className="truncate max-w-[160px]">{driver.email || '—'}</span></div><div className="flex items-center gap-1 mt-0.5"><Phone className="size-3" />{driver.phone}</div></TableCell>
                        <TableCell>{getStatusBadge(driver.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(val) => {
                      setPageSize(Number(val))
                      setCurrentPage(1)
                    }}
 >
                    <SelectTrigger className="h-8 w-[70px]">
                      <SelectValue placeholder={pageSize.toString()} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground ml-4">
                    Showing {totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
                    {Math.min(currentPage * pageSize, totalItems)} of {totalItems} entries
                  </p>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
 >
                      Previous
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                      .map((p, idx, arr) => {
                        const showEllipsis = idx > 0 && p - arr[idx - 1] > 1
                        return (
                          <div key={p} className="flex items-center">
                            {showEllipsis && <span className="px-2 text-xs text-muted-foreground">…</span>}
                            <Button
                              variant={currentPage === p ? 'default' : 'outline'}
                              size="icon-sm"
                             
                              onClick={() => setCurrentPage(p)}
                              aria-current={currentPage === p ? 'page' : undefined}
                            >
                              {p}
                            </Button>
                          </div>
                        )
                      })}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
 >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
