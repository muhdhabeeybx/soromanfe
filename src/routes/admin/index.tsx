import { useState, useEffect } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard } from '#/components/ui/stat-card'
import { StatusChip } from '#/components/ui/status-chip'
import { useAdminList, useDeleteAdmin } from '#/lib/hooks/useAdmin'
import { useDepots } from '#/lib/hooks/useDepots'
import { useToast } from '#/lib/hooks/useToast'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import {
  Users,
  Plus,
  Search,
  UserCheck,
  UserX,
  Mail,
  Phone,
  X,
  Edit,
  Trash2,
  MoreHorizontal,
  Globe,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import {
  ROLE_LABELS,
  ROLE_GROUPS,
  roleColorMap,
  type StaffMember,
} from './-roles'

export {
  ROLES,
  ROLE_LABELS,
  roleColorMap,
  statesList,
  type StaffMember,
} from './-roles'
export { Roles, ALL_ROLES, ROLE_GROUPS, LOCATION_CHOICES, type LocationChoice, type PfiOption, pfisList, getCurrentUserRoles } from './-roles'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/admin/')({
  beforeLoad: () => routeGuard('/admin'),
  component: StaffManagement,
})

function getStatusBadge(suspended: boolean) {
  if (suspended) {
    return (
      <Badge variant="destructive" className="flex items-center gap-1 w-fit font-normal">
        <AlertCircle className="size-3" />
        Suspended
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="bg-accent/10 text-accent border-accent/20 flex items-center gap-1 w-fit font-normal">
      <CheckCircle2 className="size-3" />
      Active
    </Badge>
  )
}

function getInitials(full_name: string) {
  const parts = full_name.trim().split(' ')
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

function userRoleList(user: StaffMember): number[] {
  return user.roles && user.roles.length > 0 ? user.roles : [user.role]
}

function StaffManagement() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: admins = [], isLoading, isError, error, refetch } = useAdminList()
  const { data: depots = [] } = useDepots()
  const deleteAdmin = useDeleteAdmin()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(1000)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedLocation, roleFilter])

  const filteredStaff = admins
    .filter((staff) => {
      const matchesSearch =
        (staff.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (staff.email || '').toLowerCase().includes(searchTerm.toLowerCase())
      const matchesLocation =
        selectedLocation === 'all' || (staff.location_names || []).includes(selectedLocation)
      const matchesRole =
        roleFilter === 'all' ||
        (() => {
          const group = ROLE_GROUPS.find(g => g.label === roleFilter)
          if (group) {
            return group.roles.some(r => userRoleList(staff).includes(r))
          }
          return userRoleList(staff).includes(Number(roleFilter))
        })()
      return matchesSearch && matchesLocation && matchesRole
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const totalItems = filteredStaff.length
  const totalPages = Math.ceil(totalItems / pageSize)
  const paginatedStaff = filteredStaff.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const hasFilters = Boolean(searchTerm || selectedLocation !== 'all' || roleFilter !== 'all')

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteAdmin.mutateAsync(deleteTarget)
      setDeleteTarget(null)
    } catch {
      toast.error('Failed to delete user. Please try again.')
    }
  }

  const stats = {
    total: admins.length,
    active: admins.filter((s) => !s.suspended).length,
    suspended: admins.filter((s) => s.suspended).length,
    newThisMonth: admins.filter((s) => {
      const created = new Date(s.date_joined)
      const now = new Date()
      return (
        created.getMonth() === now.getMonth() &&
        created.getFullYear() === now.getFullYear()
      )
    }).length,
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section */}
      <PageHeader
      eyebrow="Admin"
      title="Staff Management"
      description="Create, edit, and manage staff access across the dashboard."
      actions={
        <>
          <Button
          size="sm"
          onClick={() => navigate({ to: '/admin/form' })}
          >
          <Plus className="size-4 mr-2" />
          Add Staff
          </Button>
        </>
      }
    />

      {/* Metrics Grid */}
      {!isLoading && !isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<Users />} label="Total staff" value={stats.total} />

          <StatCard
            icon={<UserCheck />}
            label="Active"
            value={stats.active}
            action={
              <StatusChip tone="accent">
                {Math.round((stats.active / (stats.total || 1)) * 100)}%
              </StatusChip>
            }
          />

          <StatCard
            tone="red"
            icon={<UserX />}
            label="Suspended"
            value={stats.suspended}
          />

          <StatCard
            tone="amber"
            icon={<Plus />}
            label="New this month"
            value={stats.newThisMonth}
          />
        </div>
      )}

      {/* Main Table Card */}
      <FilterBar>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
        <Input
        type="text"
        placeholder="Search users..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="pl-9 pr-8 text-xs h-9"
        />
        {searchTerm && (
        <button
        onClick={() => setSearchTerm('')}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center transition-colors duration-250 ease-luxe"
        aria-label="Clear search"
        >
        <X className="size-2.5" />
        </button>
        )}
        </div>
        <div className="flex items-center gap-2">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
        <SelectTrigger className="w-full sm:w-[150px] text-xs h-9" aria-label="Filter by role">
        <SelectValue placeholder="All Roles" />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="all">All Roles</SelectItem>
        {ROLE_GROUPS.map((group) => (
        <SelectItem key={group.label} value={group.label}>{group.label}</SelectItem>
        ))}
        </SelectContent>
        </Select>
        <Select value={selectedLocation} onValueChange={setSelectedLocation}>
        <SelectTrigger className="w-full sm:w-[150px] text-xs h-9" aria-label="Filter by location">
        <SelectValue placeholder="All Locations" />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="all">All Locations</SelectItem>
        {depots.map((d) => (
        <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
        ))}
        </SelectContent>
        </Select>
        </div>
        </div>
      </FilterBar>

      <Card className="border border-border/60">
        

        <CardContent className="p-0">
          {isLoading ? (
            <PageLoader message="Loading staff directory..." />
          ) : isError ? (
            <PageError message={(error as any)?.message || 'Failed to load staff'} onRetry={() => refetch()} />
          ) : filteredStaff.length === 0 ? (
            <PageEmpty
              icon={<Users className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'No staff match your filters' : 'No staff yet'}
              description={hasFilters ? 'Try adjusting your search or filter criteria.' : 'Get started by adding your first staff member.'}
              actionLabel={hasFilters ? undefined : 'Add Staff'}
              onAction={hasFilters ? undefined : () => navigate({ to: '/admin/form' })}
              hasFilters={hasFilters}
              onClearFilters={() => { setSearchTerm(''); setSelectedLocation('all'); setRoleFilter('all') }}
 />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-12 text-center text-xs">#</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="hidden md:table-cell text-xs">Contact</TableHead>
                      <TableHead className="hidden lg:table-cell text-xs">Location</TableHead>
                      <TableHead className="text-xs">Role</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-right w-10 text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedStaff.map((staff, idx) => {
                      const userRoles = userRoleList(staff)
                      return (
                        <TableRow
                          key={staff.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors duration-250 ease-luxe"
                          onClick={() => navigate({ to: '/admin/details' as any, state: { staff } as any })}
 >
                          <TableCell className="text-muted-foreground text-center text-xs font-mono">
                            {((currentPage - 1) * pageSize) + idx + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="size-9 rounded-full bg-primary/10 text-primary font-normal flex items-center justify-center text-xs shrink-0 ring-2 ring-primary/5">
                                {getInitials(staff.full_name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-normal text-foreground truncate">{staff.full_name}</p>
                                <p className="text-xs text-muted-foreground truncate">{staff.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <a
                              href={`mailto:${staff.email}`}
                              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors duration-250 ease-luxe"
                              onClick={(e) => e.stopPropagation()}
 >
                              <Mail className="size-3 shrink-0" />
                              <span className="truncate max-w-[160px]">{staff.email}</span>
                            </a>
                            {staff.phone_number && (
                              <a
                                href={`tel:${staff.phone_number}`}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-0.5 duration-250 ease-luxe"
                                onClick={(e) => e.stopPropagation()}
 >
                                <Phone className="size-3 shrink-0" />
                                {staff.phone_number}
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-foreground">
                            {staff.can_view_all_locations
                              ? <span className="text-muted-foreground inline-flex items-center gap-1 text-xs"><Globe className="size-3" /> Full Access</span>
                              : staff.location_names?.length
                                ? staff.location_names.join(', ')
                                : <span className="text-muted-foreground text-xs">No locations assigned</span>
                            }
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {userRoles.slice(0, 2).map((r) => {
                                const customStyle = roleColorMap?.[r]
                                return (
                                  <Badge
                                    key={r}
                                    variant="outline"
                                    className={`text-xs px-2 py-0.5 font-normal ${customStyle || ''}`}
 >
                                    {ROLE_LABELS[r]}
                                  </Badge>
                                )
                              })}
                              {userRoles.length > 2 && (
                                <Badge variant="secondary" className="text-xs px-1.5 py-0.5 font-normal">
                                  +{userRoles.length - 2}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(staff.suspended)}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-foreground"
                                  onClick={(e) => e.stopPropagation()}
 >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation()
                                  navigate({ to: '/admin/form', state: { staff, isEdit: true } as any })
                                }}>
                                  <Edit className="mr-2 size-3.5 text-muted-foreground" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget(String(staff.id))
                                }}>
                                  <Trash2 className="mr-2 size-3.5" />
                                  Remove
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1) }}
 />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Staff Member"
        description="Are you sure you want to delete this user? This action cannot be undone."
        variant="destructive"
        onConfirm={confirmDelete}
        loading={deleteAdmin.isPending}
 />
    </div>
  )
}