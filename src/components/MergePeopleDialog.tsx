import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  AlertTriangle, ArrowRight, Building2, Check, Loader2, Merge, Phone, Wallet,
} from 'lucide-react'
import { useMergePlan, useMergePeople, type MergeRef, type MergeMoving } from '#/lib/hooks/usePeople'
import { formatCurrency } from '#/lib/format'
import { cn } from '#/lib/utils'

/**
 * Two rows that are one person, folded into one.
 *
 * ── What this screen is for ────────────────────────────────────────────────
 *
 * The same customer gets opened twice all the time — they ring from the
 * director's line one week and the warehouse line the next, the desk cannot
 * find the first record under that number, and a second one is created. Both
 * then collect orders, and the book has one man trading as two.
 *
 * Deleting the spare was never the answer, and the hygiene panel is right to
 * refuse: the spare is where half the orders are. So this screen does not
 * delete anything. It MOVES — every order, deposit, licence, request and naira
 * onto the record being kept — and only then removes the empty shell.
 *
 * ── Why the choice of survivor is the whole dialog ─────────────────────────
 *
 * Everything else the merge does is arithmetic the server can be trusted with.
 * Which record survives is not: it is the customer id that thousands of ledger
 * rows will point at afterwards, and it is the only part of this that cannot
 * be undone. So it is a deliberate choice, pre-made for the common case — the
 * record carrying the most orders — and shown next to the evidence for it.
 */

/** Either book's row, in the one shape this dialog reasons about. */
export interface MergeCandidate {
  kind: 'customer' | 'lead' | 'contact'
  customerId: number | null
  contactId: number | null
  name: string
  phone: string
  companyName?: string
  balance?: number | null
  orderCount?: number
  createdAt?: string
}

const refOf = (c: MergeCandidate): MergeRef =>
  c.customerId ? { kind: 'customer', id: c.customerId } : { kind: 'contact', id: c.contactId! }

const keyOf = (c: MergeCandidate) => `${refOf(c).kind}:${refOf(c).id}`

/**
 * The record that should survive unless somebody says otherwise.
 *
 * A customer always beats a lead — a lead has no account to move anything
 * onto. Between customers it is the one carrying the most orders, because
 * that is the record whose history the ledger, the reports and the customer's
 * own memory are all built around; the balance and the age of the record break
 * the tie after that.
 */
const defaultSurvivor = (people: MergeCandidate[]) =>
  [...people].sort((a, b) => {
    const account = Number(Boolean(b.customerId)) - Number(Boolean(a.customerId))
    if (account) return account
    const orders = (b.orderCount || 0) - (a.orderCount || 0)
    if (orders) return orders
    const balance = Number(b.balance || 0) - Number(a.balance || 0)
    if (balance) return balance
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  })[0]

/** The counts worth reading out, in the order a person cares about them. */
const MOVING_LABELS: Array<[keyof MergeMoving, string]> = [
  ['orders', 'order'],
  ['deposits', 'deposit'],
  ['walletHolds', 'held payment'],
  ['expectedPayments', 'expected payment'],
  ['commissions', 'commission'],
  ['licenses', 'licence'],
  ['dangoteRequests', 'Dangote request'],
  ['lpgRequests', 'LPG request'],
  ['notifications', 'message'],
]

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

