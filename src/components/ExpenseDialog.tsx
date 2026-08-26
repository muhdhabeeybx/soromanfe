import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Building2, Fuel } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NumberInput } from '#/components/ui/number-input'
import { NativeSelect } from '#/components/ui/native-select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import {
  useExpenseCategories, useSaveExpense, useAttachFiles, usePfiList,
  type PfiExpense,
} from '#/lib/hooks/usePfis'
import { useCreateVendor } from '#/lib/hooks/useVendors'
import { VendorField, type VendorFieldValue } from '#/components/VendorField'
import { PendingAttachments, ExpenseAttachments, type PendingFile } from '#/components/ExpenseAttachments'
import { cn } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'

const BLANK = {
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  type: 'general' as 'general' | 'pfi',
  category_id: '',
  /** Which cargo the cost belongs to. Set only when type is 'pfi'. */
  pfi_id: '',
  vendor: '',
  vendor_id: '',
  // tin_number / invoice_number: dropped from the form (kept on the schema
  // for the handful of legacy rows that have them) — see the note by
  // includeTax below for the same reasoning applied to the invoice fields.
  description: '',
  amount: '',
  amount_ex_vat: '',
  vat_amount: '',
  invoice_amount: '',
  // The rate drives the deduction. Empty means the amount was typed by hand.
  wht_rate: '',
  wht_deduction: '',
  // receipt_reference: dropped from the form. It duplicated the attachment —
  // the receipt itself is uploaded — and was left blank on all but a handful
  // of rows. Omitting it from the payload leaves an existing value untouched
  // (the update path only writes fields that arrive), so historical rows keep
  // theirs and the drawer still shows it.
  // Where the money is going. Captured up front so an approver can see the
  // destination account before authorising rather than after.
  payee_bank_name: '',
  payee_account_number: '',
  payee_account_name: '',
}

/** A blank money field stays blank on the wire — never 0. */
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const show = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(Number(v))

/**
 * A schedule figure for the screen. Blank stays blank throughout: "no invoice
 * was raised" and "an invoice worth nothing" are different facts, and so are
 * "not yet paid" and "paid nothing".
 */
export const cash = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : naira(Number(v))

/** The same figure for the CSV, unformatted so a spreadsheet reads it as money. */
export const plain = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2)

/**
 * The form: what it's for (general overhead or a specific cargo), who it's
 * paid to, and where the money goes.
 *
 * The GL chart is now seeded (migration 0007), so the two questions are asked
 * separately, which is what the schema always intended: the category says what
 * the money was spent ON, and — for a cargo cost — the PFI says which batch it
 * lands on. Before, a "PFI expense" picked a category named after the cargo,
 * so the chart recorded which vessel and never what for; 220 booked expenses
 * were moved onto real accounts by that migration.
 *
 * TIN and invoice number stay commented out below rather than deleted.
 *
 * Shared by both the officer-facing Expenses page and the My Requests page —
 * raising or correcting a request looks the same wherever it happens.
 */
/**
 * One labelled field.
 *
 * The label is real text, not the muted 10px micro-caps the rest of the app
 * uses for column headings: this form is filled in by people who raise a
 * request occasionally, not by anyone who has learned its layout, and a
 * heading they have to squint at is a field they guess at. The hint sits
 * between the label and the control so it is read as instruction rather than
 * as an error after the fact.
 */
