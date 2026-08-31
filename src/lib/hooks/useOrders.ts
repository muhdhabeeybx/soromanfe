import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

export function useOrderList(params?: { page?: number; limit?: number; search?: string; status?: string; customer?: string; depot?: string | number; dateFrom?: string; dateTo?: string; refetchInterval?: number }) {
  const { refetchInterval, ...queryParams } = params || {}
  return useQuery({
    queryKey: ['orders', queryParams],
    queryFn: async () => {
      const res = await api.get('/orders', { params: queryParams })
      return res.data.data
    },
    refetchInterval: refetchInterval ?? false,
  })
}

/** The backend clamps `limit` to 100 in every repository, so one request can
 *  never return more than a page. */
const PAGE_SIZE = 100
/** Safety ceiling: 50 pages = 5,000 orders. Beyond this the caller is told. */
const MAX_PAGES = 50
const CONCURRENCY = 6

/**
 * Fetches every order by walking the paginated endpoint.
 *
 * The Orders page filters client-side and recalculates its summary cards
 * against the filtered set, which needs the whole book — a single request
 * would silently give it the 100 most recent rows and every total would be
 * wrong. Pages after the first are fetched a few at a time.
 *
 * This is the thing to move server-side first: at 2,200 orders it is 22
 * requests, and it grows linearly.
 */
export function useAllOrders(params?: Record<string, unknown> & { refetchInterval?: number }) {
  const { refetchInterval, ...queryParams } = params || {}
  return useQuery({
    queryKey: ['orders', 'all', queryParams],
    queryFn: async () => {
      const first = await api.get('/orders', {
        params: { ...queryParams, page: 1, limit: PAGE_SIZE },
      })
      const { orders = [], pagination } = first.data.data
      const totalPages: number = pagination?.pages ?? 1
      const pagesToFetch = Math.min(totalPages, MAX_PAGES)

      const all = [...orders]
      for (let start = 2; start <= pagesToFetch; start += CONCURRENCY) {
        const batch = []
        for (let p = start; p < start + CONCURRENCY && p <= pagesToFetch; p++) {
          batch.push(
            api.get('/orders', { params: { ...queryParams, page: p, limit: PAGE_SIZE } }),
          )
        }
        const results = await Promise.all(batch)
        for (const r of results) all.push(...(r.data.data.orders ?? []))
      }

      return {
        orders: all,
        pagination,
        /** True when MAX_PAGES cut the fetch short. */
        truncated: totalPages > pagesToFetch,
        totalAvailable: pagination?.total ?? all.length,
      }
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useOrderDetails(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: async () => {
      const res = await api.get(`/orders/${id}`)
      return res.data.data.order
    },
    enabled: !!id,
  })
}

export function useCreateOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Record<string, any>) => {
      const res = await api.post('/orders', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      toast.success('Order created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await api.patch(`/orders/${id}`, data)
      return res.data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Order updated successfully')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useReleaseOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data?: Record<string, any> }) => {
      const res = await api.post(`/orders/${id}/release`, data || {})
      return res.data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Order released successfully')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function usePayableOrders() {
  return useQuery({
    queryKey: ['orders', 'payable'],
    queryFn: async () => {
      const res = await api.get('/orders/payable')
      return res.data.data.orders || []
    },
  })
}

export function usePayOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    /**
     * `amount` is the naira actually received now. Omit it to settle the whole
     * outstanding balance — the server's own documented default, and what
     * every caller sent before orders could be paid in instalments, so a full
     * payment still puts exactly the same request on the wire as it always
     * did (no body at all).
     */
    mutationFn: async ({ orderId, amount }: { orderId: number | string; amount?: number }) => {
      const res = await api.post(
        `/orders/${orderId}/pay`,
        amount == null ? undefined : { amount },
      )
      return res.data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Order paid successfully')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      // A balance can now be settled from the finance report, so the row this
      // was launched from has to stop showing the amount just paid as owing.
      // ['orders'] already covers the payable desk's ['orders','payable'].
      queryClient.invalidateQueries({ queryKey: ['finance-report'] })
    },
    onError: (err: any) => {
      const status = err?.response?.status
      const msg = String(err?.response?.data?.message || err?.message || '')
      if (status === 409 && msg.toLowerCase().includes('expired')) {
        toast.error('This order has expired and can no longer be paid. Please place a new order.')
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        return
      }
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Erase an order and everything attached to it.
 *
 * Not a cancel — the row and its tickets, trucks, commissions, wallet holds
 * and stock movements are removed outright, paid orders included. Only the
 * audit entry survives. super_admin only, enforced server-side.
 */
export function useDeleteOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string | number) => (await api.delete(`/orders/${id}`)).data,
    onSuccess: (data) => {
      toast.success(data?.message || 'Order deleted')
      // Deleting an order changes PFI cost and stock, so those views are stale too.
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

export function useCancelOrder() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await api.post(`/orders/${id}/cancel`, { reason })
      return res.data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Order cancelled successfully')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
