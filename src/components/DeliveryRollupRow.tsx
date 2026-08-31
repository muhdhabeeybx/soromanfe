import { cn } from '#/lib/utils'
import { formatMoneyIn } from '#/lib/format'
import {
  CalendarDays, Megaphone, CheckCircle2, Send, XCircle, AlertCircle, Wallet as WalletIcon,
} from 'lucide-react'
import type { DeliveryBucket } from '#/lib/hooks/useMessaging'

const formatDate = (v: string | null) => {
  if (!v) return '—'
  return new Date(v).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * How a reason reads, by what it means for the desk rather than how bad it
 * sounds. `fixable` is amber because it is the band worth acting on — an empty
 * wallet, a DND route, a dead number — while `external` stays grey: a handset
 * that never came online is not a fault anyone here can clear.
 */
const REASON_TONE: Record<string, string> = {
  good: 'bg-success/10 text-success border-success/20',
  fixable: 'bg-warning/10 text-warning border-warning/20',
  external: 'bg-muted text-muted-foreground border-border',
  expected: 'bg-muted text-muted-foreground border-border',
  pending: 'bg-muted text-muted-foreground border-border',
}

/**
 * One classified reason, as a clickable filter.
 *
 * The roll-up shows these with a count, the log rows show one apiece, and both
 * narrow the log to that reason when clicked — so it is one component rather
 * than two that have to keep agreeing about what amber means.
 */
export function ReasonChip({
  label, tone, count, active, onClick,
}: {
  label: string
  tone: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs cursor-pointer transition-colors duration-250 ease-luxe',
        REASON_TONE[tone] || REASON_TONE.external,
        active && 'ring-1 ring-primary',
      )}
      title={active ? 'Showing only these — click to clear' : `Show only these${count === undefined ? '' : ` ${count.toLocaleString()}`}`}
    >
      {count !== undefined && <span className="tabular-nums font-medium">{count.toLocaleString()}</span>}
      <span className="font-normal">{label}</span>
    </button>
  )
}

const dayLabel = (iso: string | null) => {
  if (!iso) return '—'
  const date = new Date(iso)
  const today = new Date()
  const days = Math.floor((today.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  const written = date.toLocaleDateString('en-NG', { weekday: 'short', day: '2-digit', month: 'short' })
  if (days === 0) return `Today · ${written}`
  if (days === 1) return `Yesterday · ${written}`
  return written
}

/**
 * One bucket of the delivery log — a day, or a broadcast.
 *
 * Everything the desk asks about a send, on one line: how many went, how many
 * landed, how many were refused and WHY, and what the wallet paid for it.
 * Clicking a reason narrows the rows beneath to exactly those, which is the
 * step that turns "412 failed" into a list of numbers to fix.
 */
export function DeliveryRollupRow({
  bucket, groupBy, activeReason, onReason,
}: {
  bucket: DeliveryBucket
  groupBy: 'day' | 'campaign'
  activeReason: string
  onReason: (code: string) => void
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          {groupBy === 'day'
            ? <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
            : <Megaphone className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm font-medium truncate">
            {groupBy === 'day' ? dayLabel(bucket.at) : bucket.label}
          </span>
          {groupBy === 'campaign' && bucket.at && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(bucket.at)}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
          <span className="text-muted-foreground">{bucket.total.toLocaleString()} attempted</span>
          {bucket.delivered > 0 && (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3" />{bucket.delivered.toLocaleString()} delivered
            </span>
          )}
          {/* Kept apart from "delivered" deliberately: one means a handset
              received it, the other means Termii took it and we have not heard
              since. Conflating them hides every message that quietly never
              arrived. */}
          {bucket.sent > 0 && (
            <span
              className="flex items-center gap-1 text-muted-foreground"
              title="Accepted by Termii. No carrier receipt has come back for these."
            >
              <Send className="size-3" />{bucket.sent.toLocaleString()} sent
            </span>
          )}
          {bucket.failed > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="size-3" />{bucket.failed.toLocaleString()} rejected
            </span>
          )}
          {bucket.skipped > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <AlertCircle className="size-3" />{bucket.skipped.toLocaleString()} skipped
            </span>
          )}
        </div>
      </div>

      {/* Why the ones that did not land, did not land — each one a filter. */}
      {bucket.reasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {bucket.reasons.map((r) => (
            <ReasonChip
              key={r.code}
              label={r.label}
              tone={r.tone}
              count={r.count}
              active={activeReason === r.code}
              onClick={() => onReason(activeReason === r.code ? '' : r.code)}
            />
          ))}
        </div>
      )}

      {/* The money. Only the broadcasts in this bucket are priced — Termii
          bills a send, and an order confirmation belongs to no campaign — so
          the sentence says what it does not cover rather than letting the
          figure be read as the whole SMS bill. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {bucket.spent !== null ? (
          <span className="flex items-center gap-1">
            <WalletIcon className="size-3" />
            <strong className="font-medium text-foreground">{formatMoneyIn(bucket.spent, bucket.currency)}</strong>
            {' '}deducted from Termii
            {bucket.campaigns > 1 && ` across ${bucket.campaigns} broadcasts`}
          </span>
        ) : bucket.smsAttempts > 0 ? (
          <span className="flex items-center gap-1">
            <WalletIcon className="size-3" />No wallet reading for these
          </span>
        ) : null}
        {bucket.smsAttempts > 0 && <span>{bucket.smsAttempts.toLocaleString()} SMS</span>}
        {bucket.emailAttempts > 0 && <span>{bucket.emailAttempts.toLocaleString()} email</span>}
        {bucket.unpricedSms > 0 && bucket.spent !== null && (
          <span title="Order confirmations, codes and ticket messages belong to no broadcast, so nothing prices them.">
            ({bucket.unpricedSms.toLocaleString()} not part of a broadcast, unpriced)
          </span>
        )}
      </div>
    </div>
  )
}
