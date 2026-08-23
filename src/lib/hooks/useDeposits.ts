import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { Deposit } from '#/lib/types'

export type { Deposit }

export function useDepositList(params?: { customer?: string; pfiId?: string | number; page?: number; limit?: number; refetchInterval?: number }) {
  const { refetchInterval, ...queryParams } = params || {}
  return useQuery({
    queryKey: ['deposits', queryParams],
    queryFn: async () => {
      const res = await api.get('/deposits', { params: queryParams })
      return res.data.data as { deposits: Deposit[]; pagination: { total: number; page: number; pages: number } }
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useCreateDeposit() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: {
      customer: string | number
      amount?: number
      description?: string
      reference?: string
      bankAccountId?: string | number
      bankName?: string
      accountName?: string
      accountNumber?: string
      depositorName?: string
      paymentDate?: string
      paystackDetails?: Record<string, any>
      /** Claim these unmatched bank-statement lines and sum them server-side, instead of a typed amount. */
      lineIds?: number[]
      /** Ties this deposit to a specific order — see the Pending Orders confirm-payment flow. */
      orderId?: string | number
    }) => {
      const res = await api.post('/deposits', {
        ...data,
        type: 'credit',
      })
      return res.data
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success(res?.message || 'Deposit recorded successfully!')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useTransferBalance() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: {
      fromCustomer: string | number
      toCustomer: string | number
      amount: number
      description?: string
    }) => {
      const res = await api.post('/deposits/transfer', data)
      return res.data
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success(res?.message || 'Balance transferred')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/** Undoes a credit deposit — e.g. one recorded against the wrong customer. */
export function useReverseDeposit() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, description }: { id: string | number; description?: string }) => {
      const res = await api.post(`/deposits/${id}/reverse`, { description })
      return res.data
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success(res?.message || 'Deposit reversed')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Undo a statement match: detach the deposit from whatever order it was
 * attributed to, take the money back out of the wallet, and return its
 * statement line to the unmatched pool.
 *
 * Refused (409) while that money is what funds a live order — removing it
 * would take the balance below what the order's hold has committed. The
 * server's message points at Re-match for that case, which swaps in a
 * replacement rather than leaving the order unfunded.
 */
export function useUnmatchDeposit() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, description }: { id: string | number; description?: string }) =>
      (await api.post(`/deposits/${id}/unmatch`, { description })).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['finance-report'] })
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] })
      toast.success(res?.message || 'Unmatched')
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}
