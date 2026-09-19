import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Loader2, ShieldCheck, Landmark, Users, Pencil, FileBadge2Icon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import { StatusChip } from '#/components/ui/status-chip'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { useAdminList } from '#/lib/hooks/useAdmin'
import { useActivatePfi } from '#/lib/hooks/usePfis'
import { naira, unitNames } from '#/routes/pfi/-pfi-utils'
import type { Pfi } from '#/lib/types'

/**
 * The four the review decides, and the two it cannot release without.
 *
 * Finance and audit are one role here, not two — the same person answers for
 * the money and the count — so they share a field rather than asking twice for
 * the same name. With the sales manager they are the pair the server refuses
 * without, and marking them required here means the form agrees with what will
 * actually be accepted rather than failing on submit.
 *
 * IT compliance and security exit are missing on purpose: they are gate roles,
 * named when the cargo is raised, because whoever raises it already knows them
 * and there is nothing for a review to decide. They are shown below as facts,
 * not as choices.
 */
const OFFICERS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'auditOfficerId', label: 'Finance/Audit Officer', required: true },
  { key: 'salesManagerId', label: 'Sales Manager', required: true },
  { key: 'productOfficerId', label: 'Product Manager' },
  { key: 'commissionOfficerId', label: 'Commission Officer' },
]

const TYPE_LABEL: Record<string, string> = {
  coastal: 'Coastal',
  gantry: 'Gantry',
  delivery: 'Delivery',
  trucking: 'Trucking',
}

/**
 * One labelled fact. Dashes where a figure was never entered, never a false 0.
 *
 * `sub` carries the SAME quantity in another unit — a cargo is measured in
 * litres and billed in tonnes, and the two are read together. It is a second
 * line rather than a second Fact so the pair cannot be separated by the grid
 * reflowing, and so the MT figure never reads as a quantity of its own.
 */
function Fact({ label, value, sub, wide }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className={cn(MICRO, 'text-muted-foreground')}>{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium" title={typeof value === 'string' ? value : undefined}>
        {value}
      </dd>
      {sub && <dd className="truncate text-xs text-muted-foreground">{sub}</dd>}
    </div>
  )
}

/** A tonnage as it is written on the papers — two decimals, or nothing. */
const mt = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) && n > 0
    ? `${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`
    : null
}

/**
 * Start selling — the batch as raised, then what it needs to trade.
 *
 * ── Why the details are in here ───────────────────────────────────────────
 *
 * Releasing a cargo to trade cannot be taken back, and it used to be decided
 * from a card in a list: a number, a location, and a button. The decision is
 * about what was actually entered, so what was entered is on the same screen
 * as the button — read it, correct it with Edit if it is wrong, then say where
 * it collects and who answers for it.
 *
 * ── Assigning an officer is granting them the batch ───────────────────────
 *
 * The same act does both, deliberately. An officer named on a PFI they cannot
 * open is answerable for something they cannot see, and PFI assignment now
 * decides what a person's register shows. Said on screen, because it is not
 * obvious from a select box labelled "Finance/Audit Officer".
 */
