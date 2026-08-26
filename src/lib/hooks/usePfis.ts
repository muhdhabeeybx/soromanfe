import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { Pfi } from '#/lib/types'

export type { Pfi }

/**
 * Every money figure the API computes for a batch.
 *
 * `null` is meaningful throughout and must be rendered as "—", never as ₦0:
 * a batch nobody has priced yet is not a batch worth nothing. Only
 * `totalExpenses` is always a number.
 */
export type PfiFinancials = {
  /** Documented quantity from the shipping papers — what you are charged for. */
  blQtyLitres: number | null
  /** The same BL figure in MT, alongside the litres one. */
  blQtyMt: number | null
  /** Measured quantity in the tank — what you can actually sell. */
  tankQtyLitres: number
  /** Tank − BL. Negative is a deficit. Null until BL is entered. */
  surplusDeficitLitres: number | null
  pricePerLitre: number | null
  /** BL × price. Never the tank quantity. */
  pfiValue: number | null
  totalExpenses: number
  /** PFI value + expenses. Gross — before the credit balance below. */
  totalCost: number | null
  /** A rebate, discount or claim credited back against the cargo. */
  creditBalance: number
  /** totalCost − creditBalance. What profit is actually computed against. */
  grandTotalCost: number | null
  /** grandTotalCost ÷ BL quantity — what the batch cost per litre purchased. Null until totalCost is known. */
  landingCostPerLitre: number | null
  /** The same cost over what actually measured into the tank. Higher than the BL figure when there was a discharge shortage. */
  landingCostPerLitreTank: number | null
  /** Expense lines still walking the approval chain — committed, not yet spent. */
  pendingExpenses: number
  pendingExpenseCount: number
  revenue: number
  profitLoss: number | null
  margin: number | null
  sold: number
  remaining: number
  movementQty: number
  allocationQty: number
  /** The deficit priced at what you paid for it — money for product that never landed. */
  deficitCost: number | null
  /** 0–1. How much of the batch has actually gone out. */
  sellThrough: number | null
  /** False while the batch is part-sold, when profit is not yet a real number. */
  profitIsMeaningful: boolean
  costOfSold: number | null
  marginOnSold: number | null
}

export type PfiWithFinancials = Pfi & {
  financials: PfiFinancials
  orderCount: number
  expenseCount: number
}

export type PfiExpense = {
  id: number
  pfi_id: number | null
  category_id: number
  category_name: string
  /** Joined from the account, never copied — the code and name cannot drift. */
  gl_code?: string | null
  gl_group?: GlGroupCode | null
  gl_subgroup?: string
  is_system_category?: boolean
  pfi_number?: string | null
  expense_date: string
  /** EXP-{year}-{id}. Generated, never edited. */
  reference_number?: string
  vendor: string
  /** Set only when `vendor` was picked (or saved) from the vendor list. */
  vendor_id?: number | null
  /** The vendor's TIN, as printed on their invoice. */
  tin_number?: string
  invoice_number?: string
  /** "Purpose" on the payment schedule. */
  description: string
  /** What the request asks for: invoice amount less any WHT withheld. */
  amount: string
  /**
   * What actually cleared. Null until the Expenditure Officer settles it, and
   * distinct from 0 — an approved request awaiting payment is not spend of ₦0.
   */
  amount_paid?: string | null
  payment_reference?: string
  /** When the payment actually cleared — editable, distinct from `paid_at`. */
  payment_date?: string | null
  payment_method?: string
  /** Required by the server when amount_paid differs from amount. */
  payment_notes?: string
  /** The invoice behind the payment. Null when there was none; never 0. */
  amount_ex_vat?: string | null
  vat_amount?: string | null
  invoice_amount?: string | null
  wht_deduction?: string
  /** The rate that produced the deduction, as a percentage. Null if typed by hand. */
  wht_rate?: string | null
  bank_paid_from: string
  receipt_reference?: string
  entered_by: string
  /** entered_by resolved to a NAME. The raw column holds a bare staff id on most historical rows. */
  entered_by_name?: string | null
  deleted_at: string | null

  // ── The approval chain ────────────────────────────────────────────────
  status: ExpenseStatus
  status_label: string
  status_step: number
  total_steps: number
  /** Computed server-side. The page renders these; it decides nothing itself. */
  available_actions: ExpenseAction[]
  action_blocked_reason: string

  payee_bank_name?: string
  /** The payee bank's sort code, for the transfer schedule. */
  bank_code?: string
  payee_account_number?: string
  payee_account_name?: string
  submitted_by_id?: number | null
  submitted_by_name?: string | null
  reviewed_by_name?: string | null
  review_note?: string
  attachment_count?: number
  paid_at?: string | null
  history?: Array<{
    action: string
    changes: {
      note?: string
      status?: [string, string]
      amount_requested?: string
      amount_paid?: string
      bank_paid_from?: string
      payment_reference?: string
      payment_date?: string
      payment_method?: string
      payment_notes?: string
    } | null
    created_at: string
    actor_name: string | null
  }>
  /** The conversation: reviewers' queries and the requester's answers. */
  comments?: ExpenseComment[]
}

