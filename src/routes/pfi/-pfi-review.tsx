import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, ShieldCheck, Info, Truck, Landmark, Users } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { useAdminList } from '#/lib/hooks/useAdmin'
import { useActivatePfi } from '#/lib/hooks/usePfis'
import type { Pfi } from '#/lib/types'

/**
 * The officers a batch can carry, and which two it cannot trade without.
 *
 * Audit and finance are required because they are the two the server refuses
 * without: somebody answerable for the count and somebody answerable for the
 * money, named before trading rather than found afterwards. The rest are
 * useful and optional, and saying which is which here means the form agrees
 * with what the server will actually accept.
 */
const OFFICERS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'salesManagerId', label: 'Finance officer', required: true },
  { key: 'auditOfficerId', label: 'Audit officer', required: true },
  { key: 'productOfficerId', label: 'Product officer' },
  { key: 'itComplianceOfficerId', label: 'IT compliance officer' },
  { key: 'securityExitOfficerId', label: 'Security exit officer' },
  { key: 'commissionOfficerId', label: 'Commission officer' },
]

/**
 * Stage two: read what was raised, assign the bank and the officers, release it.
 *
 * ── Why this is a screen and not a button ─────────────────────────────────
 *
 * A PFI used to be raised and trading in one save. The point of splitting it
 * is that a second person looks at the cargo before it can take money, so this
 * shows the batch as raised — including a trucking batch's trucks, which do
 * not exist anywhere else yet — and asks for the two things a trading batch
 * cannot sensibly be without.
 *
 * ── Assigning an officer is granting them the batch ───────────────────────
 *
 * The same act does both, deliberately. An officer named on a PFI they cannot
 * open is answerable for something they cannot see, and PFI assignment now
 * decides what a person's register shows. Said on the screen, because it is
 * not obvious from a select box labelled "Audit officer".
 */
export function PfiReviewPanel({ pfi, onActivated }: { pfi: Pfi; onActivated?: () => void }) {
  const { data: bankAccounts = [] } = useBankAccounts({ status: 'Active' })
  const { data: adminsData } = useAdminList()
  const activate = useActivatePfi()

  const staff = Array.isArray(adminsData) ? adminsData : []

  const [selectedBanks, setSelectedBanks] = useState<number[]>([])
  const [officers, setOfficers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      OFFICERS.map((o) => [o.key, pfi[o.key as keyof Pfi] ? String(pfi[o.key as keyof Pfi]) : '']),
    ),
  )
  const [note, setNote] = useState('')

  const pending = pfi.pendingBatch
  const missing = useMemo(() => {
    if (!selectedBanks.length) return 'Choose the bank account that collects for this batch'
    const unset = OFFICERS.filter((o) => o.required && !officers[o.key])
    if (unset.length) return `Assign the ${unset.map((o) => o.label.toLowerCase()).join(' and the ')}`
    return null
  }, [selectedBanks, officers])

  const toggleBank = (id: number) =>
    setSelectedBanks((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id])

  const submit = async () => {
    if (missing) return
    try {
      await activate.mutateAsync({
        id: Number(pfi.id),
        bankAccountIds: selectedBanks,
        officers,
        note: note.trim(),
      })
      onActivated?.()
    } catch {
      // The mutation raises its own toast. Nothing here is half-done — the
      // server does all of it in one transaction — so the panel simply stays
      // open with the selection intact.
    }
  }

  return (
    <section className={cn(PANEL, 'border-warning/40')}>
      <div className={cn(PANEL_RAIL, 'border-warning/25')}>
        <span className={cn(MICRO, 'flex items-center gap-2')}>
          <ShieldCheck className="size-4 text-warning" />
          Waiting for review
        </span>
        <StatusChip tone="warning" fill="solid">Not trading</StatusChip>
      </div>

      <div className={cn(PANEL_BODY, 'space-y-6')}>
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium">
              This batch cannot take money until it has a bank account and its officers.
            </p>
            <p className="mt-1 text-muted-foreground">
              {pfi.raisedAt
                ? `Raised ${format(new Date(pfi.raisedAt), 'd MMM yyyy, HH:mm')}. `
                : ''}
              Assigning an officer is also what lets them see this PFI — their register shows the
              batches they have been given and nothing else.
            </p>
          </div>
        </div>

        {/*
          A trucking batch's trucks exist nowhere else yet. They are written to
          the inventory and the ledger by the activation below, so this is the
          only place they can be checked before money starts being owed.
        */}
        {pending && Array.isArray(pending.trucks) && pending.trucks.length > 0 && (
          <div className="space-y-2">
            <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
              <Truck className="size-3.5" />
              The batch this will create — {pending.code}
            </span>
            <div className="overflow-hidden rounded-lg border border-foreground/15">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Loaded</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Product</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.trucks.map((t, i) => (
                    <TableRow key={`${t.plateNumber}-${i}`}>
                      <TableCell className="font-medium">{t.plateNumber}</TableCell>
                      <TableCell className="tabular-nums">
                        {Number(t.loadedQty).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pending.depotName || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pending.productName || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              {pending.trucks.length} truck{pending.trucks.length === 1 ? '' : 's'} ·{' '}
              {pending.trucks
                .reduce((sum, t) => sum + Number(t.loadedQty || 0), 0)
                .toLocaleString()}{' '}
              total. These reach the inventory and the sales ledger when you activate.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
            <Landmark className="size-3.5" />
            Bank account — where this batch collects
          </span>
          {bankAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active bank accounts to assign.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {bankAccounts.map((b: any) => {
                const checked = selectedBanks.includes(Number(b.id))
                return (
                  <label
                    key={b.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-250 ease-luxe',
                      checked
                        ? 'border-accent/50 bg-accent/5'
                        : 'border-foreground/15 hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBank(Number(b.id))}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium uppercase">{b.accountName}</span>
                      <span className="block text-muted-foreground">
                        {b.bankName} · {b.accountNumber}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
            <Users className="size-3.5" />
            Officers — who is answerable, and who can see it
          </span>
          <div className="grid gap-4 sm:grid-cols-2">
            {OFFICERS.map((o) => (
              <div key={o.key} className="space-y-1.5">
                <Label htmlFor={o.key}>
                  {o.label}
                  {o.required && <span className="text-destructive"> *</span>}
                </Label>
                <NativeSelect
                  id={o.key}
                  value={officers[o.key] || ''}
                  onChange={(e) =>
                    setOfficers((prev) => ({ ...prev, [o.key]: e.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {staff.map((u: any) => (
                    <option key={u.id} value={String(u.id)}>{u.full_name}</option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="review-note">Note (optional)</Label>
          <Input
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you checked before releasing this batch"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={!!missing || activate.isPending}>
            {activate.isPending
              ? <Loader2 className="animate-spin" />
              : <ShieldCheck data-icon="inline-start" />}
            Activate {pfi.pfiNumber}
          </Button>
          {missing && <span className="text-sm text-muted-foreground">{missing}</span>}
        </div>
      </div>
    </section>
  )
}
