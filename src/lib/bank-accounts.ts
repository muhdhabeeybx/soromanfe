import { useMemo } from 'react'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import type { BankAccount } from '#/lib/types'

/**
 * The company's collection accounts, read from the managed table rather than
 * a literal in the source.
 *
 * The sales ledger and the filling stations used to carry their own array of
 * three accounts, written by hand. That list had drifted badly: of the three,
 * only one existed in bank_accounts, while the account the ledger uses most
 * (481 entries) was not in either the managed table or the picker under the
 * same name. Managing an account meant editing TypeScript.
 *
 * ── Why historical rows still read correctly ──────────────────────────────
 *
 * delivery_sales stores the account as a string — "1311924986 · Zenith Bank"
 * — not as an id, and that string is the only record older rows have. So
 * resolution is by account NUMBER against whatever the managed table
 * currently holds, and anything that fails to resolve falls back to the
 * stored string verbatim. An account can be renamed, retired or deleted
 * without a single historical row losing its label; at worst it shows the
 * text that was recorded at the time, which is exactly what it showed before.
 *
 * New entries additionally write bank_account_id, so rows written from here
 * on are linked properly rather than only by string.
 */

/** The shape delivery_sales stores in its `bank` column. */
export function bankAccountToString(account: BankAccount): string {
  return `${account.accountNumber} · ${account.bankName}`
}

/** Just the digits, so "1311924986 · Zenith Bank" and "1311924986" compare equal. */
const digits = (v: string) => v.replace(/\D/g, '')

/**
 * The account a stored bank string refers to, or null.
 *
 * Matched on the account number appearing anywhere in the string rather than
 * on the whole string being equal: the recorded text has carried at least
 * three shapes over the years ("1311924986 · Zenith Bank", bare numbers, and
 * shorthand like "SRM TRUCKS/ZB"), and the number is the only stable part.
 * Shorthand that carries no number resolves to null and keeps its own text.
 */
export function resolveBankAccount(
  accounts: BankAccount[],
  bankStr: string | null | undefined,
): BankAccount | null {
  if (!bankStr) return null
  const haystack = digits(bankStr)
  if (!haystack) return null
  return accounts.find((a) => a.accountNumber && haystack.includes(digits(a.accountNumber))) || null
}

/** "Soroman Trucks — Zenith Bank (1311924986)", or the raw string if unresolvable. */
export function formatBankLabel(
  accounts: BankAccount[],
  bankStr: string | null | undefined,
): string {
  if (!bankStr) return ''
  const account = resolveBankAccount(accounts, bankStr)
  if (!account) return bankStr
  return `${account.accountName} — ${account.bankName} (${account.accountNumber})`
}

/** The select-input value for a stored bank string — '' when nothing matches. */
export function bankStringToId(
  accounts: BankAccount[],
  bankStr: string | null | undefined,
): string {
  const account = resolveBankAccount(accounts, bankStr)
  return account ? String(account.id) : ''
}

/** One option row for a bank-account picker. */
export interface BankAccountOption {
  id: string
  label: string
  account: BankAccount
}

/**
 * The areas that keep their own shortlist of collection accounts.
 *
 * Every dropdown used to offer all 15 active accounts — the refinery account
 * and a customer's personal account sat next to the one actually wanted, and
 * picking wrong is silent until someone reconciles against a statement the
 * money was never going to appear on.
 */
export const BANK_ACCOUNT_USAGE = {
  truckSales: 'truck_sales',
  expenses: 'expenses',
} as const

export type BankAccountUsage = (typeof BANK_ACCOUNT_USAGE)[keyof typeof BANK_ACCOUNT_USAGE]

/**
 * Accounts for a picker: active ones only, since an inactive account is one
 * the company has stopped collecting into and offering it invites a payment
 * being recorded against a closed account.
 *
 * Sorted by account name so the list reads the same on every page, with the
 * default account first — it is the one most entries go to.
 *
 * `usage` narrows the OPTIONS to the accounts tagged for that area. It
 * deliberately does not narrow `accounts`, which callers use to resolve the
 * bank string on historical rows: those rows may name an account since
 * retired or never tagged, and scoping the resolution set would turn a
 * correctly-labelled old entry back into a raw number. Filtering client-side
 * keeps one cached query behind every picker for the same reason — the full
 * list has to be there regardless.
 */
export function useBankAccountPicker(opts?: { usage?: BankAccountUsage }) {
  const { data: accounts = [], isLoading, isError, refetch } = useBankAccounts()
  const usage = opts?.usage

  const active = useMemo(
    () =>
      accounts
        .filter((a) => a.status === 'Active')
        .filter((a) => !usage || (a.usage ?? []).includes(usage))
        .sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
          return a.accountName.localeCompare(b.accountName)
        }),
    [accounts, usage],
  )

  const options: BankAccountOption[] = useMemo(
    () =>
      active.map((a) => ({
        id: String(a.id),
        // Account number leads: it is what the depositor quotes and what the
        // bank statement shows, so it is the field someone reconciling is
        // scanning for.
        label: `${a.accountNumber} · ${a.bankName} · ${a.accountName}`,
        account: a,
      })),
    [active],
  )

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o.account])), [options])

  return {
    /** Every account, active or not — resolution must still name a retired one. */
    accounts,
    /** Active accounts only, for pickers. */
    options,
    byId,
    isLoading,
    isError,
    refetch,
  }
}