export type ExpenseComment = {
  id: number
  body: string
  author_id: number | null
  author_name: string
  created_at: string
}

export type ExpenseStatus =
  | 'pending' | 'verified' | 'audit_approved' | 'admin_approved'
  | 'paid' | 'rejected' | 'changes_requested'

export type ExpenseAction =
  | 'verify' | 'audit_approve' | 'admin_approve' | 'mark_paid'
  | 'reject' | 'request_changes'

/** Label and tone per action, so the button and the badge it produces agree. */
export const ACTION_META: Record<
  ExpenseAction,
  { label: string; tone: string; needsNote?: boolean; capturesPayment?: boolean }
> = {
  verify: { label: 'Verify', tone: 'bg-info text-info-foreground' },
  audit_approve: { label: 'CFO approve', tone: 'bg-info text-info-foreground' },
  admin_approve: { label: 'Give final approval', tone: 'bg-accent text-accent-foreground' },
  // The one action that records facts of its own, so it opens a short form
  // rather than firing on the click.
  mark_paid: { label: 'Mark paid', tone: 'bg-success text-success-foreground', capturesPayment: true },
  reject: { label: 'Reject', tone: 'bg-destructive text-destructive-foreground', needsNote: true },
  request_changes: { label: 'Send back', tone: 'bg-warning text-warning-foreground', needsNote: true },
}

export const STATUS_TONE: Record<ExpenseStatus, string> = {
  pending: 'bg-muted text-foreground',
  verified: 'bg-info/15 text-info',
  audit_approved: 'bg-info/25 text-info',
  admin_approved: 'bg-accent/15 text-accent',
  paid: 'bg-success/15 text-success',
  rejected: 'bg-destructive/15 text-destructive',
  changes_requested: 'bg-warning/15 text-warning',
}

/**
 * Deletable up to "with CFO" — mirrors the server-side rule exactly. Past
 * that the chain has already spent effort approving it, so reject or send it
 * back instead of making the row vanish.
 */
/**
 * Deletable until the money leaves — the same line edit draws.
 *
 * This was pending / changes_requested / verified, which left the officer who
 * raised a request unable to withdraw their own mistake once anyone had
 * approved it. "Reject" is the reviewer's verb, not the raiser's.
 */
export const isExpenseDeletable = (e: { status: ExpenseStatus }): boolean =>
  e.status !== 'paid'

/**
 * Editable until it is paid — mirrors chain.canEditExpense on the server.
 *
 * Anyone on the request may correct it while it is still moving: the officer
 * who raised it and every reviewer in the chain. Once the money has left the
 * bank the figures are a record of what happened, not a proposal, so nobody
 * edits them — including a super admin.
 */
export const isExpenseEditable = (e: { status: ExpenseStatus }): boolean =>
  e.status !== 'paid'

/** The four groups an expense may be booked to, plus income, which it may not. */
export type GlGroupCode =
  | 'pfi_direct' | 'administrative' | 'depot' | 'sales_distribution' | 'income'

/** A GL account. `gl_code` is null only on the pre-chart per-PFI categories. */
export type ExpenseCategory = {
  id: number
  name: string
  gl_code: string | null
  gl_group: GlGroupCode | null
  gl_subgroup: string
  pfi_id: number | null
  is_system_category: boolean
  pfi_status?: string | null
  /** Live lines posted to this account. An account in use cannot be deleted. */
  expense_count?: number
}

/** The chart as the picker reads it: a group, its heading runs, its accounts. */
export type GlGroup = {
  code: GlGroupCode
  label: string
  hint: string
  /** True for pfi_direct alone: the form must also ask which cargo. */
  requiresPfi?: boolean
  /** True for income, which the expense form never offers. */
  isIncome?: boolean
  accounts: ExpenseCategory[]
  subgroups: Array<{ label: string; accounts: ExpenseCategory[] }>
}

export type PfiMovement = {
  id: number
  order_id: number | null
  order_number: string | null
  customer_name: string | null
  action: string
  qty_litres: number
  notes: string
  created_at: string
}

export function usePfiList(params?: { search?: string; status?: string; location?: string | number; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['pfis', params],
    queryFn: async () => {
      const res = await api.get('/pfis', { params })
      return res.data.data as { pfis: PfiWithFinancials[]; pagination: any }
    },
  })
}

