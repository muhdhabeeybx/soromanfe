import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { DeliverySale } from '#/lib/types'

export function useDeliverySalesList(params?: {
  search?: string
  page?: number
  limit?: number
  customer?: string
  truck_number?: string
  date_from?: string
  date_to?: string
  refetchInterval?: number
}) {
  const { refetchInterval, ...queryParams } = params || {}
  return useQuery({
    queryKey: ['delivery-sales', queryParams],
    queryFn: async () => {
      const res = await api.get('/delivery-sales', { params: queryParams })
      return (res.data.data?.sales || res.data.data || []) as DeliverySale[]
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useDeliverySaleDetails(id: string) {
  return useQuery({
    queryKey: ['delivery-sales', id],
    queryFn: async () => {
      const res = await api.get(`/delivery-sales/${id}`)
      return res.data.data?.sale || res.data.data as DeliverySale
    },
    enabled: !!id,
  })
}

/** One end of a transfer — a truck-cycle, not a single payment row. */
export interface TransferCycle {
  truckNumber: string
  dateLoaded?: string
  depotLoaded?: string
  customerId?: number | null
  customerName?: string
  location?: string
  allocationCode?: string
}

/**
 * Move a truck's overpayment onto other trucks.
 *
 * One call rather than a debit and a credit issued separately: the server
 * writes both legs in a transaction, because a credit that lands without its
 * matching debit is money created out of nothing. It also recomputes the
 * available surplus from the table, so an amount this client got wrong is
 * refused rather than recorded.
 */
export function useTransferOverpayment() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (body: {
      from: TransferCycle
      to: Array<TransferCycle & { amount: number }>
    }) => {
      const res = await api.post('/delivery-sales/transfer', body)
      return res.data as {
        data: { transferGroupId: string; moved: number; remaining: number }
        message: string
      }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success(res.message)
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useCreateDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<DeliverySale>) => {
      const res = await api.post('/delivery-sales', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record saved successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Partial<DeliverySale> }) => {
      const res = await api.patch(`/delivery-sales/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Confirm or un-confirm a hand-recorded deposit.
 *
 * Its own endpoint because the general update route deliberately refuses
 * depositStatus — it strips the field rather than erroring, which is why the
 * old toggle reported success while the status never moved.
 *
 * No toast of its own: the callers already report, and a toggle that fires
 * two notifications for one click reads as two things having happened.
 */
export function useSetDepositStatus() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({
      id,
      depositStatus,
    }: {
      id: string
      depositStatus: 'pending' | 'paid' | 'partial'
    }) => {
      const res = await api.patch(`/delivery-sales/${id}/deposit-status`, { depositStatus })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/delivery-sales/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
