import type { DeliverySale } from '#/lib/types'
import { toNum } from '#/lib/sales-ledger-utils'

/**
 * How a filling-station remittance reached the bank.
 *
 * A station takes money two ways and they settle differently: card payments
 * go through the POS terminal, cash is walked to the bank and paid in. Both
 * end up in the same account, so recording them as one undifferentiated
 * "payment" made bank charges impossible to see — the charge only exists as
 * the gap between the two.
 */
export type DepositChannel = 'pos' | 'bank_deposit'

export const DEPOSIT_CHANNELS: ReadonlyArray<{
  value: DepositChannel
  label: string
  /** Used in report columns and export headers, where the full label is too long. */
  short: string
}> = [
  { value: 'pos', label: 'POS Transaction', short: 'POS' },
  { value: 'bank_deposit', label: 'Bank Deposit', short: 'Deposit' },
]

const LABELS: Record<DepositChannel, string> = {
  pos: 'POS Transaction',
  bank_deposit: 'Bank Deposit',
}

/**
 * "Unspecified" rather than a guess: every entry recorded before the split
 * existed has no channel, and inventing one for it would move a bank-charges
 * figure that is derived from the difference between the two.
 */
export function depositChannelLabel(channel: DepositChannel | null | undefined): string {
  return channel ? LABELS[channel] : 'Unspecified'
}

/** Totals for one group of entries, split by how the money came in. */
export interface ChannelTotals {
  pos: number
  bankDeposit: number
  /** Remittances recorded before the channel split, or left unspecified. */
  unspecified: number
  /** pos + bankDeposit + unspecified — what the ledger counts as paid. */
  total: number
}

/**
 * Only rows carrying money are counted. A pump sale and an expense both live
 * in delivery_sales too, and neither is a remittance.
 */
export function sumByChannel(entries: DeliverySale[]): ChannelTotals {
  const totals: ChannelTotals = { pos: 0, bankDeposit: 0, unspecified: 0, total: 0 }
  for (const e of entries) {
    const amount = toNum(e.paymentAmount)
    if (amount <= 0) continue
    totals.total += amount
    if (e.depositChannel === 'pos') totals.pos += amount
    else if (e.depositChannel === 'bank_deposit') totals.bankDeposit += amount
    else totals.unspecified += amount
  }
  return totals
}

/**
 * Bank charges: Bank Deposit − POS Transaction.
 *
 * That is the direction as specified. Note it reads negative in the ordinary
 * settlement case, where the bank credits less than the POS transacted and
 * the difference is the fee — so the figure is a signed difference and the
 * UI labels the sign rather than assuming one (see bankChargesTone).
 *
 * Derived, never stored. Storing it on an entry would let it drift from the
 * entries it is computed from the moment one of them is edited, and the whole
 * point of the split is that the two sides reconcile.
 */
export function bankCharges(totals: ChannelTotals): number {
  return totals.bankDeposit - totals.pos
}

/**
 * Charges only mean anything once both sides of the pair are present. One
 * channel on its own is not a shortfall — it is a day that is half entered.
 */
export function hasBothChannels(totals: ChannelTotals): boolean {
  return totals.pos > 0 && totals.bankDeposit > 0
}

/**
 * How to read a signed charge figure.
 *
 * negative — the bank credited less than the POS transacted: a real cost.
 * positive — more was deposited than the POS shows: a surplus, not a charge.
 * zero     — the two reconcile exactly.
 */
export function bankChargesTone(value: number): 'cost' | 'surplus' | 'flat' {
  if (value < 0) return 'cost'
  if (value > 0) return 'surplus'
  return 'flat'
}

/** The label that belongs next to a signed charge figure. */
export function bankChargesLabel(value: number): string {
  const tone = bankChargesTone(value)
  if (tone === 'cost') return 'Bank Charges'
  if (tone === 'surplus') return 'Excess Credit'
  return 'Bank Charges'
}
