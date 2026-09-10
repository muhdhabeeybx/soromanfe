import { useMemo } from 'react'
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
  /** True when this batch was bought at the gantry rather than shipped in. */
  isGantry: boolean
  /**
   * Documented quantity from the shipping papers — what you are charged for.
   * Always null on gantry: there are no shipping papers.
   */
  blQtyLitres: number | null
  /** The same BL figure in MT, alongside the litres one. */
  blQtyMt: number | null
  /** Measured quantity in the tank — what you can actually sell. */
  tankQtyLitres: number
  /**
   * The quantity every money figure here was computed against: the BL figure
   * on coastal, the bought quantity on gantry.
   */
  costQtyLitres: number | null
  /** Tank − BL. Negative is a deficit. Null until BL is entered, and on gantry. */
  surplusDeficitLitres: number | null
  pricePerLitre: number | null
  /** BL × price. Never the tank quantity. */
  pfiValue: number | null
  totalExpenses: number
  /** PFI value + expenses. Gross — before the credit balance below. */
  totalCost: number | null
  /** A rebate, discount or claim credited back against the cargo. */
  creditBalance: number
  /**
   * totalCost − creditBalance.
   *
   * This is what every screen shows under the label "Total cost", what profit
   * is measured against, and what the landing cost divides. `totalCost` above
   * is the gross figure before the credit, shown only on batches that carry
   * one and labelled "Cost before credit" there.
   */
  grandTotalCost: number | null
  /**
   * Total Cost ÷ BL quantity — what one litre of the batch cost, all in.
   *
   * Divides `grandTotalCost`, which is the same figure displayed as "Total
   * cost" directly above it wherever both appear, so the division can be
   * checked by eye. Null until the batch is priced.
   */
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
  /** Quantity on orders against this batch whose payment has not cleared. */
  awaitingPayment: number
  awaitingPaymentOrders: number
  /** remaining − awaitingPayment: stock with no order against it at all. */
  trulyUnsold: number
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
  /**
   * What the request asks for: invoice amount less any WHT withheld,
   * denominated in `currency` — NOT necessarily naira.
   */
  amount: string

  // ── Currency ────────────────────────────────────────────────────────────
  //
  // The vessel accounts are billed abroad. The foreign figure is the debt;
  // naira is a translation of it, done twice — at the rate the request was
  // raised at, and again at the rate on the day it was paid.
  /** ISO 4217. 'NGN' on everything domestic. */
  currency?: string
  /**
   * Naira per unit of `currency`, at the time of raising. '1' on NGN.
   *
   * Null on a foreign invoice recorded without a rate — allowed, and then the
   * row has no naira value at all rather than a guessed one.
   */
  exchange_rate?: string | null
  /** The rate on the day it cleared. Null until paid, and null on NGN. */
  paid_exchange_rate?: string | null
  /**
   * The naira translations, generated by the database and never written by
   * hand. Every total sums these — see Sman-Backend/db/migrations/0026.
   */
  amount_ngn?: string
  amount_paid_ngn?: string | null
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
 * Deletable until the money leaves — and after that, by a super admin alone.
 * The same line edit draws.
 *
 * This was pending / changes_requested / verified, which left the officer who
 * raised a request unable to withdraw their own mistake once anyone had
 * approved it. "Reject" is the reviewer's verb, not the raiser's.
 *
 * Deleting a PAID expense takes its amount back off whatever it was booked to.
 * That is automatic rather than a second step: PFI totals are summed from live
 * expense rows at read time and the sum skips deleted ones, so the cargo's
 * total cost and its landing cost per litre both fall by the amount as soon as
 * the row goes.
 */
export const isExpenseDeletable = (
  e: { status: ExpenseStatus },
  opts?: { superAdmin?: boolean },
): boolean => e.status !== 'paid' || opts?.superAdmin === true

/**
 * Editable until it is paid — and after that, by a super admin alone.
 * Mirrors chain.canEditExpense on the server, which is the real gate.
 *
 * Anyone on the request may correct it while it is still moving: the officer
 * who raised it and every reviewer in the chain.
 *
 * Once the money has left the bank the figures are a record of what happened
 * rather than a proposal, so the door closes — for everyone except a super
 * admin. Records still need correcting (a wrong TIN, an invoice figure a digit
 * out, a cost booked to the wrong cargo), and the alternative to allowing it
 * is someone editing the database by hand, which leaves no trail at all. The
 * server diffs every change into the audit trail as `amended_after_payment`,
 * and leaves the settlement figures and the paid status untouched.
 */
