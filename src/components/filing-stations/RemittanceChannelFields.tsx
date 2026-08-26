import { CreditCard, Landmark } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { fmt, formatWithCommas } from '#/lib/sales-ledger-utils'
import { useBankAccountPicker, BANK_ACCOUNT_USAGE } from '#/lib/bank-accounts'
import {
  DEPOSIT_CHANNELS,
  bankCharges,
  bankChargesLabel,
  bankChargesTone,
  hasBothChannels,
  type ChannelTotals,
  type DepositChannel,
} from '#/lib/deposit-channel'

const CHANNEL_ICONS = {
  pos: CreditCard,
  bank_deposit: Landmark,
} as const

/**
 * The channel picker: which of the two ways a station's money reached the
 * bank this entry represents.
 *
 * A segmented control rather than a dropdown, because there are exactly two
 * and the choice changes what the rest of the form means — that is worth
 * showing both options for rather than hiding one behind a click.
 */
export function DepositChannelPicker({
  value,
  onChange,
  disabled,
}: {
  value: DepositChannel
  onChange: (channel: DepositChannel) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">
        Remittance Type <span className="text-destructive">*</span>
      </label>
      <div
        role="radiogroup"
        aria-label="Remittance type"
        className="grid grid-cols-2 gap-2"
      >
        {DEPOSIT_CHANNELS.map((c) => {
          const Icon = CHANNEL_ICONS[c.value]
          const active = value === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(c.value)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors duration-250 ease-luxe',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-foreground/15 text-muted-foreground hover:border-foreground/30',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className={cn('text-sm', active && 'font-semibold')}>{c.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The bank account this remittance landed in, drawn from the managed table.
 *
 * `value` is the account id as a string. An account already on the entry but
 * since retired is added back as an option so editing an old entry cannot
 * silently blank its account.
 */
export function BankAccountSelect({
  value,
  onChange,
  legacyLabel,
  required = true,
}: {
  value: string
  onChange: (id: string) => void
  /** The stored bank string, when it resolves to no active account. */
  legacyLabel?: string | null
  required?: boolean
}) {
  const { options, isLoading } = useBankAccountPicker({ usage: BANK_ACCOUNT_USAGE.truckSales })
  const known = options.some((o) => o.id === value)

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">
        Bank Account {required && <span className="text-destructive">*</span>}
      </label>
      <select
        aria-label="Bank account"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-base md:text-sm"
      >
        <option value="">{isLoading ? 'Loading accounts…' : 'Select account…'}</option>
        {!known && legacyLabel && <option value={value || '__legacy'}>{legacyLabel} (on record)</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {!isLoading && options.length === 0 && (
        <p className="text-xs text-warning">
          No active bank accounts. Add one under Bank Accounts first.
        </p>
      )}
    </div>
  )
}

/**
 * The auto-populated bank-charges figure.
 *
 * Charges are not typed in and are not stored — they are Bank Deposit minus
 * POS Transaction across the entries already on this station's cycle, plus
 * whatever is being keyed in right now. Showing the running pair is the point:
 * the number is meaningless until both sides of the day are entered, and a
 * bare field would read as ₦0 in that state rather than as "not yet".
 */
export function BankChargesPanel({
  totals,
  pending,
  pendingChannel,
}: {
  /** Totals for entries already recorded on this cycle. */
  totals: ChannelTotals
  /** The amount being keyed in right now, folded in live. */
  pending?: number
  pendingChannel?: DepositChannel
}) {
  const projected: ChannelTotals = {
    ...totals,
    pos: totals.pos + (pendingChannel === 'pos' ? pending || 0 : 0),
    bankDeposit: totals.bankDeposit + (pendingChannel === 'bank_deposit' ? pending || 0 : 0),
  }
  const charge = bankCharges(projected)
  const tone = bankChargesTone(charge)
  const complete = hasBothChannels(projected)

  return (
    <div className="rounded-lg border border-foreground/15 bg-muted/40">
      <div className="grid grid-cols-2 divide-x divide-foreground/10">
        <div className="px-3 py-2.5">
          <p className="text-xs uppercase text-muted-foreground">POS Transaction</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">₦{fmt(projected.pos)}</p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-xs uppercase text-muted-foreground">Bank Deposit</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">₦{fmt(projected.bankDeposit)}</p>
        </div>
      </div>
      <div
        className={cn(
          'flex items-center justify-between border-t border-foreground/15 px-3 py-2.5',
          complete && tone === 'cost' && 'bg-destructive/5',
          complete && tone === 'surplus' && 'bg-accent/5',
        )}
      >
        <div>
          <p className="text-xs uppercase text-muted-foreground">
            {complete ? bankChargesLabel(charge) : 'Bank Charges'}
          </p>
          <p className="text-xs text-muted-foreground">Bank Deposit − POS Transaction</p>
        </div>
        {complete ? (
          <p
            className={cn(
              'text-base font-semibold tabular-nums',
              tone === 'cost' && 'text-destructive',
              tone === 'surplus' && 'text-accent',
            )}
          >
            {charge < 0 ? '−' : ''}₦{fmt(Math.abs(charge))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Awaiting both entries</p>
        )}
      </div>
    </div>
  )
}

/** The amount field, comma-formatted as it is typed. */
export function RemittanceAmountField({
  channel,
  value,
  onChange,
}: {
  channel: DepositChannel
  value: string
  onChange: (v: string) => void
}) {
  const label = channel === 'pos' ? 'POS Amount (₦)' : 'Amount Deposited (₦)'
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">
        {label} <span className="text-destructive">*</span>
      </label>
      <Input
        type="text"
        inputMode="decimal"
        placeholder="e.g. 5,000,000"
        className="h-9 text-sm"
        value={value}
        onChange={(e) => onChange(formatWithCommas(e.target.value))}
      />
    </div>
  )
}
