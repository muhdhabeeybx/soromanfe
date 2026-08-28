/**
 * How the truck ledger is arranged, and what it adds up to.
 *
 * One module, read by the screen and by both exports, because a report that
 * groups or totals differently from the page it was run from is worse than no
 * report at all.
 *
 * ── Why per truck, then per date ──────────────────────────────────────────
 *
 * A flat date-ordered list answers "what happened on Tuesday", which nobody
 * asks of a fleet. The question this ledger exists for is "what is this truck
 * costing me", and that cannot be read off a list where one vehicle's entries
 * are scattered between everyone else's. Grouping by truck puts a vehicle's
 * whole story in one block; ordering by date inside the block is what makes a
 * running balance possible, and a running balance is the thing that shows the
 * month a truck turned from earning to bleeding.
 *
 * Trucks run in plate order. A ledger is a document people look things up in —
 * you arrive knowing which plate you want — and an order that shuffles every
 * time an entry is added makes that impossible. Which truck is losing money is
 * a real question, but it is one the summary answers by naming it outright
 * (see highlights below), not one worth paying for by making the list
 * unlookupable.
 *
 * Numeric-aware, so ABC-9 comes before ABC-10 rather than after it.
 */

import { parseISO } from 'date-fns'
import type { LedgerEntry } from '#/lib/hooks/useFleet'

export const isExpense = (e: LedgerEntry) => e.entry_type === 'expense'
export const amountOf = (e: LedgerEntry) => Number(e.amount || 0)

export function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  try {
    const d = parseISO(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

const timeOf = (e: LedgerEntry) => safeDate(e.entry_date)?.getTime() ?? 0

/** Oldest first, ties broken by id — the order a ledger is read in, and the
 * only order in which a running balance means anything. */
export const byDate = (a: LedgerEntry, b: LedgerEntry) => timeOf(a) - timeOf(b) || a.id - b.id

export interface LedgerTotals {
  entries: number
  trucks: number
  debits: number
  credits: number
  /** Credits − debits: positive means the truck earned more than it cost. */
  balance: number
}

export function computeTotals(entries: LedgerEntry[]): LedgerTotals {
  const trucks = new Set<number>()
  let debits = 0
  let credits = 0
  for (const e of entries) {
    trucks.add(e.truck_id)
    if (isExpense(e)) debits += amountOf(e)
    else credits += amountOf(e)
  }
  return { entries: entries.length, trucks: trucks.size, debits, credits, balance: credits - debits }
}

/** One entry, with the truck's balance as it stood after it. */
export type LedgerRow = LedgerEntry & { runningBalance: number }

export interface TruckGroup {
  truckId: number
  plate: string
  driver: string
  rows: LedgerRow[]
  entries: number
  debits: number
  credits: number
  balance: number
  /** The span the truck's own entries cover, not the filter's. */
  firstDate: Date | null
  lastDate: Date | null
}

export function groupByTruck(entries: LedgerEntry[]): TruckGroup[] {
  const map = new Map<number, LedgerEntry[]>()
  for (const e of entries) {
    const list = map.get(e.truck_id)
    if (list) list.push(e)
    else map.set(e.truck_id, [e])
  }

  const groups: TruckGroup[] = []
  for (const [truckId, list] of map) {
    const sorted = [...list].sort(byDate)
    let debits = 0
    let credits = 0
    const rows: LedgerRow[] = sorted.map((e) => {
      if (isExpense(e)) debits += amountOf(e)
      else credits += amountOf(e)
      return { ...e, runningBalance: credits - debits }
    })
    groups.push({
      truckId,
      plate: sorted[0]?.truck_plate || '—',
      driver: sorted[0]?.truck_driver || '—',
      rows,
      entries: rows.length,
      debits,
      credits,
      balance: credits - debits,
      firstDate: safeDate(sorted[0]?.entry_date),
      lastDate: safeDate(sorted[sorted.length - 1]?.entry_date),
    })
  }

  return groups.sort(byPlate)
}

/** Plate order, reading digits as numbers so ABC-9 precedes ABC-10. */
export const byPlate = (a: { plate: string }, b: { plate: string }) =>
  a.plate.localeCompare(b.plate, undefined, { numeric: true, sensitivity: 'base' })

export interface CategoryLine {
  category: string
  type: 'expense' | 'income'
  entries: number
  amount: number
  /** Share of its own side of the ledger, 0–1. */
  share: number
}

/**
 * Where the money went, biggest first.
 *
 * Split by side rather than netted: "Tyres ₦2m" and "Delivery ₦2m" are not
 * one line of ₦0, and a category that is both (Other, on both lists) would
 * otherwise disappear entirely.
 */
export function summariseByCategory(entries: LedgerEntry[]): CategoryLine[] {
  const map = new Map<string, CategoryLine>()
  let expenseTotal = 0
  let incomeTotal = 0

  for (const e of entries) {
    const type = isExpense(e) ? 'expense' : 'income'
    const key = `${type}:${e.category}`
    const line = map.get(key) ?? {
      category: e.category || '—', type, entries: 0, amount: 0, share: 0,
    }
    line.entries += 1
    line.amount += amountOf(e)
    map.set(key, line)
    if (type === 'expense') expenseTotal += amountOf(e)
    else incomeTotal += amountOf(e)
  }

  return [...map.values()]
    .map((l) => ({
      ...l,
      share: l.type === 'expense'
        ? (expenseTotal ? l.amount / expenseTotal : 0)
        : (incomeTotal ? l.amount / incomeTotal : 0),
    }))
    .sort((a, b) => b.amount - a.amount)
}

/**
 * The two lines worth putting on a card: the truck bleeding the most, and the
 * single category the most money left through.
 *
 * Both are the answer to "so what do I do about it", which a pile of totals
 * never is on its own.
 */
export function highlights(entries: LedgerEntry[]) {
  const groups = groupByTruck(entries)
  const categories = summariseByCategory(entries)

  // Picked by balance, not by position: the list itself runs in plate order,
  // so reaching for its first or last entry would name whichever truck sorts
  // earliest rather than the one actually losing money.
  let worstTruck: TruckGroup | null = null
  let bestTruck: TruckGroup | null = null
  for (const g of groups) {
    if (g.balance < 0 && (!worstTruck || g.balance < worstTruck.balance)) worstTruck = g
    if (g.balance > 0 && (!bestTruck || g.balance > bestTruck.balance)) bestTruck = g
  }

  const topExpense = categories.find((c) => c.type === 'expense') ?? null
  return { groups, categories, worstTruck, bestTruck, topExpense }
}
