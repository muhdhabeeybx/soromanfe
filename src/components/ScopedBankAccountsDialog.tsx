import { useMemo, useState } from 'react'
import { Building2, Check, Loader2, Plus, Search, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import {
  useBankAccounts,
  useCreateBankAccount,
  useUpdateBankAccount,
} from '#/lib/hooks/useBankAccounts'
import type { BankAccountUsage } from '#/lib/bank-accounts'
import type { BankAccount } from '#/lib/types'
import { cn } from '#/lib/utils'

/**
 * Chooses which accounts one area of the app may collect into.
 *
 * This is deliberately NOT a second bank accounts page. An account is one
 * record with one set of details, owned by the Bank Accounts screen; what
 * differs per area is only whether that account is on this area's shortlist.
 * So this dialog edits a single field — the `usage` tag — and everything
 * else about the account is left where it is managed. Two full CRUD screens
 * over one table would let the same account be edited from two places and
 * disagree with itself.
 *
 * Adding a brand new account is offered here too, because being sent to
 * another page mid-task to type an account number and come back is exactly
 * the friction that leaves the shortlist unmaintained.
 */
export function ScopedBankAccountsDialog({
  open,
  onOpenChange,
  usage,
  title,
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  usage: BankAccountUsage
  title: string
  description: string
}) {
  const { data: accounts = [], isLoading } = useBankAccounts()
  const updateAccount = useUpdateBankAccount()
  const createAccount = useCreateBankAccount()

  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ bankName: '', accountName: '', accountNumber: '' })

  /** The id currently being written, so only that row shows a spinner. */
  const [busyId, setBusyId] = useState<string | number | null>(null)

  const isOn = (a: BankAccount) => (a.usage ?? []).includes(usage)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = (a: BankAccount) =>
      !q ||
      a.accountName.toLowerCase().includes(q) ||
      a.bankName.toLowerCase().includes(q) ||
      a.accountNumber.includes(q)

    // Selected accounts first: this dialog answers "what is on the list?"
    // before "what else could be", and once a shortlist is settled the
    // chosen few should not be scattered through fifteen others.
    return accounts.filter(matches).sort((a, b) => {
      if (isOn(a) !== isOn(b)) return isOn(a) ? -1 : 1
      return a.accountName.localeCompare(b.accountName)
    })
  }, [accounts, search, usage])

  const selectedCount = accounts.filter(isOn).length

  const toggle = async (account: BankAccount) => {
    const current = account.usage ?? []
    const next = isOn(account)
      ? current.filter((u) => u !== usage)
      : [...current, usage]

    setBusyId(account.id)
    try {
      await updateAccount.mutateAsync({ id: account.id, data: { usage: next } })
    } finally {
      setBusyId(null)
    }
  }

  const canSave =
    draft.bankName.trim() && draft.accountName.trim() && draft.accountNumber.trim()

  const addNew = async () => {
    if (!canSave) return
    await createAccount.mutateAsync({
      bankName: draft.bankName.trim(),
      accountName: draft.accountName.trim(),
      accountNumber: draft.accountNumber.trim(),
      status: 'Active',
      // Created from this dialog, so it goes straight onto this shortlist —
      // otherwise it is added and still does not appear, which reads as a bug.
      usage: [usage],
    })
    setDraft({ bankName: '', accountName: '', accountNumber: '' })
    setAdding(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search account name, bank or number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading accounts…
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No account matches “{search}”.
              </p>
            ) : (
              rows.map((account) => {
                const on = isOn(account)
                const busy = busyId === account.id
                return (
                  <button
                    key={String(account.id)}
                    type="button"
                    onClick={() => !busy && toggle(account)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                      on
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-transparent hover:bg-muted/50',
                      busy && 'opacity-60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded border',
                        on ? 'border-accent bg-accent text-accent-foreground' : 'border-input',
                      )}
                    >
                      {busy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : on ? (
                        <Check className="size-3.5" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {account.accountName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {account.accountNumber} · {account.bankName}
                      </span>
                    </span>
                    {account.status !== 'Active' && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {account.status}
                      </Badge>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {adding ? (
            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="scoped-acct-name">Account name</Label>
                  <Input
                    id="scoped-acct-name"
                    value={draft.accountName}
                    placeholder="Soroman Kano 1"
                    onChange={(e) => setDraft({ ...draft, accountName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scoped-acct-bank">Bank</Label>
                  <Input
                    id="scoped-acct-bank"
                    value={draft.bankName}
                    placeholder="Moniepoint"
                    onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scoped-acct-number">Account number</Label>
                <Input
                  id="scoped-acct-number"
                  value={draft.accountNumber}
                  placeholder="4005281106"
                  inputMode="numeric"
                  onChange={(e) =>
                    setDraft({ ...draft, accountNumber: e.target.value.replace(/[^0-9]/g, '') })
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  <X className="size-4" /> Cancel
                </Button>
                <Button size="sm" onClick={addNew} disabled={!canSave || createAccount.isPending}>
                  {createAccount.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add account
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add a new account
            </Button>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="size-3.5" />
            {selectedCount} {selectedCount === 1 ? 'account' : 'accounts'} on this list
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