export const isExpenseEditable = (
  e: { status: ExpenseStatus },
  opts?: { superAdmin?: boolean },
): boolean => e.status !== 'paid' || opts?.superAdmin === true

/** Is this an edit to a row whose money has already moved? */
export const isPostPaymentEdit = (e: { status: ExpenseStatus }): boolean => e.status === 'paid'

/** The four groups an expense may be booked to, plus income, which it may not. */
/**
 * The two halves of the chart — see GL_GROUPS on the server.
 *
 * Was five: pfi_direct plus administrative, depot, sales_distribution and
 * income. Those were dropped when the chart was actually seeded, because a
 * cost either belongs to a cargo or it does not, and splitting the overhead
 * side further only asked the requester to classify their own spending before
 * they were allowed to describe it. Nothing was ever booked to the four.
 */
export type GlGroupCode = 'general' | 'pfi_direct'

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

/**
 * A confirmed sale off a batch — payment received, whatever the trucks have
 * done since.
 *
 * Distinct from PfiMovement, which is the ticketing ledger. The two diverge
 * routinely: an order can be paid for weeks before it loads, and the drawer
 * used to list movements under a heading of "Orders", so a batch with four
 * paid orders worth ₦456m and nothing yet ticketed read as having no orders
 * at all.
 */
export type PfiOrder = {
  id: number
  order_number: string | null
  order_status: string
  quantity: number
  total_amount: string | number
  customer_name: string | null
  created_at: string
  /** How much of it has actually been ticketed out. 0 = paid and waiting. */
  loaded_qty: number
}

export function usePfiList(params?: { search?: string; status?: string; type?: string; location?: string | number; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['pfis', params],
    queryFn: async () => {
      const res = await api.get('/pfis', { params })
      return res.data.data as { pfis: PfiWithFinancials[]; pagination: any }
    },
    // Keep the current results on screen while the next set loads. Without
    // this every keystroke in the search box emptied `data`, which put the
    // page into `isLoading` and swapped the whole thing for a full-page
    // spinner — so typing read as the page reloading under you rather than as
    // a list narrowing.
    placeholderData: (prev) => prev,
  })
}

/**
 * One PFI, with its money figures.
 *
 * The endpoint has always decorated the row with `financials` — this used to
 * be typed as a bare `Pfi`, which hid the sales value the gantry form needs to
 * show back.
 */
export function usePfiDetails(id: string) {
  return useQuery({
    queryKey: ['pfis', id],
    queryFn: async () => {
      const res = await api.get(`/pfis/${id}`)
      return res.data.data.pfi as PfiWithFinancials
    },
    enabled: !!id,
  })
}

/**
 * How one figure on the batch was reached.
 *
 * Built server-side, in the same file as the arithmetic it describes — a
 * formula written next to the report would be a second description of the sum,
 * free to drift from it the first time either changed, and a report that
 * confidently explains the wrong sum is worse than one that explains nothing.
 */
