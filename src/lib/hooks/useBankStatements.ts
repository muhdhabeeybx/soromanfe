import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { ColumnMapping, ParsedRow } from '#/lib/bank-statement-parser'

export type StatementLine = {
  id: number
  bank_account_id: number
  statement_id: number
  txn_date: string
  amount: string
  depositor: string
  bank_ref: string
  narration: string
  status: 'UNMATCHED' | 'MATCHED'
}

export type BankStatement = {
  id: number
  bank_account_id: number
  filename: string
  row_count: number
  duplicate_count: number
  period_start: string | null
  period_end: string | null
  matched_count: number
  bank_name: string
  account_name: string
  account_number: string
  created_at: string
}

/** The saved format for one account, or null when it has never been set up. */
export function useStatementMapping(bankAccountId?: number | string) {
  return useQuery({
    queryKey: ['bank-statements', 'mapping', bankAccountId],
    queryFn: async () => {
      const res = await api.get(`/bank-statements/mapping/${bankAccountId}`)
      return res.data.data.mapping as Record<string, any> | null
    },
    enabled: Boolean(bankAccountId),
  })
}

export function useSaveStatementMapping() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({
      bankAccountId,
      mapping,
      sampleHeaders,
    }: {
      bankAccountId: number | string
      mapping: ColumnMapping
      sampleHeaders: string[]
    }) => {
      const res = await api.put(`/bank-statements/mapping/${bankAccountId}`, {
        ...mapping,
        sampleHeaders,
      })
      return res.data
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
      toast.success(res?.message || 'Statement format saved')
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

export function useBankStatements(bankAccountId?: number | string) {
  return useQuery({
    queryKey: ['bank-statements', 'list', bankAccountId ?? 'all'],
    queryFn: async () => {
      const res = await api.get('/bank-statements', {
        params: bankAccountId ? { bankAccountId } : undefined,
      })
      return res.data.data.statements as BankStatement[]
    },
  })
}

/** One row of an uploaded statement, and what became of it. */
export interface StatementLineDetail {
  id: number
  txn_date: string
  amount: string | number
  depositor: string
  narration: string
  bank_ref: string
  status: string
  matched_deposit_id: number | null
  matched_order_id: number | null
  matched_at: string | null
  deposit_reference: string | null
  order_id: number | null
  /** "ME11485" — built the way every other screen builds it. */
  order_reference: string | null
  customer_name: string | null
  matched_by_name: string | null
}

/**
 * The rows of one upload, with the order each was matched to and by whom.
 *
 * The upload list could say how many rows matched but never which, so a row
 * that seemed to have gone missing could not be traced from the screen at all.
 */
export function useStatementLines(
  statementId: number | null,
  params: { page?: number; limit?: number; status?: string } = {},
) {
  return useQuery({
    enabled: statementId != null,
    queryKey: ['bank-statements', 'lines', statementId, params],
    queryFn: async () => {
      const res = await api.get(`/bank-statements/${statementId}/lines`, { params })
      return res.data.data as {
        lines: StatementLineDetail[]
        pagination: { page: number; limit: number; total: number; pages: number }
        totals: { total: number; matched: number; unmatched: number }
      }
    },
    placeholderData: (prev) => prev,
  })
}

export function useUploadStatement() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (payload: {
      bankAccountId: number | string
      filename: string
      rows: ParsedRow[]
    }) => {
      const res = await api.post('/bank-statements', payload)
      return res.data
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
      // The server reports both counts; surface them verbatim.
      toast.success(res?.message || 'Statement uploaded')
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

export function useDeleteStatement() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (id: number) => (await api.delete(`/bank-statements/${id}`)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
      toast.success(res?.message || 'Statement deleted')
    },
    // A 409 here means lines are already matched — that is expected, not a fault.
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

/** The unmatched pool for one account. Amount search ignores commas. */
export function useUnmatchedLines(bankAccountId?: number | string, q?: string) {
  return useQuery({
    queryKey: ['bank-statements', 'lines', bankAccountId, q],
    queryFn: async () => {
      const res = await api.get('/bank-statements/lines', {
        params: { bankAccountId, q: q || undefined },
      })
      return res.data.data.lines as StatementLine[]
    },
    enabled: Boolean(bankAccountId),
  })
}

export function useMatchStatementLines() {
  const qc = useQueryClient()
  return useMutation({
    retry: false,
    mutationFn: async (payload: {
      lineIds: number[]
      depositId?: number
      orderId?: number
    }) => (await api.post('/bank-statements/match', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-statements'] })
    },
  })
}
