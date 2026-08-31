const currencyFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-NG')

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

/**
 * Money in a currency that is not necessarily naira.
 *
 * `formatCurrency` above is hard-wired to NGN, which is right for the ledger —
 * everything the business bills and banks is in naira. The SMS wallet is not:
 * Termii reports its own balance and its own currency, and printing a dollar
 * figure with a ₦ in front of it would misstate what a broadcast cost.
 *
 * Two decimals at most, none when the amount is whole, because a wallet moves
 * in kobo but a round figure should not be padded to look like it did not.
 */
export function formatMoneyIn(amount: number, currency = 'NGN'): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatNumber(amount: number): string {
  return numberFormatter.format(amount)
}

export function formatLitres(amount: number): string {
  return numberFormatter.format(amount) + ' L'
}

export function formatPercent(value: number, decimals = 0): string {
  return value.toFixed(decimals) + '%'
}

export function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(dateStr).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
}

export function getPeriodDates(period: string): { dateFrom: string; dateTo: string; label: string } {
  const now = new Date()
  let from: Date
  let label: string

  switch (period) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      label = 'Today'
      break
    case 'week':
      from = new Date(now)
      from.setDate(from.getDate() - 7)
      label = 'This Week'
      break
    case 'year':
      from = new Date(now.getFullYear(), 0, 1)
      label = 'This Year'
      break
    case 'month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      label = 'This Month'
      break
  }

  return {
    dateFrom: from.toISOString(),
    dateTo: now.toISOString(),
    label,
  }
}
