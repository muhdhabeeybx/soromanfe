import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { fetchAllPages } from '#/lib/api/fetch-all-pages'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { DeliveryInventory } from '#/lib/types'

export function useDeliveryInventoryList(params?: {
  search?: string
  page?: number
  limit?: number
  truck_number?: string
  loading_status?: string
  refetchInterval?: number
}) {
  const { refetchInterval, ...queryParams } = params || {}
  // As in useDeliverySalesList: no page asked for means every row. There are
  // 257 allocations against a 500-row default page, so this has not bitten
  // yet — it would have, silently, the day the table crossed 500.
  const wantsEveryRow = params?.page === undefined && params?.limit === undefined
  return useQuery({
    queryKey: ['delivery-inventory', queryParams],
    queryFn: async () => {
      if (wantsEveryRow) {
        return fetchAllPages<DeliveryInventory>('/delivery-inventory', queryParams, (b) => b?.loadings || b?.inventory || b || [])
      }
      const res = await api.get('/delivery-inventory', { params: queryParams })
      return (res.data.data?.loadings || res.data.data?.inventory || res.data.data || []) as DeliveryInventory[]
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useDeliveryInventoryDetails(id: string) {
  return useQuery({
    queryKey: ['delivery-inventory', id],
    queryFn: async () => {
      const res = await api.get(`/delivery-inventory/${id}`)
      return res.data.data?.loading || res.data.data as DeliveryInventory
    },
    enabled: !!id,
  })
}

export function useCreateDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<DeliveryInventory>) => {
      const res = await api.post('/delivery-inventory', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record created')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Partial<DeliveryInventory> }) => {
      const res = await api.patch(`/delivery-inventory/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record updated')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/delivery-inventory/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record deleted')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
