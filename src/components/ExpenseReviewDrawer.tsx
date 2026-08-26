import { useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Send, ExternalLink, Pencil, Trash2, Lock, Check, Clock } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NumberInput } from '#/components/ui/number-input'
import { NativeSelect } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import { Badge } from '#/components/ui/badge'
import { MICRO } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import {
  useExpenseDetail, useReviewExpense, useAddExpenseComment, useAttachFiles, useDeleteExpense,
  ACTION_META, STATUS_TONE, isExpenseEditable, isExpenseDeletable,
  type PfiExpense, type ExpenseAction,
} from '#/lib/hooks/usePfis'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { BANK_ACCOUNT_USAGE } from '#/lib/bank-accounts'
import { categoryChip, categoryGrouping } from '#/lib/expense-presentation'
import { ExpenseAttachments, FileButton, FileRow, type PendingFile } from '#/components/ExpenseAttachments'
import { uploadExpenseFile } from '#/lib/hooks/useCloudinaryUpload'
import { useToast } from '#/lib/hooks/useToast'
import { naira } from '#/routes/pfi/-pfi-utils'

const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Card', 'Other']

/**
 * A history row's `action` is either a lifecycle verb the write path doesn't
 * use for a status change ("created", "updated", "submitted", "delete") or,
 * for a review transition, the status it moved TO — see reviewExpense on the
 * server, which inserts the audit row with `action: to`. Unmapped values
 * (there shouldn't be any) fall back to the raw string, spaced out.
 */
const HISTORY_LABELS: Record<string, string> = {
  created: 'Raised',
  updated: 'Edited',
  submitted: 'Corrected and resubmitted',
  delete: 'Deleted',
  verified: 'Verified',
  audit_approved: 'CFO approved',
  admin_approved: 'Final approval given',
  paid: 'Marked paid',
  rejected: 'Rejected',
  changes_requested: 'Sent back for changes',
}
const historyLabel = (action: string) => HISTORY_LABELS[action] || action.replace(/_/g, ' ')

/**
 * Which history entries are a stage being reached, and which are chatter.
 *
 * The rail marks a stage reached only when the audit trail says it happened —
 * never inferred from the current status. A request that was sent back and
 * resubmitted has genuinely been verified once, and a rail that recomputed
 * itself from "where is it now" would erase that.
 */
