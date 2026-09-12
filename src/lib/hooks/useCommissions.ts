import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { Commission, CommissionRate, CommissionSummary } from '#/lib/types'

export function useCommissions(params?: {
  search?: string
  status?: string
  depotId?: number | string
  customerId?: number | string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}) {
  return useQuery({
    queryKey: ['commissions', params],
    queryFn: async () => {
      const res = await api.get('/commissions', { params })
      return res.data.data as {
        commissions: Commission[]
        pagination: { total: number; page: number; pages: number }
      }
    },
  })
}

export function useCommissionDetails(id: string) {
  return useQuery({
    queryKey: ['commissions', id],
    queryFn: async () => {
      const res = await api.get(`/commissions/${id}`)
      return res.data.data.commission as Commission
    },
    enabled: !!id,
  })
}

export function useCommissionSummary(params?: { depotId?: number | string; customerId?: number | string; dateFrom?: string; dateTo?: string }) {
  return useQuery({
    queryKey: ['commission-summary', params],
    queryFn: async () => {
      const res = await api.get('/commissions/summary', { params })
      return res.data.data.summary as CommissionSummary
    },
  })
}

export function useConfirmCommissionPayment() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (commissionId: number) => {
      const res = await api.patch(`/commissions/${commissionId}/confirm-payment`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] })
      queryClient.invalidateQueries({ queryKey: ['commission-summary'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      toast.success('Commission marked paid')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useCommissionRates(params?: { depotId?: number | string }) {
  return useQuery({
    queryKey: ['commission-rates', params],
    queryFn: async () => {
      const res = await api.get('/commissions/rates', { params })
      return (res.data.data.rates || []) as CommissionRate[]
    },
  })
}

export function useUpsertCommissionRate() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: { depotId: number | string; productId: number | string; commissionRate: number }) => {
      const res = await api.post('/commissions/rates', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rates'] })
      toast.success('Commission rate saved')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Settle a commission without paying it.
 *
 * The second exit. Some orders carry no commission — a flat-rate deal, a
 * correction, a facilitator paid another way — and before this those rows sat
 * pending forever, so "pending" meant both "still to pay" and "never going to
 * be" with no way to tell them apart.
 *
 * A reason is required by the server, because the row outlives everyone's
 * memory of the order and "why was this not paid" is the only question it will
 * ever be asked.
 */
export function useSkipCommission() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ commissionId, reason }: { commissionId: number; reason: string }) => {
      const res = await api.patch(`/commissions/${commissionId}/skip`, { reason })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] })
      queryClient.invalidateQueries({ queryKey: ['commission-summary'] })
      toast.success('Commission skipped — no payment is owed on this order')
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

/**
 * Confirm or skip a selection in one request.
 *
 * Partial success is a real outcome and is reported as one: the rows that went
 * through are named, and so is every row that did not, with the reason it
 * gave.
 */
export function useBulkResolveCommissions() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ ids, action, reason }: {
      ids: number[]
      action: 'confirm' | 'skip'
      reason?: string
    }) => {
      const res = await api.post('/commissions/bulk', { ids, action, reason })
      return res.data as {
        success: boolean
        message: string
        data: { done: number[]; failed: Array<{ id: number; message: string }> }
      }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] })
      queryClient.invalidateQueries({ queryKey: ['commission-summary'] })
      // The server's own message already counts both sides, so it is used
      // rather than reconstructed — and a partial result is a warning, not a
      // success, because half of what was asked for did not happen.
      if (res.data.failed.length) toast.error(res.message)
      else toast.success(res.message)
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