function Field({
  label, hint, required, wide, children,
}: {
  label: string
  hint?: string
  required?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', wide && 'sm:col-span-2')}>
      <label className="block text-sm font-semibold leading-none">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

/** A rule with a title, so the form reads as four short steps not one long list. */
function Section({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="sm:col-span-2">
      <div className="flex items-baseline gap-2 border-b border-foreground/10 pb-1.5">
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  )
}

export function ExpenseDialog({
  expense, open, onOpenChange,
}: {
  expense: PfiExpense | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data: cats } = useExpenseCategories()
  // Every PFI, not just open ones: an expense often lands after the cargo has
  // been closed out, and a closed PFI missing from the list would leave the
  // cost with nowhere to go.
  const { data: pfiData } = usePfiList({ limit: 500 })
  const save = useSaveExpense()
  const attach = useAttachFiles()
  const createVendor = useCreateVendor()
  /** Files uploaded before the request exists; registered once it does. */
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  // A freshly-typed vendor is offered for saving by default; an old row's
  // legacy free-text vendor is not — otherwise merely opening it for an
  // unrelated edit would quietly create a vendor record.
  const [saveNewVendor, setSaveNewVendor] = useState(!expense)
  // The invoice/VAT/WHT breakdown is real accounting detail most requesters
  // don't have on hand at the moment of asking — collapsed by default, and
  // only sent if actually opened. Editing a request that already has one
  // opens it automatically so the figures stay visible.
  const [includeTax, setIncludeTax] = useState(!!expense?.amount_ex_vat)

  const seed = expense
    ? {
        expense_date: String(expense.expense_date).slice(0, 10),
        type: (expense.pfi_id ? 'pfi' : 'general') as 'general' | 'pfi',
        category_id: String(expense.category_id),
        pfi_id: expense.pfi_id ? String(expense.pfi_id) : '',
        vendor: expense.vendor || '',
        vendor_id: expense.vendor_id ? String(expense.vendor_id) : '',
        description: expense.description || '',
        amount: String(Number(expense.amount)),
        amount_ex_vat: show(expense.amount_ex_vat),
        vat_amount: show(expense.vat_amount),
        invoice_amount: show(expense.invoice_amount),
        wht_rate: show(expense.wht_rate),
        wht_deduction: show(expense.wht_deduction),
        payee_bank_name: expense.payee_bank_name || '',
        payee_account_number: expense.payee_account_number || '',
        payee_account_name: expense.payee_account_name || '',
      }
    : BLANK

  const [form, setForm] = useState(seed)
  const key = expense?.id ?? 'new'
  const [seeded, setSeeded] = useState(key)
  if (seeded !== key) {
    setSeeded(key)
    setForm(seed)
    setPendingFiles([])
    setSaveNewVendor(!expense)
    setIncludeTax(!!expense?.amount_ex_vat)
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const vatRate = cats?.vat_rate ?? 0.075
  const whtRates = cats?.wht_rates?.length ? cats.wht_rates : [0, 2, 2.5, 5, 10]
  const categoryOptions = form.type === 'pfi' ? (cats?.pfi || []) : (cats?.general || [])

  /**
   * The PFI accounts under their headings, read off the runs of GL code the
   * API already returns in order. Falls back to one unlabelled group so a
   * chart seeded without subgroups still renders a usable list.
   */
  const categoryGroups = useMemo(() => {
    const out: Array<{ label: string; accounts: typeof categoryOptions }> = []
    for (const account of cats?.pfi || []) {
      const label = account.gl_subgroup || 'Other'
      const last = out[out.length - 1]
      if (last && last.label === label) last.accounts.push(account)
      else out.push({ label, accounts: [account] })
    }
    return out
  }, [cats?.pfi])

  const pfiOptions = pfiData?.pfis || []

  // Switching type invalidates both the category and the cargo: a general
  // overhead must not keep a PFI attached, or it would quietly inflate that
  // batch's cost, and the server refuses the combination anyway.
  const setType = (type: 'general' | 'pfi') =>
    setForm((f) => ({ ...f, type, category_id: '', pfi_id: '' }))

  /**
   * The invoice arithmetic, run forward from whatever was just edited:
   *
   *   ex-VAT → VAT (7.5%) → invoice (their sum) → WHT (rate × ex-VAT)
   *          → amount requested (invoice − WHT)
   *
   * Only the fields downstream of the edit are rewritten, so a VAT or an
   * invoice total typed by hand is never overwritten from underneath — plenty
   * of vendors charge no VAT, and an invoice does not always add up the way the
   * arithmetic says it should.
   *
   * Withholding is taken on the ex-VAT value, never on the VAT-inclusive total.
   */
  const round = (n: number) => Math.round(n * 100) / 100

  const apply = (patch: Partial<typeof BLANK>) =>
    setForm((f) => {
      const next = { ...f, ...patch }
      const ex = num(next.amount_ex_vat)

      if (ex !== null && patch.amount_ex_vat !== undefined) {
        next.vat_amount = String(round(ex * vatRate))
      }
      if (ex !== null && (patch.amount_ex_vat !== undefined || patch.vat_amount !== undefined)) {
        next.invoice_amount = String(round(ex + (num(next.vat_amount) || 0)))
      }
      // A chosen rate always drives the deduction; typing the amount by hand
      // clears the rate, because then no rate produced it.
      if (ex !== null && next.wht_rate !== '') {
        next.wht_deduction = String(round(ex * (Number(next.wht_rate) / 100)))
      }

      const invoice = num(next.invoice_amount)
      if (invoice !== null) next.amount = String(round(invoice - (num(next.wht_deduction) || 0)))
      return next
    })

  // A cargo cost with no cargo named lands nowhere, and the server refuses it
  // — so the button is held rather than letting the request fail on send.
  const ready =
    form.category_id && Number(form.amount) > 0 && (form.type !== 'pfi' || form.pfi_id)

  const submit = async () => {
    // A vendor picked from the list already carries an id; a freshly-typed
    // one is saved first (if asked to) so this request can link to it too.
    let vendorId = form.vendor_id ? Number(form.vendor_id) : null
    if (!vendorId && form.vendor.trim() && saveNewVendor) {
      try {
        const savedVendor = await createVendor.mutateAsync({ name: form.vendor.trim() })
        vendorId = savedVendor?.id ? Number(savedVendor.id) : null
      } catch {
        // The vendor failed to save — the request still goes through under
        // the typed name; nothing here should block raising it.
      }
    }

    const saved = await save.mutateAsync({
      id: expense?.id,
      data: {
        expense_date: form.expense_date,
        category_id: Number(form.category_id),
        pfi_id: form.type === 'pfi' && form.pfi_id ? Number(form.pfi_id) : null,
        vendor: form.vendor,
        vendor_id: vendorId,
        description: form.description,
        amount: Number(form.amount),
        amount_ex_vat: includeTax ? num(form.amount_ex_vat) : null,
        vat_amount: includeTax ? num(form.vat_amount) : null,
        invoice_amount: includeTax ? num(form.invoice_amount) : null,
        wht_deduction: includeTax ? (num(form.wht_deduction) ?? 0) : 0,
        wht_rate: includeTax ? num(form.wht_rate) : null,
        payee_bank_name: form.payee_bank_name,
        payee_account_number: form.payee_account_number,
        payee_account_name: form.payee_account_name,
      },
    })

    // Files chosen before the request existed are registered against it now.
    // A failure here is reported but does not un-raise the request — the
    // paperwork can be re-attached, a lost request cannot be un-lost.
    const newId = saved?.data?.expense?.id ?? expense?.id
    if (pendingFiles.length > 0 && newId) {
      await attach.mutateAsync({ id: Number(newId), files: pendingFiles }).catch(() => {})
      setPendingFiles([])
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {expense ? 'Edit this request' : 'Request a payment'}
          </DialogTitle>
          <DialogDescription>
            Four short steps. Once submitted it goes to the Expenditure Officer, then
            the CFO, then final approval — you can follow it on My Requests.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="1. What is the money for?" />

          <div className="space-y-1.5 sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setType('general')}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors duration-250 ease-luxe outline-none',
                  form.type === 'general'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-foreground/15 hover:bg-muted/60',
                )}
              >
                <Building2 className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">General expense</span>
                  <span className="block text-xs opacity-80">
                    Running the company — salaries, rent, repairs, bank charges.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setType('pfi')}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors duration-250 ease-luxe outline-none',
                  form.type === 'pfi'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-foreground/15 hover:bg-muted/60',
                )}
              >
                <Fuel className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">Attached to a PFI</span>
                  <span className="block text-xs opacity-80">
                    A cost that belongs to one cargo and adds to what it cost.
                  </span>
                </span>
              </button>
            </div>
          </div>

          {form.type === 'pfi' && (
            <Field
              wide required
              label="Which cargo is this cost for?"
              hint="The amount will be added to this PFI's total cost."
            >
              <NativeSelect value={form.pfi_id} onChange={(e) => set('pfi_id', e.target.value)}>
                <option value="">Choose the PFI…</option>
                {pfiOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pfiNumber || `PFI ${p.id}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field
            wide required
            label="What kind of cost is it?"
            hint={
              form.type === 'pfi'
                ? 'Pick the closest heading — demurrage, jetty fees, commission, and so on.'
                : 'Pick the closest heading. Use “Other General Expenses” if nothing fits.'
            }
          >
            <NativeSelect value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">Choose a category…</option>
              {/* PFI accounts come back in GL-code order, which keeps each
                  heading's accounts contiguous — so the optgroups are just the
                  runs, not a second lookup that could disagree with the API. */}
              {form.type === 'pfi'
                ? categoryGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.accounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))
                : categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>

          <Field wide label="What is it for, in your own words?" required
            hint="One line an approver can check the invoice against — say what was bought and for where.">
            <Input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. Jetty fees for MT Stellar berthing at Calabar"
            />
          </Field>

          <Section title="2. Who is being paid" />

          <Field label="Vendor" required hint="Who the money goes to. Start typing to reuse a saved one.">
            <VendorField
              value={{ vendor: form.vendor, vendor_id: form.vendor_id, saveNew: saveNewVendor }}
              onChange={(v: VendorFieldValue) => {
                setForm((f) => ({ ...f, vendor: v.vendor, vendor_id: v.vendor_id }))
                setSaveNewVendor(v.saveNew)
              }}
            />
          </Field>
          <Field label="Date of the expense" hint="When the cost was incurred, not today's date.">
            <Input type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)} />
          </Field>

          <Field wide label="Vendor's account name"
            hint="Exactly as it appears at the bank — a mismatch is what makes a transfer bounce.">
            <Input
              value={form.payee_account_name}
              onChange={(e) => set('payee_account_name', e.target.value)}
              placeholder="e.g. Keonamex Marine Services Ltd"
            />
          </Field>
          <Field label="Account number">
            <Input
              value={form.payee_account_number}
              inputMode="numeric"
              onChange={(e) => set('payee_account_number', e.target.value)}
              placeholder="0123456789"
            />
          </Field>
          <Field label="Bank">
            <Input
              value={form.payee_bank_name}
              onChange={(e) => set('payee_bank_name', e.target.value)}
              placeholder="e.g. Zenith Bank"
            />
          </Field>

          <Section title="3. How much" />

          <Field
            wide required
            label="Amount to be paid"
            hint={
              includeTax
                ? 'Invoice amount less WHT. What actually leaves the bank is recorded by the Expenditure Officer at the end.'
                : 'The figure you want released. Add the invoice breakdown below if this has VAT or WHT on it.'
            }
          >
            <NumberInput
              allowDecimal placeholder="0.00" value={form.amount}
              onValueChange={(v) => set('amount', v)}
            />
          </Field>

          {/* Invoice/VAT/WHT: real accounting detail most requesters do not
              have to hand at the moment of asking, so it stays folded away. */}
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-dashed border-foreground/20 p-3 hover:bg-muted/40">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={includeTax}
                onChange={(e) => setIncludeTax(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold">
                  This invoice has VAT or withholding tax
                </span>
                <span className="block text-xs text-muted-foreground">
                  Optional. Tick it and the VAT and WHT are worked out for you.
                </span>
              </span>
            </label>
          </div>

          {includeTax && (
            <>
              <Field label="Amount before VAT" hint="What the invoice says before tax is added.">
                <NumberInput
                  allowDecimal placeholder="0.00" value={form.amount_ex_vat}
                  onValueChange={(v) => apply({ amount_ex_vat: v })}
                />
              </Field>
              <Field label={`VAT (${(vatRate * 100).toFixed(1)}%)`} hint="Filled in for you — overwrite if the invoice differs.">
                <NumberInput
                  allowDecimal placeholder="0.00" value={form.vat_amount}
                  onValueChange={(v) => apply({ vat_amount: v })}
                />
              </Field>
              <Field wide label="Invoice total" hint="Before VAT plus the VAT — the face value of the invoice.">
                <NumberInput
                  allowDecimal placeholder="0.00" value={form.invoice_amount}
                  onValueChange={(v) => apply({ invoice_amount: v })}
                />
              </Field>

              {/* Rate first, amount second. Which rate an invoice attracts is
                  Finance's call, so the options are bare percentages — this app
                  does not guess the transaction type on their behalf. */}
              <Field label="Withholding tax rate" hint="Taken on the amount before VAT.">
                <NativeSelect
                  value={form.wht_rate}
                  onChange={(e) => apply({ wht_rate: e.target.value })}
                >
                  <option value="">I'll type the amount myself</option>
                  {whtRates.map((r) => (
                    <option key={r} value={String(r)}>{r === 0 ? 'No WHT (0%)' : `${r}%`}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="WHT to deduct" hint="Held back from the vendor and remitted separately.">
                <NumberInput
                  allowDecimal placeholder="0.00" value={form.wht_deduction}
                  onValueChange={(v) => apply({ wht_deduction: v, wht_rate: '' })}
                />
              </Field>
            </>
          )}

          <Section title="4. Proof" hint="An approver cannot verify a payment against a description alone." />

          <div className="sm:col-span-2">
            {/* On an existing request files register straight away; on a new one
                they wait for the id that submitting creates. */}
            {expense ? (
              <ExpenseAttachments expenseId={expense.id} dropZone />
            ) : (
              <PendingAttachments files={pendingFiles} onChange={setPendingFiles} />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {expense ? 'Save and resubmit' : 'Submit request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