export function usePfiDetails(id: string) {
  return useQuery({
    queryKey: ['pfis', id],
    queryFn: async () => {
      const res = await api.get(`/pfis/${id}`)
      return res.data.data.pfi as Pfi
    },
    enabled: !!id,
  })
}

/** The drawer needs the lines behind the totals, not just the totals. */
export function usePfiDetail(id: number | null) {
  return useQuery({
    queryKey: ['pfis', 'detail', id],
    queryFn: async () => {
      const res = await api.get(`/pfis/${id}`)
      return res.data.data as {
        pfi: PfiWithFinancials
        expenses: PfiExpense[]
        movements: PfiMovement[]
      }
    },
    enabled: id != null,
  })
}

export function useCreatePfi() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Record<string, any>) => {
      const res = await api.post('/pfis', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      toast.success('PFI created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdatePfi() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await api.patch(`/pfis/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      toast.success('PFI updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeletePfi() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/pfis/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      toast.success('PFI deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

// ─── Expenses ───────────────────────────────────────────────────────────────
// PFI and expense data cross-invalidate: booking a cost against a PFI category
// moves that PFI's totals, so a write to either must refresh both.

/** Every write here touches money on both pages. */
function useMoneyMutation<T>(fn: (v: T) => Promise<any>, fallback: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: fn,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      toast.success(res?.message || fallback)
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

export type ExpenseFilters = {
  search?: string
  category?: string
  /** A whole section of the chart at once — see GlGroupCode. */
  group?: string
  pfi?: string
  bank?: string
  /** Staff id of whoever raised the expense — see `submitters` on the response. */
  submitter?: string
  type?: 'pfi' | 'general' | ''
  status?: string
  month?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  /** Forces "just what I raised", even for an oversight role — the My
   * Requests page's whole reason for existing. */
  mine?: boolean
}

export function useExpenses(filters?: ExpenseFilters) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: async () => {
      // Matches the repository's cap exactly. Asking for more than the server
      // allows returns a short page rather than an error, so the two numbers
      // have to be kept in step.
      const res = await api.get('/expenses', { params: { ...filters, limit: 500 } })
      return res.data.data as {
        expenses: PfiExpense[]
        totals: {
          count: number; total: number; pfiTotal: number
          generalTotal: number; paidTotal: number; openTotal: number
        }
        /** Deliberately ignores the status filter, so the tabs keep their counts. */
        statusCounts: Record<string, number>
        banks: string[]
        /**
         * Everyone who has raised an expense in view, for the "added by"
         * filter. Built ignoring that filter, so picking someone does not
         * reduce the list to just them.
         */
        submitters: Array<{ id: number; name: string }>
        /** 'own' when the viewer is outside the oversight roles. */
        scope: 'own' | 'all'
        can_review: boolean
        pagination: { page: number; limit: number; total: number; totalPages: number }
      }
    },
  })
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expenses', 'categories'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const res = await api.get('/expenses/categories')
      return res.data.data as {
        categories: ExpenseCategory[]
        general: ExpenseCategory[]
        pfi: ExpenseCategory[]
        /** The chart, in code order. What both pickers read. */
        groups: GlGroup[]
        /** Pre-chart categories, still attached to historical rows. */
        unmapped: ExpenseCategory[]
        /** 0.075. Sent by the server so the rate lives in one place. */
        vat_rate: number
        /** The withholding rates the form offers, as percentages. */
        wht_rates: number[]
      }
    },
  })
}

/**
 * Editing the chart itself. Only an administrator or the CFO gets this far —
 * the server enforces it, and the page hides the door.
 */
type ChartPatch = {
  name: string
  gl_code?: string
  gl_group?: string
  gl_subgroup?: string
}

function useChartMutation<T>(
  fn: (v: T) => Promise<{ message?: string }>,
  fallback: string,
) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: fn,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] })
      toast.success(res?.message || fallback)
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export const useCreateGlAccount = () =>
  useChartMutation<ChartPatch>(
    async (data) => (await api.post('/expenses/categories', data)).data,
    'Account created',
  )

export const useUpdateGlAccount = () =>
  useChartMutation<{ id: number; data: Partial<ChartPatch> }>(
    async ({ id, data }) => (await api.patch(`/expenses/categories/${id}`, data)).data,
    'Account updated',
  )

export const useDeleteGlAccount = () =>
  useChartMutation<number>(
    async (id) => (await api.delete(`/expenses/categories/${id}`)).data,
    'Account deleted',
  )

/**
 * Everything attached to a request: invoices, teller slips, whatever was
 * handed over.
 */
export type ExpenseAttachment = {
  id: number
  expense_id: number
  storage_key: string
  file_name: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  uploaded_by_name?: string | null
}

