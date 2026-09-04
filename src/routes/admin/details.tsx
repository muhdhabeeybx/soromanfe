import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  User, Mail, Shield, Edit, Trash2, ArrowLeft, Phone, MapPin, Calendar,
  AlertCircle, Clock, Globe, ShieldCheck, ShieldOff, CheckCircle2, XCircle, Monitor,
  Loader2,
} from 'lucide-react'
import type { StaffMember } from './-roles'
import { ROLE_LABELS, ROLES, statesList } from './-roles'
import { useAdminDetails, useDeleteAdmin } from '#/lib/hooks/useAdmin'
import { useToast } from '#/lib/hooks/useToast'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink, EmailLink } from '#/components/ContactLink'

export const Route = createFileRoute('/admin/details')({
  beforeLoad: () => routeGuard('/admin'),
  component: UserDetailPage,
})

function formatDate(iso: string | null, withTime = false) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) })
}

function getInitials(full_name: string) {
  const parts = full_name.trim().split(' ')
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

function UserDetailPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const deleteAdmin = useDeleteAdmin()
  const toast = useToast()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const staffState = (router.history.location.state as any)?.staff as StaffMember | undefined
  const staffId = staffState?.id || (router.history.location.state as any)?.id

  const { data: staffDetails, isLoading } = useAdminDetails(staffId || '')

  const staff = staffDetails || staffState

  const handleBack = () => { window.history.length > 1 ? window.history.back() : navigate({ to: '/admin/' as any }) }
  const handleDelete = () => { setShowDeleteDialog(true) }
  const confirmDelete = async () => {
    if (!staff?.id) return
    try {
      await deleteAdmin.mutateAsync(String(staff.id))
      navigate({ to: '/admin/' as any })
    } catch {
      toast.error('Failed to delete user. Please try again.')
    } finally {
      setShowDeleteDialog(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">No User Selected</h2>
        <p className="text-muted-foreground max-w-sm">Please select a user from the directory to view their details.</p>
        <Button onClick={() => navigate({ to: '/admin/' as any })}><ArrowLeft className="size-4" /> Back to Directory</Button>
      </div>
    )
  }

  const userRoles = staff.roles && staff.roles.length > 0 ? staff.roles : [staff.role]
  const isSuperAdminUser = userRoles.includes(ROLES.SUPERADMIN)
  const scopeNames: string[] = staff.location_names?.length ? staff.location_names : (staff.locations ?? []).map((id) => statesList.find((s) => s.id === id)?.name).filter(Boolean) as string[]

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'Staff', href: '/admin' }, { label: staff?.full_name || 'Details' }]} />
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Admin"
      title="User Details"
      description="View and manage user account information"
      backAction={handleBack}
    />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/admin/form', state: { staff, isEdit: true } as any })}><Edit className="size-4" /> Edit</Button>
          <Button variant="destructive" onClick={handleDelete}><Trash2 className="size-4" /> Delete</Button>
        </div>
      </header>

      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="relative">
              <div className="size-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-2xl font-semibold">
                {getInitials(staff.full_name)}
              </div>
              {staff.suspended
                ? <ShieldOff className="size-4 absolute -bottom-1.5 -right-1.5 text-destructive bg-background rounded-full p-0.5 shadow" />
                : <ShieldCheck className="size-4 absolute -bottom-1.5 -right-1.5 text-success bg-background rounded-full p-0.5 shadow" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">ID #{staff.id}</Badge>
                {staff.suspended ? <Badge variant="destructive">Suspended</Badge> : <Badge className="bg-success text-success-foreground">Active</Badge>}
                {staff.is_superuser && <Badge className="bg-warning text-warning-foreground">Superuser</Badge>}
              </div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground mt-2 tracking-tight">{staff.full_name}</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">{staff.email}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                {userRoles.map((r) => <Badge key={r} variant="outline" className="text-xs">{ROLE_LABELS[r]}</Badge>)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><User className="size-4" /></div>
              <div><CardTitle className="text-sm">Account Info</CardTitle><p className="text-xs text-muted-foreground">Profile & identity</p></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Full Name</p><p className="text-sm font-normal text-foreground mt-0.5">{staff.full_name}</p></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Username</p><p className="text-sm text-foreground mt-0.5 font-mono">{staff.username || <span className="text-muted-foreground font-sans">Not set</span>}</p></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Date Joined</p><p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5"><Calendar className="size-3.5 text-muted-foreground" />{formatDate(staff.date_joined)}</p></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Email Verified</p><p className={`text-sm mt-0.5 flex items-center gap-1.5 font-semibold ${staff.email_verified ? 'text-success' : 'text-warning'}`}>{staff.email_verified ? <><CheckCircle2 className="size-3.5" />Verified</> : <><XCircle className="size-3.5" />Not Verified</>}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success"><Mail className="size-4" /></div>
              <div><CardTitle className="text-sm">Contact</CardTitle><p className="text-xs text-muted-foreground">Email & phone</p></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Email</p><span className="text-sm mt-0.5 flex items-center gap-1.5"><Mail className="size-3.5 text-muted-foreground shrink-0" /><EmailLink value={staff.email} /></span></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Phone Number</p><span className="text-sm mt-0.5 flex items-center gap-1.5"><Phone className="size-3.5 text-muted-foreground shrink-0" /><PhoneLink value={staff.phone_number} fallback="Not provided" /></span></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Location Scope</p><p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5"><MapPin className="size-3.5 text-muted-foreground" />{isSuperAdminUser || staff.can_view_all_locations ? <span className="flex items-center gap-1"><Globe className="size-3" /> Full Access</span> : scopeNames.length === 0 ? <span className="text-muted-foreground">No locations assigned</span> : scopeNames.join(', ')}</p></div>
            {!isSuperAdminUser && !staff.can_view_all_locations && (
              <div><p className="text-xs text-muted-foreground font-normal uppercase">PFI Scope</p><p className="text-sm text-foreground mt-0.5">{staff.pfi_numbers?.length ? staff.pfi_numbers.join(', ') : <span className="text-muted-foreground">No PFIs assigned</span>}</p></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning"><Shield className="size-4" /></div>
              <div><CardTitle className="text-sm">Roles & Access</CardTitle><p className="text-xs text-muted-foreground">Assigned permissions</p></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Primary Role</p><Badge variant="outline" className="mt-1.5 bg-primary/10 text-primary font-semibold">{ROLE_LABELS[staff.role]}</Badge></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase mb-2">All Assigned Roles</p><div className="flex flex-wrap gap-1.5">{userRoles.map((r) => <Badge key={r} variant="outline" className="text-xs">{ROLE_LABELS[r]}</Badge>)}</div></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Account Status</p>
              <div className="flex flex-col gap-1.5 mt-1.5">
                <span className={`text-xs flex items-center gap-1.5 font-normal ${!staff.suspended ? 'text-success' : 'text-destructive'}`}>{!staff.suspended ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{staff.suspended ? 'Suspended' : 'Active'}</span>
                <span className={`text-xs flex items-center gap-1.5 font-normal ${staff.email_verified ? 'text-success' : 'text-warning'}`}>{staff.email_verified ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}Email {staff.email_verified ? 'Verified' : 'Not Verified'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info"><Clock className="size-4" /></div>
            <div><CardTitle className="text-sm">Login Activity</CardTitle><p className="text-xs text-muted-foreground">Last session details</p></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Last Login</p><p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5"><Clock className="size-3.5 text-muted-foreground" />{formatDate(staff.last_login, true)}</p></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">Last Login IP</p><p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5 font-mono"><Globe className="size-3.5 text-muted-foreground" />{staff.last_login_ip || '\u2014'}</p></div>
            <div><p className="text-xs text-muted-foreground font-normal uppercase">User Agent</p><p className="text-sm text-foreground mt-0.5 flex items-start gap-1.5 truncate"><Monitor className="size-3.5 text-muted-foreground mt-0.5 shrink-0" /><span className="truncate">{staff.last_login_user_agent || '\u2014'}</span></p></div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete User Account"
        description="Are you sure you want to delete this user account? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={deleteAdmin.isPending}
      />
    </div>
  )
}
