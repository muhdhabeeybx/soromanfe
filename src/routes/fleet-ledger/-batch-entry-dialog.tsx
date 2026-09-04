/**
 * Posting one thing to many trucks.
 *
 * July's salaries, a fleet-wide insurance renewal, a month of parking fees —
 * the same category, date and rough amount landing on eight or twenty
 * vehicles. Done a truck at a time that is twenty passes through a dialog,
 * and the cost is not the typing: it is that the twelfth entry gets worded
 * differently, the seventeenth gets last month's date, and the twentieth
 * never happens at all.
 *
 * ── The truck list is the preview ────────────────────────────────────────
 *
 * There is no separate "confirm" step showing what will be written. Picking a
 * truck expands it to show the exact line it will receive — resolved
 * description, resolved amount — so the thing being approved and the thing
 * being edited are the same object on screen. A preview somewhere else on the
 * page is a second copy of the truth, and second copies drift.
 *
 * ── Why amounts are per truck ────────────────────────────────────────────
 *
 * A default amount fills every line, but each is editable, because the
 * posting this screen exists for — salaries — is precisely the one where the
 * figure differs by driver. Forcing one amount would send the operator back
 * to editing rows one at a time afterwards, which is the work we removed.
 */

import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Search, Layers, AlertTriangle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { CommaInput } from '#/components/ui/comma-input'
import { Checkbox } from '#/components/ui/checkbox'
import { NativeSelect } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { MICRO } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  useBatchLedgerEntries, EXPENSE_CATEGORIES, INCOME_CATEGORIES,
  type BatchLedgerLine,
} from '#/lib/hooks/useFleet'
import { SHORTCODES, applyTemplate, unknownTokens } from './-batch-template'

