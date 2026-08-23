import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { StaffMember } from '#/routes/admin/-roles'
import { useAuthStore } from '#/modules/auth'

const ROLE_MAP_REVERSE: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  finance: 2,
  truck_sales: 3,
  ticketing: 4,
  security_entry: 5,
  transport: 6,
  release: 7,
  audit: 8,
  sales_manager: 9,
  product_manager: 10,
  lpg_dashboard: 11,
  lpg_plants: 12,
  lpg_stock: 13,
  lpg_sales: 14,
  commissions: 15,
  commission_officer: 16,
  dispatch: 17,
  it_compliance: 18,
  security_exit: 19,

  // Tiered Subroles - Finance Department
  finance_viewer: 20,
  finance_operator: 21,
  finance_manager: 22,

  // Tiered Subroles - Transport Department
  transport_viewer: 23,
  transport_operator: 24,
  transport_manager: 25,

  // Tiered Subroles - Security Department
  security_viewer: 26,
  security_operator: 27,
  security_manager: 28,

  // Tiered Subroles - Ticketing Department
  ticketing_viewer: 29,
  ticketing_operator: 30,
  ticketing_manager: 31,

  // Tiered Subroles - Orders Department
  orders_viewer: 32,
  orders_operator: 33,
  orders_manager: 34,

  // Tiered Subroles - Sales Department
  sales_viewer: 35,
  sales_operator: 36,
  sales_manager_tier: 37,

  // Tiered Subroles - Dangote Department
  dangote_viewer: 38,
  dangote_operator: 39,
  dangote_manager: 40,

  // Tiered Subroles - LPG Department
  lpg_viewer: 41,
  lpg_operator: 42,
  lpg_manager: 43,

  expenditure_officer: 44,
};

function mapAdminToStaffMember(admin: any): StaffMember {
  const numericRoles = (admin.roles || []).map((r: string) => ROLE_MAP_REVERSE[r]).filter((r: number | undefined) => r !== undefined);
  // Depots and LPG stations are both "location" scope from the user's point of
  // view; the StaffMember shape doesn't distinguish them, so they're merged.
  const depotIds: number[] = admin.depotIds || []
  const depotNames: string[] = admin.depotNames || []
  const lpgStationIds: number[] = admin.lpgStationIds || []
  const lpgStationNames: string[] = admin.lpgStationNames || []
  return {
    id: String(admin.id ?? admin._id),
    email: admin.email,
    full_name: `${admin.firstName || ''} ${admin.surname || ''} ${admin.otherNames || ''}`.trim().replace(/\s+/g, ' '),
    phone_number: admin.phoneNumber || null,
    username: admin.email,
    role: numericRoles.length > 0 ? numericRoles[0] : 1,
    roles: numericRoles,
    location: (depotNames[0] as any) || 'Headquarters',
    locations: [...depotIds, ...lpgStationIds],
    location_names: [...depotNames, ...lpgStationNames],
    pfis: admin.pfiIds || [],
    pfi_numbers: admin.pfiNumbers || [],
    can_view_all_locations: admin.canViewAllLocations ?? true,
    depot_ids: depotIds,
    lpg_station_ids: lpgStationIds,
    page_overrides: (admin.pageOverrides || []).map((o: any) => ({ route_path: o.routePath, allowed: o.allowed })),
    suspended: admin.suspended || false,
    email_verified: admin.isPasswordSet || false,
    plain_password: null,
    last_login: null,
    last_login_ip: null,
    date_joined: admin.createdAt || new Date().toISOString(),
    is_staff: true,
    is_superuser: numericRoles.includes(0),
  };
}

export function useAdminList(params?: { search?: string; limit?: number }) {
  return useQuery({
    queryKey: ['admins', params],
    queryFn: async () => {
      // The page slices client-side, so it needs the whole staff list, not
      // the server's default first 50 — otherwise a bigger page size just
      // pages through rows that were never fetched.
      const res = await api.get('/admin', { params: { limit: 1000, ...params } })
      return (res.data.data.admins || []).map(mapAdminToStaffMember) as StaffMember[]
    },
  })
}

export function useAdminDetails(id: string) {
  return useQuery({
    queryKey: ['admins', id],
    queryFn: async () => {
      const res = await api.get(`/admin/${id}`)
      return mapAdminToStaffMember(res.data.data.admin)
    },
    enabled: !!id,
  })
}

export function useCreateAdmin() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Record<string, any>) => {
      const res = await api.post('/admin', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] })
      toast.success('Admin created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateAdmin() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await api.patch(`/admin/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] })
      toast.success('Admin updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteAdmin() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/admin/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] })
      toast.success('Admin deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Your own profile — name, other names, phone, picture.
 *
 * Deliberately not the admin update endpoint: this one cannot touch email,
 * roles, suspension or scope, whoever calls it. The auth store is refreshed
 * in place so the sidebar and header show the new name without a reload.
 */
export function useUpdateMyProfile() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: {
      first_name?: string
      surname?: string
      other_names?: string
      phone_number?: string
      profile_picture_url?: string
      profile_picture_public_id?: string
    }) => (await api.patch('/admin/me', data)).data,
    onSuccess: (res) => {
      const updated = res?.data
      if (updated) {
        const current = useAuthStore.getState().user
        if (current) {
          useAuthStore.setState({
            user: {
              ...current,
              firstName: updated.firstName ?? current.firstName,
              surname: updated.surname ?? current.surname,
              profilePicture: updated.profilePicture ?? current.profilePicture,
            },
          })
        }
      }
      queryClient.invalidateQueries({ queryKey: ['admins'] })
      toast.success(res?.message || 'Profile updated')
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

/**
 * Change your own password. The server revokes every session on success, so
 * the caller is signed out and has to come back with the new one — hence the
 * redirect rather than a quiet toast.
 */
export function useChangeMyPassword() {
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: { current_password: string; new_password: string }) =>
      (await api.post('/admin/me/password', data)).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'Password changed — please sign in again')
      useAuthStore.getState().clearSession()
      setTimeout(() => { window.location.href = '/login' }, 1200)
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}
