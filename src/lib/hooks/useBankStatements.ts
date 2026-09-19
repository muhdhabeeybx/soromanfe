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
  /** Of those duplicates, the ones dropped on the reference alone. */
  repeated_reference_count: number
  period_start: string | null
  period_end: string | null
  matched_count: number
  total_amount: string
  matched_amount: string
  bank_name: string
  account_name: string
  account_number: string
  uploaded_by_name: string | null
  created_at: string
}

/** One bank account's whole statement history, rolled up. */
export type StatementAccountSummary = {
  bank_account_id: number
  bank_name: string
  account_name: string
  account_number: string
  currency: string
  status: string
  has_format: boolean
  statement_count: number
  duplicate_count: number
  repeated_reference_count: number
  first_uploaded_at: string | null
  last_uploaded_at: string | null
  line_count: number
  total_amount: string
  matched_count: number
  matched_amount: string
  unmatched_count: number
  unmatched_amount: string
  day_count: number
  first_txn_date: string | null
  last_txn_date: string | null
}

/** One day of one account's statement. */
export type StatementDay = {
  day: string
  line_count: number
  total_amount: string
  matched_count: number
  matched_amount: string
  unmatched_count: number
  unmatched_amount: string
  /** How many separate uploads this day's rows arrived in. */
  upload_count: number
  first_imported_at: string
  last_imported_at: string
}

export type StatementTotals = {
  total: number
  matched: number
  unmatched: number
  total_amount: string
  matched_amount: string
  unmatched_amount: string
}

/**
 * Every bank account and what has been uploaded against it.
 *
 * Accounts with nothing uploaded come back too — that is where a first upload
 * starts, and an account with no format saved is the one worth finding.
 */
export function useStatementAccounts() {
  return useQuery({
    queryKey: ['bank-statements', 'summary'],
    queryFn: async () => {
      const res = await api.get('/bank-statements/summary')
      return res.data.data.accounts as StatementAccountSummary[]
    },
  })
}

/** One account's statement, a day at a time — the unit it is read in. */
export function useStatementDays(
  bankAccountId?: number | string,
  range: { from?: string; to?: string } = {},
) {
  return useQuery({
    enabled: Boolean(bankAccountId),
    queryKey: ['bank-statements', 'days', bankAccountId, range],
    queryFn: async () => {
      const res = await api.get(`/bank-statements/accounts/${bankAccountId}/days`, {
        params: { from: range.from || undefined, to: range.to || undefined },
      })
      return res.data.data.days as StatementDay[]
    },
    placeholderData: (prev) => prev,
  })
}

/**
 * Lines across one account, each carrying where it came from and where it went.
 *
 * Unlike the per-file view this does not care which upload a row arrived in,
 * which is the point: a month re-uploaded in two halves reads as one month.
 */
export function useAccountStatementLines(
  bankAccountId: number | string | undefined,
  params: {
    from?: string; to?: string; day?: string
    status?: string; q?: string; page?: number; limit?: number
  } = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: Boolean(bankAccountId) && options.enabled !== false,
    queryKey: ['bank-statements', 'account-lines', bankAccountId, params],
    queryFn: async () => {
      const res = await api.get(`/bank-statements/accounts/${bankAccountId}/lines`, {
        params: {
          from: params.from || undefined,
          to: params.to || undefined,
          day: params.day || undefined,
          status: params.status || undefined,
          q: params.q || undefined,
          page: params.page ?? 1,
          limit: params.limit ?? 50,
        },
      })
      return res.data.data as {
        lines: AccountStatementLine[]
        pagination: { page: number; limit: number; total: number; pages: number }
        totals: StatementTotals
      }
    },
    placeholderData: (prev) => prev,
  })
}

/**
 * Reads every line in a range in one go, for the export.
 *
 * Not a hook: an export that quietly stopped at the first page would produce a
 * file that looks complete and is not, which is the one failure a bank
 * statement must never have.
 */
export async function fetchAllAccountLines(
  bankAccountId: number | string,
  params: { from?: string; to?: string; day?: string; status?: string; q?: string },
) {
  const PAGE = 5000
  const out: AccountStatementLine[] = []
  for (let page = 1; ; page++) {
    const res = await api.get(`/bank-statements/accounts/${bankAccountId}/lines`, {
      params: {
        from: params.from || undefined,
        to: params.to || undefined,
        day: params.day || undefined,
        status: params.status || undefined,
        q: params.q || undefined,
        page,
        limit: PAGE,
      },
    })
    const data = res.data.data as {
      lines: AccountStatementLine[]
      pagination: { pages: number }
    }
    out.push(...data.lines)
    if (page >= data.pagination.pages) break
  }
  return out
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
  /**
   * What claimed this credit when an order did not — a truck sale off the
   * sales ledger. Null on an ordinary order payment and on unmatched lines.
   */
  claimed_by: { kind: 'truck_sale'; id: number; label: string } | null
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

/** A line seen from the account, so it carries the file it arrived in. */
export interface AccountStatementLine extends StatementLineDetail {
  statement_id: number
  filename: string
  uploaded_at: string
  uploaded_by_name: string | null
  /** When the row itself landed in the table — the same instant, per row. */
  imported_at: string
}

/** A row as the server hands it back from a preflight. */
export interface PreviewRow {
  txnDate: string
  amount: number
  depositor: string
  bankRef: string
  narration: string
  /**
   * Why a skipped row was skipped. "on record" is an ordinary overlap with a
   * previous upload; "reference" means this file describes a credit the
   * account already holds under the same bank reference; the "in this file"
   * variants mean the file repeats itself.
   */
  reason?: string
}

export interface StatementPreview {
  rows: PreviewRow[]
  skipped: PreviewRow[]
  counts: {
    incoming: number
    importing: number
    duplicates: number
    repeatedReferences: number
  }
  total: number
}

/**
 * What the upload would do, asked before it is done.
 *
 * The server runs the same partition the import runs and returns it rather
 * than applying it, so the rows put in front of somebody to confirm are the
 * rows that will actually be stored. Doing this arithmetic on the client would
 * mean shipping every reference on the account to the browser AND keeping a
 * second copy of the dedup rule in step with the first — and a preview that
 * disagreed with the import would be worse than none, because it would be
 * believed.
 */
export function usePreviewStatement() {
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (payload: {
      bankAccountId: number | string
      filename: string
      rows: ParsedRow[]
    }) => {
      const res = await api.post('/bank-statements/preview', payload)
      return res.data.data as StatementPreview
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
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
