import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { Customer } from '#/lib/types'

/** How a customer trades, as the list bands it. See ACTIVITY_SQL on the server. */
export type CustomerActivity = 'frequent' | 'occasional' | 'dormant' | 'never'
export type CustomerSort = 'active' | 'recent' | 'spend' | 'balance' | 'name' | 'newest'

/**
 * A customer row with its order history joined on — see customerRepo.findAll.
 *
 * Extends the canonical Customer rather than restating its fields, so a row
 * from this list is still accepted anywhere a customer is expected (the order
 * dialog's picker, for one) instead of being a second, incompatible shape.
 */
export interface CustomerRow extends Customer {
  id: number
  orderCount: number
  ordersRecent: number
  ordersThisMonth: number
  lastOrderAt: string | null
  firstOrderAt: string | null
  lifetimeValue: number
  primaryDepotId: number | null
  primaryDepotName: string | null
  primaryDepotState: string | null
  activityBand: CustomerActivity
}

export interface CustomerSummary {
  total: number
  active: number
  inactive: number
  totalBalance: number
  lifetimeRevenue: number
  orderedThisMonth: number
  newThisMonth: number
  frequent: number
  dormant: number
  never: number
  optedOut: number
  withPhone: number
}

export interface CustomerListParams {
  search?: string
  searchType?: string
  status?: string
  depotId?: string | number
  activity?: CustomerActivity | ''
  hasBalance?: 'yes' | 'no' | ''
  optedOut?: 'yes' | 'no' | ''
  sort?: CustomerSort
  page?: number
  limit?: number
  refetchInterval?: number
}

export function useCustomerList(
  params?: CustomerListParams,
  options?: { enabled?: boolean }
) {
  const { refetchInterval, ...raw } = params || {}
  // An empty string is "no filter", but axios still serialises it and the
  // server's enum validation rejects `activity=` outright — a cleared filter
  // would 400 the whole list rather than widening it.
  const queryParams = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  )
  return useQuery({
    queryKey: ['customers', queryParams],
    queryFn: async () => {
      const res = await api.get('/customers', { params: queryParams })
      return res.data.data as {
        customers: CustomerRow[]
        pagination: { total: number; page: number; pages: number }
        summary: CustomerSummary
      }
    },
    refetchInterval: refetchInterval ?? false,
    ...options,
  })
}

export function useCustomerDetails(id: string) {
  return useQuery({
    queryKey: ['customers', id],
    queryFn: async () => {
      const res = await api.get(`/customers/${id}`)
      return res.data.data.customer
    },
    enabled: !!id,
  })
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Record<string, any>) => {
      const res = await api.post('/customers', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Customer created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await api.patch(`/customers/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Customer updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/customers/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success('Customer deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