export interface FinancialExplanation {
  key: string
  label: string
  /** The figure itself, already formatted. */
  value: string
  /** The formula in words — "Total Cost ÷ BL Quantity". */
  formula: string
  /** That formula filled in with this batch's numbers, so it can be checked. */
  workings: string
  /** What it means and how to read it, including when NOT to trust it. */
  meaning: string
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
        orders: PfiOrder[]
        explain: FinancialExplanation[]
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
  /** One heading inside a section — "Cargo / Vessel Costs", "Insurance". */
  subgroup?: string
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
 * The chart, narrowed to what the current filters can actually return.
 *
 * Shared by Expenses and My Requests so the two pages cannot offer different
 * category lists for the same data. Everything is a narrowing of `groups`,
 * which already arrives as group → subgroup → accounts in GL-code order, so
 * these lists cannot disagree with the pickers on the request form either.
 *
 * The point of narrowing rather than always listing all seventy: a cargo
 * account selected under "General only" filters to nothing, and an empty
 * table reads as no data rather than as two filters that cannot both be true.
 */
export function useExpenseCategoryPickers(filters: {
  type?: 'pfi' | 'general' | ''
  subgroup?: string
}) {
  const { data: cats } = useExpenseCategories()

  const visibleGroups = useMemo(() => {
    const wanted: GlGroupCode | null =
      filters.type === 'pfi' ? 'pfi_direct' : filters.type === 'general' ? 'general' : null
    return (cats?.groups || []).filter((g) => !wanted || g.code === wanted)
  }, [cats?.groups, filters.type])

  /** The cost-group headings. General accounts sit under one flat label. */
  const subgroupOptions = useMemo(() => {
    const out: string[] = []
    for (const g of visibleGroups) {
      for (const s of g.subgroups) {
        const label = s.label || g.label
        if (!out.includes(label)) out.push(label)
      }
    }
    return out
  }, [visibleGroups])

  /** Accounts under their heading, narrowed by type AND cost group. */
  const categoryPickerGroups = useMemo(
    () =>
      visibleGroups
        .flatMap((g) => g.subgroups.map((s) => ({ label: s.label || g.label, accounts: s.accounts })))
        .filter((s) => !filters.subgroup || s.label === filters.subgroup)
        .filter((s) => s.accounts.length > 0),
    [visibleGroups, filters.subgroup],
  )

  return { cats, visibleGroups, subgroupOptions, categoryPickerGroups }
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
/**
 * Put a batch into trading.
 *
 * The counterpart to useFinishPfi, and deliberately as small as that one is
 * large: closing records what a cargo settled for, whereas starting asserts
 * one fact — this batch's stock is now stock anyone can sell.
 */
export const useStartPfi = () =>
  useMoneyMutation<number>(
    async (id) => (await api.post(`/pfis/${id}/start`, {})).data,
    'PFI is now active',
  )

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
      // Both keys appear depending on the endpoint's serialiser, and callers
      // that need the id have been reaching past this type to get it.
      return (res.data.data.depots || []) as Array<{ _id?: string; id?: string | number; name: string }>
    },
  })
}

// ─── Delivery batches ───────────────────────────────────────────────────────
//
// The two facts a delivery allocation has that a cargo does not: the depots it
// may be sold from, and the trucks that carried it. Both are empty on a
// coastal batch, which is sold where it landed and measured into a tank.
// See Sman-Backend/db/migrations/0027.

/** One truck on a manifest. `loadedQty` is what went on, not what it holds. */
export interface PfiTruck {
  id?: number
  truckId?: number | null
  plateNumber: string
  capacity?: number | null
  loadedQty: number
  loadedAt?: string | null
  notes?: string
  /** capacity − loaded. Server-side, so the screen cannot compute it differently. */
  shortBy?: number | null
}

export interface PfiAllowedDepot {
  id: number
  name: string
  city?: string | null
  state?: string | null
}

/** Where a batch may be sold. Empty on anything that is not a delivery batch. */
export function usePfiLocations(pfiId: number | null) {
  return useQuery({
    queryKey: ['pfi-locations', pfiId],
    enabled: pfiId != null,
    queryFn: async () => {
      const res = await api.get(`/pfis/${pfiId}/locations`)
      return (res.data?.data?.locations ?? []) as PfiAllowedDepot[]
    },
  })
}