export function MergePeopleDialog({
  open,
  onOpenChange,
  people,
  canMerge = true,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Everyone the desk ticked. Two or more, or there is nothing to merge. */
  people: MergeCandidate[]
  /** Merging deletes customer rows, so it is admin-gated on the server too. */
  canMerge?: boolean
  onMerged?: () => void
}) {
  const [survivorKey, setSurvivorKey] = useState<string | null>(null)

  // Re-picked whenever the selection changes, so ticking one more duplicate
  // does not leave the dialog defending a survivor chosen for a different set.
  const selectionKey = people.map(keyOf).sort().join(',')
  useEffect(() => {
    setSurvivorKey(people.length ? keyOf(defaultSurvivor(people)) : null)
  }, [selectionKey, people.length])

  const survivor = people.find((p) => keyOf(p) === survivorKey) || null
  const losers = useMemo(
    () => people.filter((p) => keyOf(p) !== survivorKey),
    [people, survivorKey],
  )

  const { data: plan, isFetching, isError, error } = useMergePlan(
    survivor ? refOf(survivor) : null,
    losers.map(refOf),
    { enabled: open && Boolean(survivor) && losers.length > 0 },
  )
  const merge = useMergePeople()

  const run = async () => {
    if (!survivor || !losers.length) return
    await merge.mutateAsync({ target: refOf(survivor), sources: losers.map(refOf) })
    onOpenChange(false)
    onMerged?.()
  }

  const moving = plan?.moving
  const movingParts = moving
    ? MOVING_LABELS.filter(([field]) => Number(moving[field]) > 0)
      .map(([field, word]) => plural(Number(moving[field]), word))
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[88svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge {people.length} records into one</DialogTitle>
          <DialogDescription>
            Nothing is deleted. Every order, deposit and naira moves onto the record you
            keep, and the other numbers stay on the account so the customer can still be
            found — and still sign in — by whichever line they ring from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">Which record should survive?</p>
          <div className="space-y-2">
            {people.map((p) => {
              const chosen = keyOf(p) === survivorKey
              const isCustomer = Boolean(p.customerId)
              return (
                <label
                  key={keyOf(p)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-250 ease-luxe',
                    chosen ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="merge-survivor"
                    checked={chosen}
                    onChange={() => setSurvivorKey(keyOf(p))}
                    className="mt-1 size-4 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium uppercase">{p.name}</span>
                      <Badge
                        variant="outline"
                        className={cn('h-5 px-1.5 text-xs font-normal', isCustomer && 'bg-accent/10 text-accent border-accent/20')}
                      >
                        {isCustomer ? 'Customer' : 'Lead'}
                      </Badge>
                      {chosen && (
                        <Badge variant="outline" className="h-5 gap-1 border-primary/30 bg-primary/10 px-1.5 text-xs font-normal text-primary">
                          <Check className="size-3" />Kept
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="size-3" />{p.phone}</span>
                      {p.companyName && (
                        <span className="flex items-center gap-1"><Building2 className="size-3" />{p.companyName}</span>
                      )}
                      {isCustomer && (
                        <span>{plural(p.orderCount || 0, 'order')}</span>
                      )}
                      {p.balance ? (
                        <span className="flex items-center gap-1"><Wallet className="size-3" />{formatCurrency(p.balance)}</span>
                      ) : null}
                    </div>
                    {/* Said on the row it applies to, not once at the bottom:
                        this is the sentence that makes the radio button mean
                        something. */}
                    {!chosen && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Everything on this record moves to{' '}
                        <span className="text-foreground">{survivor?.name || 'the kept record'}</span>, then it is removed.
                      </p>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* ── What the server says will actually happen ───────────────────── */}
        {isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {(error as any)?.response?.data?.message || (error as any)?.message || 'That merge cannot be worked out'}
          </div>
        ) : isFetching || !plan ? (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />Working out what moves…
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <p className="flex flex-wrap items-center gap-1.5 text-sm">
              <Merge className="size-4 text-primary" />
              <span className="font-medium">{plan.target.name}</span>
              <span className="text-muted-foreground">keeps everything.</span>
            </p>

            <ul className="space-y-1 text-sm text-muted-foreground">
              {movingParts.length > 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>{movingParts.join(', ')} move across — nothing is lost.</span>
                </li>
              )}
              {plan.balance.incoming > 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Wallet becomes{' '}
                    <span className="font-medium text-foreground tabular-nums">{formatCurrency(plan.balance.total)}</span>
                    {' '}— {formatCurrency(plan.balance.keeping)} plus {formatCurrency(plan.balance.incoming)} carried over.
                  </span>
                </li>
              )}
              {plan.phones.length > 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {plural(plan.phones.length, 'number')} stay on the account —{' '}
                    <span className="font-mono text-xs">{plan.phones.join(', ')}</span>. Each one still signs in and still finds them in search.
                  </span>
                </li>
              )}
              {plan.fills.length > 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Blank fields filled in: {plan.fills.map((f) => `${f.label.toLowerCase()} from ${f.from}`).join(', ')}.
                  </span>
                </li>
              )}
              {plan.tags.length > 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>Tags combined: {plan.tags.join(', ')}.</span>
                </li>
              )}
              {!movingParts.length && plan.balance.incoming === 0 && (
                <li className="flex items-start gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
                  <span>Nothing financial is attached to the records being folded in.</span>
                </li>
              )}
            </ul>

            {plan.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}
              </p>
            ))}
          </div>
        )}

        {!canMerge && (
          <p className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Merging removes customer records, so it needs an admin. Ask one to run this.
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            This cannot be undone — the records folded in are removed once their history has moved.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={run}
              disabled={!canMerge || !survivor || !losers.length || merge.isPending || isFetching || isError}
            >
              {merge.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Merge {losers.length} into {survivor?.name?.split(' ')[0] || 'this record'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