export function PfiActivateDialog({
  pfi, open, onOpenChange, onActivated,
}: {
  pfi: Pfi | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onActivated?: () => void
}) {
  const navigate = useNavigate()
  const { data: bankAccounts = [] } = useBankAccounts({ status: 'Active' })
  const { data: adminsData } = useAdminList()
  const activate = useActivatePfi()

  const staff = Array.isArray(adminsData) ? adminsData : []

  const [bankAccountId, setBankAccountId] = useState('')
  const [officers, setOfficers] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  /**
   * Seeded each time it opens, not once at mount.
   *
   * The register keeps one dialog and swaps which PFI it points at, so state
   * initialised at mount would carry the previous batch's officers into the
   * next one — and this is the screen where naming the wrong person is the
   * mistake that matters.
   */
  useEffect(() => {
    if (!open || !pfi) return
    setBankAccountId('')
    setNote('')
    setOfficers(Object.fromEntries(
      OFFICERS.map((o) => [o.key, pfi[o.key as keyof Pfi] ? String(pfi[o.key as keyof Pfi]) : '']),
    ))
  }, [open, pfi])

  const missing = useMemo(() => {
    if (!bankAccountId) return 'Choose the bank account this batch collects into'
    const unset = OFFICERS.filter((o) => o.required && !officers[o.key])
    if (unset.length) return `Assign the ${unset.map((o) => o.label.toLowerCase()).join(' and the ')}`
    return null
  }, [bankAccountId, officers])

  const submit = async () => {
    if (missing || !pfi) return
    try {
      await activate.mutateAsync({
        id: Number(pfi.id),
        bankAccountIds: [Number(bankAccountId)],
        officers,
        note: note.trim(),
      })
      onActivated?.()
      onOpenChange(false)
    } catch {
      // The mutation raises its own toast. Nothing here is half-done — the
      // server does all of it in one transaction — so the dialog stays open
      // with the selection intact.
    }
  }

  if (!pfi) return null

  const unit = unitNames(pfi.productUnit)
  const pending = pfi.pendingBatch
  const qty = Number(pfi.startingQtyLitres || 0)
  const price = Number(pfi.unitPrice || 0)
  const isTruckCounted = pfi.pfiType === 'delivery' || pfi.pfiType === 'trucking'
  const isCargo = pfi.pfiType !== 'gantry' && !isTruckCounted
  /** What it is billed for: the BL on a cargo, the quantity bought otherwise. */
  const billedQty = isCargo ? Number(pfi.blQtyLitres ?? 0) : qty
  const cargoValue = billedQty > 0 && price > 0 ? billedQty * price : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl gap-0 overflow-y-auto p-0">
        <DialogHeader className="space-y-1 mt-4 border-b border-foreground/15 px-6 py-5 text-left">
          <div className="flex items-center gap-2.5">
            <FileBadge2Icon className="size-5 shrink-0 text-accent" />
            <DialogTitle className="text-lg">Start selling <span className="font-bold">{pfi.pfiNumber}</span></DialogTitle>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <StatusChip tone="warning" fill="solid">Inactive</StatusChip>
            <span className="text-sm font-normal uppercase text-muted-foreground">
              {[TYPE_LABEL[pfi.pfiType || 'coastal'], pfi.locationName, pfi.productName]
                .filter(Boolean)
                .join('  ·  ')}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── The batch as raised ───────────────────────────────────────── */}
        <div className="space-y-4 px-6 py-5">
          <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
            <FileBadge2Icon className="size-3.5" />
            PFI Details
          </span>

          <dl className="grid gap-x-6 gap-y-4 rounded-lg border border-foreground/15 bg-muted/30 p-4 sm:grid-cols-4">
            <Fact
              label="Date"
              value={pfi.pfiDate ? format(new Date(pfi.pfiDate), 'd MMM yyyy') : '—'}
            />
            {/*
              Tank and BL both carry their tonnage. A cargo is measured in
              litres and billed in tonnes, and checking one against the papers
              means reading both — so neither is left to be worked out.
            */}
            <Fact
              label={`Tank quantity (${unit.short})`}
              value={qty > 0 ? qty.toLocaleString() : '—'}
              sub={mt(pfi.qtyVolumeMt)}
            />
            <Fact
              label={`Price per Litre`}
              value={price > 0 ? naira(price) : '—'}
            />
            {/* Blank means unknown, so it reads as a dash rather than ₦0 —
                the same rule the form and every report follow. */}
            <Fact label="Cargo value" value={cargoValue != null ? naira(cargoValue) : '—'} />

            {isCargo && (
              <Fact
                label={`BL figures (${unit.short})`}
                value={pfi.blQtyLitres != null ? Number(pfi.blQtyLitres).toLocaleString() : '—'}
                sub={mt(pfi.blQtyMt)}
              />
            )}
            {!isCargo && (
              <Fact
                label={isTruckCounted ? 'Trucks' : 'Tickets'}
                value={pfi.ticketCount != null ? Number(pfi.ticketCount).toLocaleString() : '—'}
              />
            )}
            <Fact label="IT compliance" value={pfi.itComplianceOfficerName || '—'} />
            <Fact label="Security exit" value={pfi.securityExitOfficerName || '—'} />
            {pfi.description
              ? <Fact label="Description" value={pfi.description} />
              : <Fact label="Vessel" value={pfi.vesselName || '—'} />}
          </dl>

          {/*
            A trucking batch's trucks exist nowhere else yet. Activation writes
            them to the inventory and the sales ledger, so this is the only
            place they can be checked before money starts being owed.
          */}
          {pending && Array.isArray(pending.trucks) && pending.trucks.length > 0 && (
            <div className="space-y-2">
              <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
                <FileBadge2Icon className="size-3.5" />
                The batch this creates — {pending.code}
              </span>
              <div className="max-h-48 overflow-auto rounded-lg border border-foreground/15">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Truck</TableHead>
                      <TableHead>Loaded</TableHead>
                      <TableHead>Depot</TableHead>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                {pending.trucks.length} truck{pending.trucks.length === 1 ? '' : 's'} ·{' '}
                {pending.trucks.reduce((s, t) => s + Number(t.loadedQty || 0), 0).toLocaleString()}{' '}
                {unit.short}. These reach the inventory and the sales ledger when you activate.
              </p>
            </div>
          )}
        </div>

        {/* ── What it needs to trade ────────────────────────────────────── */}
        <div className="space-y-5 border-t border-foreground/15 bg-muted/20 px-6 py-5">
          {/* <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="text-sm text-muted-foreground">
              Its remaining stock joins the {pfi.productName || 'product'} total and its revenue
              starts counting towards the portfolio. Expenses already booked against it stay
              exactly as they are.{' '}
              <span className="text-foreground">
                Assigning an officer is also what lets them see this PFI.
              </span>
            </p>
          </div> */}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bank-account" className="flex items-center gap-1.5">
                <Landmark className="size-3.5 text-muted-foreground" />
                Bank account <span className="text-destructive">*</span>
              </Label>
              <NativeSelect
                id="bank-account"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">
                  {bankAccounts.length ? 'Where this batch collects…' : 'No active accounts'}
                </option>
                {bankAccounts.map((b: any) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.accountName} — {b.bankName} · {b.accountNumber}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="review-note">Note (optional)</Label>
              <Input
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you checked before releasing it"
              />
            </div>
          </div>

          <div className="space-y-3">
            <span className={cn(MICRO, 'flex items-center gap-2 text-muted-foreground')}>
              <Users className="size-3.5" />
              Officers
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
                    onChange={(e) => setOfficers((prev) => ({ ...prev, [o.key]: e.target.value }))}
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
        </div>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/15 px-6 py-4">
          {/* Correcting the batch is a different screen, so this leaves rather
              than pretending the dialog can edit it. */}
          <Button
            variant="outline"
            disabled={activate.isPending}
            onClick={() => {
              onOpenChange(false)
              navigate({ to: '/pfi/form', search: { id: String(pfi.id) } })
            }}
          >
            <Pencil data-icon="inline-start" />
            Edit PFI details
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/* {missing && (
              <span className="text-sm text-muted-foreground">{missing}</span>
            )} */}
            <Button onClick={submit} disabled={!!missing || activate.isPending}>
              {activate.isPending
                ? <Loader2 className="animate-spin" />
                : <ShieldCheck data-icon="inline-start" />}
              Activate PFI
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