export function useExpenseAttachments(id: number | null) {
  return useQuery({
    enabled: id != null,
    queryKey: ['expenses', 'attachments', id],
    queryFn: async () =>
      (await api.get(`/expenses/${id}/attachments`)).data.data.attachments as ExpenseAttachment[],
  })
}

/**
 * Register files already uploaded to Cloudinary against a request.
 *
 * The bytes never pass through the API — the browser uploads straight to
 * Cloudinary with a signed payload, and this records where they landed.
 */
export const useAttachFiles = () => {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({ id, files }: { id: number; files: Record<string, unknown>[] }) =>
      (await api.post(`/expenses/${id}/attachments`, { files })).data,
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', 'attachments', id] })
      queryClient.invalidateQueries({ queryKey: ['expenses', 'detail', id] })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export const useDeleteAttachment = () => {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({ attachmentId }: { attachmentId: number; expenseId: number }) =>
      (await api.delete(`/expenses/attachments/${attachmentId}`)).data,
    onSuccess: (_res, { expenseId }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', 'attachments', expenseId] })
      queryClient.invalidateQueries({ queryKey: ['expenses', 'detail', expenseId] })
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export const useSaveExpense = () =>
  useMoneyMutation<{ id?: number; data: Record<string, any> }>(
    async ({ id, data }) =>
      (id ? await api.patch(`/expenses/${id}`, data) : await api.post('/expenses', data)).data,
    'Expense saved',
  )

/** One expense with its attachments and full review history. */
export function useExpenseDetail(id: number | null) {
  return useQuery({
    enabled: id != null,
    queryKey: ['expenses', 'detail', id],
    queryFn: async () => (await api.get(`/expenses/${id}`)).data.data.expense as PfiExpense,
  })
}

/**
 * The only call that moves status.
 *
 * Invalidates the PFI queries too: approving changes a cargo's cost, so its
 * screens have to refresh alongside this one.
 */
/**
 * Move the request one stage.
 *
 * `payment` is supplied for `mark_paid` alone — the server refuses that
 * transition without a bank and an amount, because a settlement nobody can
 * trace is not a settlement.
 */
export const useReviewExpense = () =>
  useMoneyMutation<{
    id: number
    action: ExpenseAction
    note?: string
    payment?: {
      bank_paid_from: string
      amount_paid: number
      payment_reference?: string
      payment_date?: string
      payment_method?: string
      payment_notes?: string
    }
  }>(
    async ({ id, action, note, payment }) =>
      (await api.post(`/expenses/${id}/review`, {
        action, note: note || '', ...(payment || {}),
      })).data,
    'Expense updated',
  )

/** Anyone on the request may add to the conversation — including whoever raised it. */
export const useAddExpenseComment = () => {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({ id, body }: { id: number; body: string }) =>
      (await api.post(`/expenses/${id}/comments`, { body })).data,
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', 'detail', id] })
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export const useDeleteExpense = () =>
  useMoneyMutation<number>(async (id) => (await api.delete(`/expenses/${id}`)).data, 'Expense deleted')

/** Quick-add from inside the PFI drawer; the category is resolved server-side. */
export const useAddPfiExpense = () =>
  useMoneyMutation<{ pfiId: number; data: Record<string, any> }>(
    async ({ pfiId, data }) => (await api.post(`/pfis/${pfiId}/expenses`, data)).data,
    'Expense recorded',
  )

export const useSaveCategory = () =>
  useMoneyMutation<{ id?: number; name: string }>(
    async ({ id, name }) =>
      (id
        ? await api.patch(`/expenses/categories/${id}`, { name })
        : await api.post('/expenses/categories', { name })
      ).data,
    'Category saved',
  )

export const useDeleteCategory = () =>
  useMoneyMutation<number>(
    async (id) => (await api.delete(`/expenses/categories/${id}`)).data,
    'Category deleted',
  )

// ─── PFI actions ────────────────────────────────────────────────────────────

/**
 * Closing returns any gap between the figures typed at closure and the ones
 * the system computed, plus a warning when stock is still on the books.
 */
export const useFinishPfi = () =>
  useMoneyMutation<{ id: number; data: Record<string, any> }>(
    async ({ id, data }) => (await api.post(`/pfis/${id}/finish`, data)).data,
    'PFI closed',
  )

export const useAssignOrders = () =>
  useMoneyMutation<{ pfiId: number; orderIds: number[] }>(
    async ({ pfiId, orderIds }) =>
      (await api.post('/pfis/assign-orders', { pfi_id: pfiId, order_ids: orderIds })).data,
    'Orders assigned',
  )

export function useDepotsForFilter() {
  return useQuery({
    queryKey: ['depots', 'filter'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get('/depots')
      return (res.data.data.depots || []) as Array<{ _id: string; name: string }>
    },
  })
}