const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`

interface TruckOption {
  id: number
  plate: string
  driver: string
  make: string
}

export function BatchEntryDialog({
  open, trucks, onOpenChange,
}: {
  open: boolean
  trucks: any[]
  onOpenChange: (o: boolean) => void
}) {
  const save = useBatchLedgerEntries()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [entryDate, setEntryDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [template, setTemplate] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [overrides, setOverrides] = useState<Record<number, string>>({})

  // A batch left half-filled from last time is a posting waiting to go to the
  // wrong trucks, so every open starts blank.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setEntryType('expense'); setCategory(''); setCustomCategory('')
      setEntryDate(today); setAmount(''); setTemplate('')
      setSearch(''); setPicked([]); setOverrides({})
    }
  }

  const options = useMemo<TruckOption[]>(
    () => trucks
      .map((t) => ({
        id: Number(t.id),
        plate: String(t.plateNumber || '—'),
        driver: String(t.driverName || ''),
        make: String(t.truckMake || ''),
      }))
      .sort((a, b) => a.plate.localeCompare(b.plate, undefined, { numeric: true, sensitivity: 'base' })),
    [trucks],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((t) => `${t.plate} ${t.driver} ${t.make}`.toLowerCase().includes(q))
  }, [options, search])

  const chosen = useMemo(() => new Set(picked), [picked])
  const resolvedCategory = category === 'Other' ? customCategory.trim() : category
  const categoryList = entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  // Acts on what is on screen: with a search active, "select all" means all
  // the matches, not the whole fleet hidden behind the filter.
  const allVisibleChosen = visible.length > 0 && visible.every((t) => chosen.has(t.id))
  const toggleAllVisible = () =>
    setPicked((p) => {
      const ids = visible.map((t) => t.id)
      return allVisibleChosen ? p.filter((id) => !ids.includes(id)) : [...new Set([...p, ...ids])]
    })

  /** One resolved line per chosen truck — what the list shows and what is sent. */
  const lines = useMemo(() => {
    const chosenSet = new Set(picked)
    return options
      .filter((t) => chosenSet.has(t.id))
      .map((t) => {
        const value = Number(overrides[t.id] ?? amount) || 0
        return {
          truck: t,
          amount: value,
          description: applyTemplate(template, {
            plate: t.plate, driver: t.driver, make: t.make,
            date: entryDate, category: resolvedCategory, amount: value,
          }),
        }
      })
  }, [options, picked, overrides, amount, template, entryDate, resolvedCategory])

  const total = lines.reduce((sum, l) => sum + l.amount, 0)
  const zeroLines = lines.filter((l) => l.amount <= 0)
  const strays = unknownTokens(template)
  const ready = Boolean(resolvedCategory) && Boolean(entryDate) && lines.length > 0 && zeroLines.length === 0

  // Tokens land where the caret is, not at the end — the point of a chip is
  // to finish a sentence you are part-way through typing.
  const templateRef = useRef<HTMLTextAreaElement>(null)
  const insertToken = (token: string) => {
    const el = templateRef.current
    if (!el) { setTemplate((t) => t + token); return }
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    const next = template.slice(0, start) + token + template.slice(end)
    setTemplate(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const submit = async () => {
    const entries: BatchLedgerLine[] = lines.map((l) => ({
      truckId: l.truck.id,
      entryType,
      category: resolvedCategory,
      amount: l.amount,
      entryDate,
      description: l.description.trim(),
    }))
    await save.mutateAsync({ entries })
    onOpenChange(false)
  }

  const sampleCtx = {
    plate: lines[0]?.truck.plate ?? options[0]?.plate ?? 'ABC-123-XY',
    driver: lines[0]?.truck.driver ?? options[0]?.driver ?? 'Driver',
    make: lines[0]?.truck.make ?? options[0]?.make ?? 'Truck',
    date: entryDate,
    category: resolvedCategory,
    amount: Number(amount) || 0,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-foreground/15 px-6 py-4">
          <DialogTitle>Batch entry</DialogTitle>
          <DialogDescription>
            One posting, many trucks. Each truck gets its own line — edit any amount before posting.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:divide-x md:divide-foreground/15">

            {/* ── The posting ─────────────────────────────────────────── */}
            <div className="space-y-4 px-6 py-5">
              <span className={cn(MICRO, 'block text-muted-foreground')}>The posting</span>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={cn(MICRO, 'block text-muted-foreground')}>Type</label>
                  <NativeSelect
                    value={entryType}
                    onChange={(e) => {
                      setEntryType(e.target.value as 'expense' | 'income')
                      setCategory('')
                    }}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </NativeSelect>
                </div>

                <div className="space-y-1.5">
                  <label className={cn(MICRO, 'block text-muted-foreground')}>Category</label>
                  <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Choose…</option>
                    {categoryList.map((c) => <option key={c} value={c}>{c}</option>)}
                  </NativeSelect>
                </div>

                {category === 'Other' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className={cn(MICRO, 'block text-muted-foreground')}>Name the category</label>
                    <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className={cn(MICRO, 'block text-muted-foreground')}>Date</label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <label className={cn(MICRO, 'block text-muted-foreground')}>Amount each</label>
                  <CommaInput value={amount} onValueChange={setAmount} placeholder="0" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={cn(MICRO, 'block text-muted-foreground')}>Description</label>
                <Textarea
                  ref={templateRef}
                  rows={2}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder="{month} {year} salary — {driver} ({plate})"
                />
              </div>

              {/* Shortcodes: each chip shows what it will actually become for
                  the first truck, so the meaning is never a guess. */}
              <div className="space-y-2">
                <span className={cn(MICRO, 'block text-muted-foreground')}>Insert</span>
                <div className="flex flex-wrap gap-1.5">
                  {SHORTCODES.map((s) => (
                    <button
                      key={s.token}
                      type="button"
                      onClick={() => insertToken(s.token)}
                      title={`${s.token} → ${s.sample(sampleCtx)}`}
                      className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors duration-250 ease-luxe outline-none hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {s.token}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Shortcodes fill in per truck — {'{driver}'} becomes each truck&apos;s own driver.
                </p>
                {strays.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {strays.join(', ')} {strays.length === 1 ? 'is not a shortcode' : 'are not shortcodes'} — it will post as typed.
                  </p>
                )}
              </div>
            </div>

            {/* ── Trucks, which double as the preview ─────────────────── */}
            <div className="flex min-h-0 flex-col">
              <div className="space-y-3 px-6 py-5 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <span className={cn(MICRO, 'text-muted-foreground')}>
                    Trucks · {picked.length} of {options.length}
                  </span>
                  <button
                    type="button"
                    onClick={toggleAllVisible}
                    disabled={visible.length === 0}
                    className="text-xs text-accent transition-opacity duration-250 ease-luxe outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                  >
                    {allVisibleChosen ? 'Clear' : search.trim() ? 'Select matches' : 'Select all'}
                  </button>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by plate or driver…" className="pl-9"
                  />
                </div>
              </div>

              <div className="max-h-[22rem] overflow-y-auto px-6 pb-5">
                {visible.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No trucks match.</p>
                ) : (
                  <ul className="divide-y divide-foreground/10">
                    {visible.map((t) => {
                      const on = chosen.has(t.id)
                      const value = overrides[t.id] ?? amount
                      const line = lines.find((l) => l.truck.id === t.id)
                      return (
                        <li key={t.id} className={cn('py-2', on && 'bg-accent/[0.04]')}>
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={on}
                              onCheckedChange={() => toggle(t.id)}
                              aria-label={`Include ${t.plate}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggle(t.id)}
                              className="min-w-0 flex-1 text-left outline-none"
                            >
                              <span className="block truncate font-mono text-sm font-medium">{t.plate}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {t.driver || 'No driver on file'}
                              </span>
                            </button>
                            {on && (
                              <CommaInput
                                value={value}
                                onValueChange={(v) => setOverrides((o) => ({ ...o, [t.id]: v }))}
                                placeholder="0"
                                aria-label={`Amount for ${t.plate}`}
                                className={cn(
                                  'h-7 w-28 text-right text-sm tabular-nums',
                                  Number(value) > 0 ? '' : 'border-destructive/60',
                                )}
                              />
                            )}
                          </div>
                          {on && line && (
                            <p className="mt-1 truncate pl-7 text-xs text-muted-foreground" title={line.description}>
                              {line.description.trim() || <span className="italic">No description</span>}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="items-center border-t border-foreground/15 bg-muted/40 px-6 py-3 sm:justify-between">
          <span className="text-sm tabular-nums text-muted-foreground">
            {lines.length === 0
              ? 'No trucks selected'
              : zeroLines.length > 0
                ? <span className="text-destructive">
                    {zeroLines.length} line{zeroLines.length === 1 ? '' : 's'} still need an amount
                  </span>
                : <>
                    {lines.length} entr{lines.length === 1 ? 'y' : 'ies'} ·{' '}
                    <span className={cn('font-semibold', entryType === 'expense' ? 'text-destructive' : 'text-accent')}>
                      {naira(total)}
                    </span>
                  </>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!ready || save.isPending}>
              {save.isPending
                ? <Loader2 data-icon="inline-start" className="animate-spin" />
                : <Layers data-icon="inline-start" />}
              Post {lines.length || ''} entr{lines.length === 1 ? 'y' : 'ies'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