const STAGES = [
  { key: 'created', label: 'Raised' },
  { key: 'verified', label: 'Verified' },
  { key: 'audit_approved', label: 'CFO' },
  { key: 'admin_approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
] as const

/** Where a request stopped, when it did not simply move forward. */
const HALTED: Record<string, { label: string; dot: string; text: string }> = {
  rejected: { label: 'Rejected', dot: 'bg-destructive', text: 'text-destructive' },
  changes_requested: { label: 'Sent back', dot: 'bg-warning', text: 'text-warning' },
}

/**
 * The approval chain as a rail, so "how much further" is answered by looking
 * rather than by counting.
 *
 * The step counter on the badge said "2 of 4" — true, but it does not say
 * which two, or who has it now. This does both in the same space.
 */
function TrackingRail({ expense }: { expense: PfiExpense }) {
  const reached = new Set((expense.history || []).map((h) => h.action))
  // Every request was raised, whether or not the row survived.
  reached.add('created')
  const halted = HALTED[expense.status]

  return (
    <div className="rounded-xl border border-foreground/10 bg-muted/30 p-3">
      <div className="flex items-start">
        {STAGES.map((stage, i) => {
          const done = reached.has(stage.key)
          const current = !halted && !reached.has(STAGES[i + 1]?.key ?? '__none') && done
          return (
            <div key={stage.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                {/* Connectors, drawn either side so the dots line up under
                    their own labels rather than drifting left. */}
                <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done ? 'bg-success' : 'bg-foreground/15')} />
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full ring-2 ring-background transition-colors',
                    done ? 'bg-success text-success-foreground' : 'bg-foreground/15',
                    current && 'ring-4 ring-success/25',
                  )}
                >
                  {done && <Check className="size-3" />}
                </span>
                <span
                  className={cn(
                    'h-0.5 flex-1',
                    i === STAGES.length - 1 ? 'bg-transparent'
                      : reached.has(STAGES[i + 1].key) ? 'bg-success' : 'bg-foreground/15',
                  )}
                />
              </div>
              <span
                className={cn(
                  'truncate text-[10px] font-medium uppercase tracking-wide',
                  done ? 'text-foreground' : 'text-muted-foreground/60',
                )}
              >
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* A halt is not a stage — it is the chain stopping, so it is said in
          words underneath rather than drawn as another dot on the line. */}
      {halted ? (
        <p className={cn('mt-2.5 flex items-center gap-1.5 border-t border-foreground/10 pt-2.5 text-xs font-semibold', halted.text)}>
          <span className={cn('size-1.5 rounded-full', halted.dot)} />
          {halted.label} — waiting on {expense.submitted_by_name || 'the person who raised it'} to correct it
        </p>
      ) : expense.status !== 'paid' ? (
        <p className="mt-2.5 flex items-center gap-1.5 border-t border-foreground/10 pt-2.5 text-xs text-muted-foreground">
          <Clock className="size-3" />
          Step {expense.status_step} of {expense.total_steps} · with {expense.status_label}
        </p>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || <span className="font-normal text-muted-foreground/60">—</span>}</span>
    </div>
  )
}

/** The four-step counter. People want to know how much further it has to go. */
export function StepBadge({ expense }: { expense: PfiExpense }) {
  const terminal = expense.status === 'rejected' || expense.status === 'paid'
  return (
    <Badge className={cn('gap-1.5', STATUS_TONE[expense.status])}>
      {expense.status_label}
      {!terminal && (
        <span className="opacity-70">
          {expense.status_step} of {expense.total_steps}
        </span>
      )}
    </Badge>
  )
}

export function ExpenseReviewDrawer({
  expenseId, open, onOpenChange, onEdit,
}: {
  expenseId: number | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onEdit: (e: PfiExpense) => void
}) {
  const navigate = useNavigate()
  const { data: expense, isLoading } = useExpenseDetail(open ? expenseId : null)
  // Only the accounts expenses are actually paid out of — see
  // BANK_ACCOUNT_USAGE. Offering all of the company's banking here invites a
  // payment being booked against an account it never left.
  const { data: banks } = useBankAccounts({
    status: 'Active',
    usage: BANK_ACCOUNT_USAGE.expenses,
  })
  const review = useReviewExpense()
  const addComment = useAddExpenseComment()
  const remove = useDeleteExpense()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const attach = useAttachFiles()
  const toast = useToast()
  const [pending, setPending] = useState<ExpenseAction | null>(null)
  const [note, setNote] = useState('')
  const [comment, setComment] = useState('')
  /** What the Expenditure Officer fills in at the moment of payment. */
  const [pay, setPay] = useState({
    bank_paid_from: '', amount_paid: '', payment_reference: '',
    payment_date: '', payment_method: '', payment_notes: '',
  })
  const [evidence, setEvidence] = useState<PendingFile[]>([])
  const [uploadingEvidence, setUploadingEvidence] = useState(false)
  const payVariance =
    Number(pay.amount_paid) > 0
      ? Math.round((Number(pay.amount_paid) - Number(expense?.amount ?? 0)) * 100) / 100
      : 0
  // A payment that settles for something other than what was approved needs a
  // reason on the record — mirrors the server-side check in paymentFor().
  const payReady =
    !!pay.bank_paid_from.trim() &&
    Number(pay.amount_paid) > 0 &&
    (payVariance === 0 || !!pay.payment_notes.trim())

  const run = async (action: ExpenseAction) => {
    const meta = ACTION_META[action]
    // Reject and send-back are refused server-side without a reason, so ask
    // for it here rather than round-tripping to be told.
    if (meta.needsNote && !note.trim()) { setPending(action); return }
    // Marking paid is the one action that records facts of its own. First click
    // opens the form, seeded with the amount requested — usually right, and the
    // officer changes it when it is not.
    if (meta.capturesPayment) {
      if (pending !== action) {
        setPay({
          bank_paid_from: expense?.bank_paid_from || '',
          amount_paid: String(Number(expense?.amount ?? 0)),
          payment_reference: '',
          payment_date: format(new Date(), 'yyyy-MM-dd'),
          payment_method: '',
          payment_notes: '',
        })
        setEvidence([])
        setPending(action)
        return
      }
      if (!payReady) return
    }

    await review.mutateAsync({
      id: expense!.id,
      action,
      note,
      payment: meta.capturesPayment
        ? {
            bank_paid_from: pay.bank_paid_from.trim(),
            amount_paid: Number(pay.amount_paid),
            payment_reference: pay.payment_reference.trim(),
            payment_date: pay.payment_date || undefined,
            payment_method: pay.payment_method,
            payment_notes: pay.payment_notes.trim(),
          }
        : undefined,
    })

    // Proof of payment is registered after the transition succeeds — a failed
    // upload must never be the reason a real payment goes unrecorded.
    if (meta.capturesPayment && evidence.length > 0) {
      await attach
        .mutateAsync({
          id: expense!.id,
          files: evidence.map((f) => ({ ...f, type: 'payment_evidence' })),
        })
        .catch((err) => toast.error(getErrorMessage(err)))
    }

    setNote('')
    setPending(null)
    setEvidence([])
  }

  const onEvidenceFiles = async (list: FileList) => {
    setUploadingEvidence(true)
    try {
      const uploaded = await Promise.all([...list].map(uploadExpenseFile))
      setEvidence((prev) => [...prev, ...uploaded])
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setUploadingEvidence(false)
    }
  }

  const say = async () => {
    if (!comment.trim()) return
    await addComment.mutateAsync({ id: expense!.id, body: comment.trim() })
    setComment('')
  }

  /**
   * The full tracking cycle: every stage this request has moved through, who
   * moved it and when — not just the ones somebody happened to leave a note
   * on. Review reasons live in the audit trail and comments in their own
   * table, but to anyone reading the request they are the same timeline — a
   * query and its answer are meaningless apart, and so is a stage with no
   * explanation from the stage before it.
   */
  const thread = [
    ...(expense?.history || []).map((h) => ({
      at: h.created_at,
      who: h.actor_name || 'Someone',
      label: historyLabel(h.action) as string | null,
      body: (h.changes?.note as string) || '',
    })),
    ...(expense?.comments || []).map((c) => ({
      at: c.created_at,
      who: c.author_name || 'Someone',
      label: null as string | null,
      body: c.body,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const requested = Number(expense?.amount ?? 0)
  const settled = expense?.amount_paid == null ? null : Number(expense.amount_paid)
  const variance = settled == null ? 0 : Math.round((settled - requested) * 100) / 100

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-xl">
        {isLoading || !expense ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
        ) : (
          <>
            <DialogHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {expense.reference_number && (
                    <p className={cn(MICRO, 'font-mono text-muted-foreground')}>{expense.reference_number}</p>
                  )}
                  {/* Once settled, the headline figure is what actually left
                      the bank — not what was asked for. */}
                  <DialogTitle className="text-2xl font-bold tracking-tight">
                    {naira(settled ?? requested)}
                  </DialogTitle>
                  {/* Said out loud when the two differ, because the headline
                      silently changing meaning once paid is otherwise invisible. */}
                  {settled != null && variance !== 0 && (
                    <p className={cn('text-xs font-semibold', variance < 0 ? 'text-warning' : 'text-info')}>
                      paid · {naira(Math.abs(variance))} {variance < 0 ? 'less' : 'more'} than the {naira(requested)} requested
                    </p>
                  )}
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="font-medium text-foreground uppercase">
                      {expense.vendor || 'Unnamed payee'}
                    </span>
                    {expense.vendor_id && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                        onClick={() => navigate({ to: '/vendors/details' as any, search: { id: String(expense.vendor_id) } as any })}
                      >
                        View vendor <ExternalLink className="size-3" />
                      </button>
                    )}
                  </DialogDescription>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset',
                        categoryChip(expense),
                      )}
                    >
                      {categoryGrouping(expense)}
                    </span>
                    <span className="text-xs text-muted-foreground">{expense.category_name}</span>
                    {expense.pfi_number && (
                      <span className="text-xs text-muted-foreground">· {expense.pfi_number}</span>
                    )}
                  </div>
                </div>
                <StepBadge expense={expense} />
              </div>

              <TrackingRail expense={expense} />
            </DialogHeader>

            <div className="divide-y divide-foreground/10">
              <div className="pb-2">
                <Row label="Date" value={format(new Date(expense.expense_date), 'd MMM yyyy')} />
                <Row label="Purpose" value={expense.description} />
                <Row label="Category" value={expense.category_name} />
                <Row label="Cargo" value={expense.pfi_number || 'General overhead'} />
                <Row label="Raised by" value={expense.submitted_by_name} />
              </div>

              {/* Only shown when there is an invoice behind the payment. An
                  approver seeing ₦0 ex-VAT would read it as a zero-rated
                  invoice rather than as no invoice at all. */}
              {expense.amount_ex_vat != null && (
                <div className="py-2">
                  <h3 className="pb-1 text-sm font-bold tracking-tight">Invoice</h3>
                  <Row label="Invoice no." value={expense.invoice_number} />
                  <Row label="TIN" value={expense.tin_number} />
                  <Row label="Amount ex VAT" value={naira(Number(expense.amount_ex_vat))} />
                  <Row
                    label="VAT"
                    value={expense.vat_amount == null ? '—' : naira(Number(expense.vat_amount))}
                  />
                  <Row
                    label="Invoice amount"
                    value={expense.invoice_amount == null ? '—' : naira(Number(expense.invoice_amount))}
                  />
                  {/* The rate is shown beside the amount because the amount
                      alone cannot be checked: ₦5,000 on ₦100,000 is either a
                      correct 5% or a mis-keyed 2%. */}
                  <Row
                    label={
                      expense.wht_rate ? `WHT withheld (${Number(expense.wht_rate)}%)` : 'WHT withheld'
                    }
                    value={Number(expense.wht_deduction) ? naira(Number(expense.wht_deduction)) : '—'}
                  />
                </div>
              )}

              <div className="py-2">
                <h3 className="pb-1 text-sm font-bold tracking-tight">Payment</h3>
                <Row label="Amount requested" value={naira(requested)} />
                {settled != null && (
                  <>
                    <Row label="Amount paid" value={naira(settled)} />
                    {/* Only worth a line when the two differ — which is exactly
                        when someone needs to see it. */}
                    {variance !== 0 && (
                      <Row
                        label={variance < 0 ? 'Paid short by' : 'Paid over by'}
                        value={
                          <span className={variance < 0 ? 'text-warning' : 'text-info'}>
                            {naira(Math.abs(variance))}
                          </span>
                        }
                      />
                    )}
                  </>
                )}
                <Row label="Paid from" value={expense.bank_paid_from} />
                <Row label="Payment reference" value={expense.payment_reference} />
                {settled != null && (
                  <>
                    <Row
                      label="Payment date"
                      value={expense.payment_date ? format(new Date(expense.payment_date), 'd MMM yyyy') : undefined}
                    />
                    <Row label="Payment method" value={expense.payment_method} />
                    {expense.payment_notes && <Row label="Payment notes" value={expense.payment_notes} />}
                  </>
                )}
                <Row label="To" value={expense.payee_account_name} />
                <Row
                  label="Account"
                  value={[expense.payee_bank_name, expense.bank_code, expense.payee_account_number]
                    .filter(Boolean).join(' · ')}
                />
                <Row label="Receipt reference" value={expense.receipt_reference} />
              </div>

              {/* Approvers ask for the invoice constantly, so the files live in
                  the drawer rather than behind a count. */}
              <div className="py-3">
                <ExpenseAttachments expenseId={expense.id} />
              </div>

              {/* The tracking cycle: every stage this request has moved
                  through, who moved it and when. Reasons are read from the
                  audit trail, not review_note — that column holds only the
                  latest one and is wiped when a corrected request is
                  resubmitted. Comments sit in the same timeline. */}
              <div className="space-y-3 py-3">
                <h3 className="text-sm font-bold tracking-tight">Tracking</h3>
                {thread.length === 0 && (
                  <p className="text-sm text-muted-foreground/70">Nothing recorded yet.</p>
                )}

                {/* One continuous rail down the left, so the thread reads as a
                    sequence rather than as a stack of unrelated cards. The
                    stage that stopped the chain is the one worth colouring —
                    a timeline where every entry is tinted has no emphasis. */}
                <div className="space-y-0">
                  {thread.map((t, i) => {
                    const halt = t.label === 'Rejected' ? 'destructive'
                      : t.label === 'Sent back for changes' ? 'warning'
                      : null
                    const last = i === thread.length - 1
                    return (
                      <div key={i} className="relative flex gap-3 pb-3">
                        <div className="flex flex-col items-center">
                          <span
                            className={cn(
                              'mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-background',
                              halt === 'destructive' ? 'bg-destructive'
                                : halt === 'warning' ? 'bg-warning'
                                : t.label ? 'bg-accent'
                                : 'bg-foreground/25',
                            )}
                          />
                          {!last && <span className="w-px flex-1 bg-foreground/15" />}
                        </div>
                        <div
                          className={cn(
                            'min-w-0 flex-1 rounded-lg border px-2.5 py-2',
                            halt === 'destructive' ? 'border-destructive/30 bg-destructive/5'
                              : halt === 'warning' ? 'border-warning/30 bg-warning/5'
                              : 'border-foreground/10',
                          )}
                        >
                          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{t.who}</span>
                            {t.label && (
                              <Badge
                                variant="secondary"
                                className={cn(
                                  'px-1.5 py-0 text-[10px] font-medium',
                                  halt === 'destructive' && 'bg-destructive/15 text-destructive',
                                  halt === 'warning' && 'bg-warning/15 text-warning',
                                )}
                              >
                                {t.label}
                              </Badge>
                            )}
                            <span>· {format(new Date(t.at), 'd MMM yyyy, HH:mm')}</span>
                          </p>
                          {t.body && <p className="mt-1 whitespace-pre-wrap text-sm">{t.body}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* The reply box takes its cue from where the request stands.
                    After a reject or a send-back the submitter owes an answer,
                    and a box labelled "Reply to the request…" gives no hint
                    that anything is being waited on. */}
                {(() => {
                  const owed = HALTED[expense.status]
                  return (
                    <div
                      className={cn(
                        'space-y-2 rounded-lg border p-2.5',
                        owed
                          ? expense.status === 'rejected'
                            ? 'border-destructive/30 bg-destructive/5'
                            : 'border-warning/30 bg-warning/5'
                          : 'border-foreground/10',
                      )}
                    >
                      <label className="block text-xs font-semibold">
                        {owed
                          ? `Respond to why this was ${owed.label.toLowerCase()}`
                          : 'Add a note to this request'}
                      </label>
                      <div className="flex items-start gap-2">
                        <Textarea
                          rows={2}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder={
                            owed
                              ? 'Explain what you have changed, or ask what is needed…'
                              : 'Anyone following this request will see it…'
                          }
                        />
                        <Button
                          size="icon" variant="outline" title="Send"
                          disabled={!comment.trim() || addComment.isPending}
                          onClick={say}
                        >
                          {addComment.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                          <span className="sr-only">Send</span>
                        </Button>
                      </div>
                      {owed && (
                        <p className="text-xs text-muted-foreground">
                          A note alone does not resend it — use
                          {' '}<span className="font-semibold">Correct and resubmit</span>{' '}
                          below once the request itself is fixed.
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* The page renders whatever the server says is allowed and decides
                nothing itself — including why there is nothing to do. */}
            {expense.available_actions.length > 0 ? (
              <div className="space-y-3">
                {pending && ACTION_META[pending].needsNote && (
                  <div className="space-y-1.5">
                    <label className={cn(MICRO, 'block text-muted-foreground')}>
                      Reason for {ACTION_META[pending].label.toLowerCase()}
                    </label>
                    <Textarea
                      autoFocus rows={2} value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Required — the submitter sees this"
                    />
                  </div>
                )}

                {/* Settlement, captured at the moment it happens. The account
                    and the amount are both required: a payment nobody can trace
                    to an account, for an amount nobody recorded, is a rumour. */}
                {pending && ACTION_META[pending].capturesPayment && (
                  <div className="grid gap-3 rounded-lg border border-foreground/15 p-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>Paid from</label>
                      {banks && banks.length > 0 ? (
                        <NativeSelect
                          autoFocus
                          value={pay.bank_paid_from}
                          onChange={(e) => setPay((p) => ({ ...p, bank_paid_from: e.target.value }))}
                        >
                          <option value="">Select the account this left…</option>
                          {banks.map((b) => {
                            const label = [b.bankName, b.accountNumber].filter(Boolean).join(' · ')
                            return <option key={String(b.id)} value={label}>{label}</option>
                          })}
                        </NativeSelect>
                      ) : (
                        <Input
                          autoFocus value={pay.bank_paid_from}
                          onChange={(e) => setPay((p) => ({ ...p, bank_paid_from: e.target.value }))}
                          placeholder="Which account did this leave?"
                        />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>Amount paid</label>
                      <NumberInput
                        allowDecimal value={pay.amount_paid}
                        onValueChange={(v) => setPay((p) => ({ ...p, amount_paid: v }))}
                      />
                      <p className="text-xs leading-tight text-muted-foreground/70">
                        {naira(requested)} requested
                        {Number(pay.amount_paid) > 0 && Number(pay.amount_paid) !== requested
                          ? ` · ${naira(Math.abs(Number(pay.amount_paid) - requested))} ${
                              Number(pay.amount_paid) < requested ? 'short' : 'over'
                            }`
                          : ''}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>
                        Payment reference
                      </label>
                      <Input
                        value={pay.payment_reference}
                        onChange={(e) => setPay((p) => ({ ...p, payment_reference: e.target.value }))}
                        placeholder="Teller or transfer ref"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>Payment date</label>
                      <Input
                        type="date"
                        value={pay.payment_date}
                        onChange={(e) => setPay((p) => ({ ...p, payment_date: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>Payment method</label>
                      <NativeSelect
                        value={pay.payment_method}
                        onChange={(e) => setPay((p) => ({ ...p, payment_method: e.target.value }))}
                      >
                        <option value="">Select…</option>
                        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className={cn(MICRO, 'block text-muted-foreground')}>
                        Payment notes{payVariance !== 0 ? ' — required, amount differs from what was requested' : ' (optional)'}
                      </label>
                      <Textarea
                        rows={2}
                        value={pay.payment_notes}
                        onChange={(e) => setPay((p) => ({ ...p, payment_notes: e.target.value }))}
                        placeholder={payVariance !== 0 ? 'Explain the difference' : 'Anything worth noting about this payment'}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className={cn(MICRO, 'block text-muted-foreground')}>
                          Payment evidence{evidence.length ? ` (${evidence.length})` : ' (optional)'}
                        </label>
                        <FileButton busy={uploadingEvidence} onFiles={onEvidenceFiles} label="Attach proof" />
                      </div>
                      {evidence.length > 0 && (
                        <div className="space-y-1.5">
                          {evidence.map((f) => (
                            <FileRow
                              key={f.publicId}
                              name={f.fileName}
                              size={f.sizeBytes}
                              href={f.url}
                              onRemove={() => setEvidence((prev) => prev.filter((x) => x.publicId !== f.publicId))}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Every action wears its own colour. Reject and send-back
                    used to render as plain outline buttons because they ask
                    for a note first — so the two most consequential choices
                    on the screen were the two hardest to pick out. They are
                    now red and amber like everywhere else; the note is asked
                    for on the first click either way. */}
                <div className="flex flex-wrap gap-2">
                  {expense.available_actions.map((a) => {
                    const meta = ACTION_META[a]
                    const armed = pending === a
                    return (
                      <Button
                        key={a}
                        className={cn(meta.tone, 'font-semibold', armed && 'ring-2 ring-foreground/20')}
                        disabled={
                          review.isPending ||
                          (armed && meta.needsNote && !note.trim()) ||
                          (armed && meta.capturesPayment && !payReady)
                        }
                        onClick={() => run(a)}
                      >
                        {review.isPending && <Loader2 className="animate-spin" />}
                        {armed && meta.capturesPayment
                          ? 'Confirm payment'
                          : armed && meta.needsNote
                            ? `Confirm ${meta.label.toLowerCase()}`
                            : meta.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
                {expense.action_blocked_reason}
              </p>
            )}

            {/*
              Edit and delete live here as well as on the row. This dialog is
              where the request is actually read — the amounts, the
              attachments, the history — so it is where someone decides it is
              wrong, and having to close it and find the row again to act on
              that decision is the wrong way round.
            */}
            <DialogFooter className="border-t border-foreground/10 pt-3 sm:justify-between sm:gap-2">
              {confirmDelete ? (
                // The confirm takes over the whole footer rather than sitting
                // beside the buttons it is asking about — a destructive
                // question next to the thing that triggers it is how the wrong
                // one gets clicked.
                <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 pl-3">
                  <span className="text-sm font-semibold text-destructive">
                    Delete this request permanently?
                  </span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </Button>
                    <Button
                      variant="destructive" size="sm" disabled={remove.isPending}
                      onClick={async () => {
                        await remove.mutateAsync(expense.id)
                        setConfirmDelete(false)
                        onOpenChange(false)
                      }}
                    >
                      {remove.isPending && <Loader2 className="animate-spin" />}
                      <Trash2 data-icon="inline-start" />
                      Yes, delete
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {isExpenseEditable(expense) ? (
                      <Button
                        variant="outline"
                        className={cn(
                          'font-semibold',
                          // After a reject or send-back this is the whole point
                          // of opening the drawer, so it stops looking neutral.
                          HALTED[expense.status] && 'border-accent text-accent hover:bg-accent/10',
                        )}
                        onClick={() => { onOpenChange(false); onEdit(expense) }}
                      >
                        <Pencil data-icon="inline-start" />
                        {HALTED[expense.status] ? 'Correct and resubmit' : 'Edit'}
                      </Button>
                    ) : (
                      <Button variant="outline" disabled title="Paid — this expense is closed">
                        <Lock data-icon="inline-start" />
                        Paid — locked
                      </Button>
                    )}
                    {isExpenseDeletable(expense) && (
                      <Button
                        variant="outline"
                        className="border-destructive/40 font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
