import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { BankAccount } from '#/lib/types'

export type { BankAccount }

export function useBankAccounts(params?: {
  search?: string
  status?: string
  depotId?: string | number
  lpgStationId?: string | number
  /**
   * Narrows to accounts tagged for one area — see BANK_ACCOUNT_USAGE in
   * lib/bank-accounts. Omitting it returns every account, which is what the
   * pickers outside truck sales and expenses still want. Typed loosely here
   * rather than importing the union, so this module stays a leaf.
   */
  usage?: string
}) {
  return useQuery({
    queryKey: ['bank-accounts', params],
    queryFn: async () => {
      const res = await api.get('/bank-accounts', { params })
      return (res.data?.data?.bankAccounts || []) as BankAccount[]
    },
  })
}

export function useBankAccountDetails(id: string | number) {
  return useQuery({
    queryKey: ['bank-accounts', id],
    queryFn: async () => {
      const res = await api.get(`/bank-accounts/${id}`)
      return res.data?.data?.bankAccount as BankAccount
    },
    enabled: !!id,
  })
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<BankAccount>) => {
      const res = await api.post('/bank-accounts', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['lpg-stations'] })
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Bank account created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateBankAccount() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string | number; data: Partial<BankAccount> }) => {
      const res = await api.patch(`/bank-accounts/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['lpg-stations'] })
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Bank account updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteBankAccount() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string | number) => {
      const res = await api.delete(`/bank-accounts/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['lpg-stations'] })
      queryClient.invalidateQueries({ queryKey: ['depots'] })
      toast.success('Bank account deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
