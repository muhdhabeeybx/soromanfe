import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { Depot, DepotItem } from '#/lib/types'

export type { Depot, DepotItem }

export function useDepots(params?: { search?: string, page?: number, limit?: number }) {
  return useQuery({
    queryKey: ['depots', params],
    queryFn: async () => {
      const res = await api.get('/depots', { params })
      return (res.data.data.depots || []) as DepotItem[]
    },
  })
}

export function useDepotDetails(id: string) {
  return useQuery({
    queryKey: ['depots', id],
    queryFn: async () => {
      const res = await api.get(`/depots/${id}`)
      return res.data.data.depot as Depot
    },
    enabled: !!id,
  })
}

export function useCreateDepot() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Record<string, any>) => {
      const res = await api.post('/depots', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Depot created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDepot() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await api.patch(`/depots/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Depot updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteDepot() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/depots/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Depot deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateProductPrice() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ depotId, productId, price }: { depotId: string; productId: string; price: number }) => {
      const res = await api.patch(`/depots/${depotId}/product-price`, { productId, price })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Product price updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDepotProductPrices() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ depotId, productPrices }: { depotId: string; productPrices: Array<{ product: string | number; currentPrice: number }> }) => {
      const res = await api.patch(`/depots/${depotId}`, { productPrices })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Product prices saved successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Take every product off sale at every depot — all prices to 0.
 *
 * One request, not a loop over depots: thirteen separate calls can
 * half-succeed, and half the depots closed is a worse state than either end of
 * the operation. Every row keeps its previous price in the depot price
 * history, so this is undoable by hand.
 */
export function useZeroAllDepotPrices() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async () => {
      const res = await api.post('/depots/product-prices/zero-all')
      return res.data
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success(res?.message || 'All prices set to 0')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useToggleDepotStatus() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ depotId, status }: { depotId: string; status: string }) => {
      const res = await api.patch(`/depots/${depotId}`, { status })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Depot status updated')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