export function useSetPfiLocations(pfiId: number | null) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (depotIds: number[]) => {
      const res = await api.put(`/pfis/${pfiId}/locations`, { depotIds })
      return res.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pfi-locations', pfiId] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      toast.success(data?.message || 'Locations updated')
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

/**
 * The same allowlist, for a batch whose id is not known when the hook runs.
 *
 * useSetPfiLocations binds its pfiId at render, which is right for a panel
 * sitting on one batch's page. The PFI form is the other case: on a create
 * there is no id until the request comes back, so the id arrives with the
 * mutation rather than before it.
 */
export function useSetLocationsForPfi() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({ pfiId, depotIds }: { pfiId: number; depotIds: number[] }) => {
      const res = await api.put(`/pfis/${pfiId}/locations`, { depotIds })
      return res.data
    },
    onSuccess: (_data, { pfiId }) => {
      queryClient.invalidateQueries({ queryKey: ['pfi-locations', pfiId] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

export function usePfiTrucks(pfiId: number | null) {
  return useQuery({
    queryKey: ['pfi-trucks', pfiId],
    enabled: pfiId != null,
    queryFn: async () => {
      const res = await api.get(`/pfis/${pfiId}/trucks`)
      return res.data?.data as { trucks: PfiTruck[]; loadedTotal: number; capacityTotal: number }
    },
  })
}

/**
 * Replace the manifest.
 *
 * The batch's quantity is rebuilt from it server-side, in the same
 * transaction — so `pfis` is invalidated too, or the page would go on showing
 * the quantity the batch had before these trucks were entered.
 */
export function useSetPfiTrucks(pfiId: number | null) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (trucks: PfiTruck[]) => {
      const res = await api.put(`/pfis/${pfiId}/trucks`, { trucks })
      return res.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pfi-trucks', pfiId] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      queryClient.invalidateQueries({ queryKey: ['pfi-detail', pfiId] })
      toast.success(data?.message || 'Manifest saved')
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

/** One truck as the New Batch dialog collects it, before it is anything. */
export interface DeliveryBatchTruck {
  truckId?: number | null
  plateNumber: string
  capacity?: number | null
  loadedQty: number
}

export interface DeliveryBatchDraft {
  /** Omit to append to `pfiId` instead of creating a batch. */
  pfiNumber?: string
  /** Set to append trucks to a batch that already exists. */
  pfiId?: number
  /** The depot the trucks load at. Required when creating. */
  locationId?: number
  productId?: number
  /** Names, for the operations rows — those columns hold text, not ids. */
  depotName?: string
  productName?: string
  description?: string
  dateAllocated: string
  /** Depots that may sell from the batch. Replaces the existing allowlist. */
  sellAtDepotIds?: number[]
  trucks: DeliveryBatchTruck[]
}

/** Thrown once the batch itself exists, so the caller can offer to open it. */
export class DeliveryBatchPartial extends Error {
  // Assigned in the body rather than declared as constructor parameters:
  // `erasableSyntaxOnly` is on, and parameter properties emit real code.
  readonly pfiId: number
  readonly step: string

  constructor(pfiId: number, step: string, cause: unknown) {
    super(`Batch created, but ${step} failed: ${getErrorMessage(cause)}`)
    this.name = 'DeliveryBatchPartial'
    this.pfiId = pfiId
    this.step = step
  }
}

/**
 * Create a delivery batch and everything that hangs off it, in one call.
 *
 * Locations, the manifest and the operations rows all need a PFI id, and there
 * is no id until the batch exists — which is why this used to be a two-step
 * form: create, then edit. That was the wrong trade. Nobody allocates trucks
 * as a separate errand later; the trucks are the reason the batch is being
 * created, and a form that takes the name and then asks you to come back is a
 * form that lost the thing you opened it for.
 *
 * So the steps are sequenced here rather than staged across two screens. The
 * batch is created first because everything else is addressed by its id, and
 * if a later step fails the id is thrown out with the error — the batch is
 * real by then, and the caller can send you to it rather than making you
 * retype a manifest against a row that already exists.
 *
 * ── The manifest and the operations rows are both written ─────────────────
 *
 * They are not duplicates. `pfi_trucks` is the manifest: it is what the batch
 * quantity is rebuilt from, server-side. `delivery_inventory` is the
 * operational record of each load — the row that gets a customer, a
 * destination, a rate and an offload date, and the row the inventory page
 * lists. A batch written to only one of them is either a batch with no
 * quantity or a batch that never appears on the page it belongs to, so both
 * are written from the same truck list, here, where they cannot disagree.
 */
export function useCreateDeliveryBatch() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (draft: DeliveryBatchDraft) => {
      let pfiId = draft.pfiId

      if (pfiId == null) {
        const res = await api.post('/pfis', {
          pfiNumber: draft.pfiNumber,
          pfiType: 'delivery',
          locationId: draft.locationId,
          productId: draft.productId,
          description: draft.description,
          pfiDate: draft.dateAllocated,
          // Rebuilt from the manifest below. Never typed — see the note above
          // DeliveryBatchPanel on why a batch is worth what its trucks loaded.
          startingQtyLitres: 0,
        })
        const created = res.data?.data?.pfi ?? res.data?.data
        if (!created?.id) throw new Error('The batch was created but came back without an id')
        pfiId = Number(created.id)
      }

      // Past this line the batch exists, so every failure carries its id.
      const step = async <T,>(what: string, run: () => Promise<T>) => {
        try {
          return await run()
        } catch (err) {
          throw new DeliveryBatchPartial(pfiId!, what, err)
        }
      }

      if (draft.sellAtDepotIds?.length) {
        await step('saving its locations', () =>
          api.put(`/pfis/${pfiId}/locations`, { depotIds: draft.sellAtDepotIds }),
        )
      }

      if (draft.trucks.length > 0) {
        // The one definition of "a truck is on this batch", shared with the
        // PFI form — see writeDeliveryTrucks. Both the manifest and the
        // operations register, from the same list, so they cannot disagree.
        await step('saving its trucks', () =>
          writeDeliveryTrucks({
            pfiId: pfiId!,
            pfiNumber: draft.pfiNumber,
            depotName: draft.depotName,
            productName: draft.productName,
            dateAllocated: draft.dateAllocated,
            trucks: draft.trucks,
            isNew: draft.pfiId == null,
          }),
        )
      }

      return { pfiId: pfiId! }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      queryClient.invalidateQueries({ queryKey: ['pfi-locations'] })
      queryClient.invalidateQueries({ queryKey: ['pfi-trucks'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

/**
 * Put trucks on a batch that already exists, in both places they belong.
 *
 * A delivery batch's trucks live in two tables and both are needed:
 *
 *   pfi_trucks          the manifest. The batch quantity is rebuilt from it
 *                       server-side, so this is what makes the batch worth
 *                       what its trucks loaded.
 *   delivery_inventory  the operational row per load — the one that later
 *                       gets a customer, a destination, a rate and an offload
 *                       date, and the ONLY thing the delivery inventory page
 *                       and the sales ledger list.
 *
 * Writing one without the other is why a batch could exist, carry a quantity,
 * and still be invisible on both delivery screens: the batch page's manifest
 * wrote pfi_trucks alone, and the PFI form wrote neither. Every entry point
 * calls this instead, so "created a batch" and "the batch is on the page" stop
 * being different states.
 *
 * Appends rather than replaces. PUT /trucks takes the whole manifest, so the
 * trucks already on the batch are read back and sent with the new ones — and
 * nothing here ever deletes an operational row, because by the time a truck is
 * on the register it may already carry a customer and a payment.
 */
export interface AttachTrucksArgs {
  pfiId: number
  /** Becomes the allocation code the inventory page groups by. */
  pfiNumber?: string
  depotName?: string
  productName?: string
  dateAllocated: string
  trucks: DeliveryBatchTruck[]
  /** Skip reading the existing manifest — nothing can be on a batch just created. */
  isNew?: boolean
}

/**
 * The write itself, as a plain function.
 *
 * Shared by useAttachDeliveryTrucks and useCreateDeliveryBatch so there is one
 * definition of "a truck is on this batch". Two copies of this is how the
 * manifest and the operations register came to disagree in the first place.
 */
export async function writeDeliveryTrucks({
  pfiId, pfiNumber, depotName, productName, dateAllocated, trucks, isNew,
}: AttachTrucksArgs): Promise<{ added: number }> {
  if (trucks.length === 0) return { added: 0 }

  const asManifest = (t: DeliveryBatchTruck | PfiTruck) => ({
    truckId: t.truckId ?? null,
    plateNumber: t.plateNumber,
    capacity: t.capacity ?? null,
    loadedQty: t.loadedQty,
  })

  // Appending, not replacing: PUT /trucks takes the whole manifest, so trucks
  // already on the batch have to be sent back with the new ones or the save
  // would delete them.
  const existing = isNew
    ? []
    : (((await api.get(`/pfis/${pfiId}/trucks`)).data?.data?.trucks ?? []) as PfiTruck[])

  await api.put(`/pfis/${pfiId}/trucks`, {
    trucks: [...existing.map(asManifest), ...trucks.map(asManifest)],
  })

  const code = (pfiNumber || '').trim().toUpperCase().replace(/\s+/g, '-') || undefined
  await Promise.all(
    trucks.map((t) =>
      api.post('/delivery-inventory', {
        // Both casings, as every other caller of this endpoint sends: the
        // serialiser answers in camel and accepts either.
        allocation_code: code, allocationCode: code,
        pfi_id: pfiId, pfiId,
        truck: t.truckId != null ? String(t.truckId) : undefined,
        truck_id: t.truckId ?? undefined, truckId: t.truckId ?? undefined,
        truck_number: t.plateNumber, truckNumber: t.plateNumber,
        depot: depotName || undefined,
        pfi_product: productName || undefined, pfiProduct: productName || undefined,
        // What went on, not what it holds. The old allocation screen wrote
        // capacity here, which overstated every truck that loaded short.
        quantity_allocated: t.loadedQty, quantityAllocated: t.loadedQty,
        date_allocated: dateAllocated, dateAllocated,
        loading_status: 'loaded', loadingStatus: 'loaded',
      }),
    ),
  )

  return { added: trucks.length }
}

export function useAttachDeliveryTrucks() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: writeDeliveryTrucks,
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
      queryClient.invalidateQueries({ queryKey: ['pfi-trucks', vars.pfiId] })
      queryClient.invalidateQueries({ queryKey: ['pfi-detail', vars.pfiId] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
