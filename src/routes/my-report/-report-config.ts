/**
 * The five daily reports, as data.
 *
 * Upstream these were five hand-written panels with their own copies of the
 * same form, table and PDF code. They differ only in which fields show, what
 * those fields are called, and which columns the history lists — so they are
 * described here and rendered by one component.
 *
 * Field keys are the API's own column names. Nothing is packed into remarks
 * and nothing is tagged onto the submitter's name: `reportType` is a real
 * column, so filtering happens in SQL.
 *
 * Almost every field is seeded from data the system already has — a PFI's
 * remaining balance, its depot's bank account, the day's own orders, the
 * trucks that passed the gate — rather than typed from scratch. `derived`
 * fields go one step further and are worked out from the other answers on the
 * same sheet (see derivedFor below).
 *
 * Nothing is read-only. A suggestion is a starting point, not a verdict: the
 * paper sheet is the record, and where the day disagrees with what the system
 * knows, the filer's number wins and the box keeps it. `derived` boxes used to
 * be locked, which is how a compliance report that nobody could correct went
 * out reading 0 litres at ₦0.
 *
 * See -report-autofill.ts for where the suggestions come from and
 * -report-panel.tsx for how one lands in a field.
 */

export type ReportType =
  | 'sales_manager'
  | 'product_manager'
  | 'security_gate'
  | 'commissions'
  | 'it_compliance'

/** Manager review workflow: submitted -> approved | rejected. */
export type DailyReportStatus = 'submitted' | 'approved' | 'rejected'

/** Shared with the Reports Hub, so a status reads the same colour everywhere. */
export const STATUS_TONE: Record<DailyReportStatus, 'accent' | 'warning' | 'destructive'> = {
  submitted: 'warning',
  approved: 'accent',
  rejected: 'destructive',
}

export type FieldDef = {
  key: string
  label: string
  type?: 'number' | 'text' | 'money' | 'textarea' | 'priceBands' | 'topCustomers'
  /** Half width on desktop unless this is set. */
  full?: boolean
  hint?: string
  /**
   * Worked out from the other answers on this sheet, and kept in step with
   * them as they change — until somebody types their own figure in, which is
   * then left alone. See derivedFor().
   */
  derived?: boolean
  /**
   * Carries the product's unit (Litres, kg — whatever the batch's product
   * says). Only true for volumes: truck, order and customer counts are
   * numbers too, and suffixing those with "Litres" would be nonsense.
   */
  unit?: boolean
}

export type ReportDef = {
  type: ReportType
  title: string
  description: string
  /**
   * Short, always-distinct label for group headers and export banners.
   * `title` isn't enough on its own — sales_manager and product_manager both
   * read "Daily sales report".
   */
  roleLabel: string
  /** Hex, for the Reports Hub's per-role Excel banners. */
  color: string
  /** Grouped so a long form reads as sections rather than one wall. */
  sections: Array<{ label: string; fields: FieldDef[] }>
  columns: Array<{ key: string; label: string; align?: 'right'; money?: boolean; unit?: boolean }>
  pdfTitle: string
  filePrefix: string
  /** Compliance's paper form has no location/PFI line — everyone else's does. */
  requireLocation?: boolean
}

/** Every field across a report's sections, in form order — the Reports Hub's
 * table and export columns come from this rather than a second field list. */
export const allFields = (def: ReportDef): FieldDef[] => def.sections.flatMap((s) => s.fields)

const REMARKS: FieldDef = { key: 'remarks', label: 'Remarks', type: 'textarea', full: true }

export const REPORTS: Record<ReportType, ReportDef> = {
  security_gate: {
    type: 'security_gate',
    title: 'Gate report',
    description: 'Trucks through the gate today.',
    roleLabel: 'Security Gate',
    color: '9A3412',
    sections: [
      {
        label: 'Gate figures',
        fields: [
          {
            key: 'trucksEntered', label: 'Trucks entered today', type: 'number',
            hint: 'Suggested from gate records for this location — adjust if it missed one.',
          },
          {
            key: 'truckCount', label: 'Trucks exited today', type: 'number',
            hint: 'Suggested from gate records for this location — adjust if it missed one.',
          },
        ],
      },
      { label: 'Notes', fields: [REMARKS] },
    ],
    columns: [
      { key: 'trucksEntered', label: 'Entered', align: 'right' },
      { key: 'truckCount', label: 'Exited', align: 'right' },
    ],
    pdfTitle: 'Daily gate report',
    filePrefix: 'GateReport',
  },

  commissions: {
    type: 'commissions',
    title: 'Commission report',
    description: 'Funds received, volume sold, and what commission that leaves due and outstanding.',
    roleLabel: 'Commissions',
    color: '064E3B',
    sections: [
      {
        label: 'Sales',
        fields: [
          {
            key: 'fundsReceived', label: 'Funds received', type: 'money',
            hint: 'Suggested from today’s deposits matched to this PFI.',
          },
          {
            key: 'litresSold', label: 'Total litres sold', type: 'number', unit: true,
            hint: 'Suggested from today’s orders.',
          },
          { key: 'truckCount', label: 'Trucks sold', type: 'number', hint: 'Suggested from today’s truck records.' },
          // Real columns. These used to be regexed out of the remarks text,
          // so editing your own note silently destroyed them.
          { key: 'customerCount', label: 'Customers', type: 'number', hint: 'Suggested from today’s orders.' },
          { key: 'orderCount', label: 'Orders', type: 'number', hint: 'Suggested from today’s orders.' },
        ],
      },
      {
        label: 'Commission',
        fields: [
          { key: 'commissionDue', label: 'Commission due', type: 'money' },
          { key: 'amountPaid', label: 'Total commission paid', type: 'money' },
          // Both start as the subtraction, both stay editable: what is still
          // owed can carry an earlier period's arrears, which today's two
          // figures cannot see.
          {
            key: 'commissionOutstanding', label: 'Total commission not paid', type: 'money', derived: true,
            hint: 'Commission due less what was paid — type over it if the day says otherwise.',
          },
          {
            key: 'fundsRemaining', label: 'Funds remaining', type: 'money', derived: true,
            hint: 'Funds received less what was paid — type over it if the day says otherwise.',
          },
          REMARKS,
        ],
      },
    ],
    columns: [
      { key: 'fundsReceived', label: 'Funds received', align: 'right', money: true },
      { key: 'litresSold', label: 'Total ltrs sold', align: 'right', unit: true },
      { key: 'commissionDue', label: 'Commission due', align: 'right', money: true },
      { key: 'amountPaid', label: 'Commission paid', align: 'right', money: true },
      { key: 'commissionOutstanding', label: 'Commission not paid', align: 'right', money: true },
      { key: 'fundsRemaining', label: 'Funds remaining', align: 'right', money: true },
    ],
    pdfTitle: 'Daily commission report',
    filePrefix: 'CommissionReport',
  },

  it_compliance: {
    type: 'it_compliance',
    title: 'Compliance report',
    description: 'Orders, volume, the price for the day, and the top customers.',
    roleLabel: 'IT Compliance',
    color: '1E293B',
    requireLocation: false,
    sections: [
      {
        label: 'Today',
        fields: [
          { key: 'orderCount', label: 'Number of orders', type: 'number', hint: 'Suggested from today’s orders.' },
        ],
      },
      {
        // A day sells at several prices here just as it does on the sales
        // manager's sheet — one weighted average could not show which
        // volume went out at which price, so it is the same band table.
        label: "Today's price(s)",
        fields: [{ key: 'priceBands', label: "Today's price(s)", type: 'priceBands', full: true }],
      },
      {
        label: 'Volume & value',
        fields: [
          {
            key: 'litresSold', label: 'Total litres ordered', type: 'number', derived: true, unit: true,
            hint: 'Added up from the price rows — type over it if the day says otherwise.',
          },
          {
            key: 'totalSalesAmount', label: 'Total value today', type: 'money', derived: true,
            hint: 'Price × litres across the rows above — type over it if the day says otherwise.',
          },
          {
            key: 'avgPrice', label: 'Average price for the day', type: 'money', derived: true,
            hint: 'Weighted by volume, not a plain average of the prices — type over it if the day says otherwise.',
          },
        ],
      },
      {
        label: 'Top 5 customers of the day',
        fields: [{ key: 'topCustomers', label: 'Top 5 customers', type: 'topCustomers', full: true }],
      },
      { label: 'Notes', fields: [REMARKS] },
    ],
    columns: [
      { key: 'orderCount', label: 'Orders', align: 'right' },
      { key: 'litresSold', label: 'Litres', align: 'right', unit: true },
      { key: 'totalSalesAmount', label: 'Value', align: 'right', money: true },
      { key: 'avgPrice', label: 'Avg price', align: 'right', money: true },
    ],
    pdfTitle: 'IT compliance report',
    filePrefix: 'ComplianceReport',
  },

  sales_manager: {
    type: 'sales_manager',
    title: 'Daily sales report',
    description: 'What sold today, at what price, and what was banked.',
    roleLabel: 'Sales Manager',
    color: '1E3A8A',
    sections: [
      {
        label: 'Opening',
        fields: [
          {
            key: 'openingStock', label: 'Product opening balance', type: 'number', unit: true,
            hint: 'Suggested from this PFI’s remaining balance.',
          },
        ],
      },
      {
        label: "Today's price(s)",
        fields: [{ key: 'priceBands', label: "Today's price(s)", type: 'priceBands', full: true }],
      },
      {
        label: 'Sales figures',
        fields: [
          {
            key: 'litresSold', label: 'Litres sold today', type: 'number', derived: true, unit: true,
            hint: 'Added up from the price rows — type over it if the day says otherwise.',
          },
          {
            key: 'totalSalesAmount', label: 'Total sales amount today', type: 'money', derived: true,
            hint: 'Price × litres across the rows above — type over it if the day says otherwise.',
          },
          {
            key: 'truckCount', label: 'No. of trucks sold', type: 'number',
            hint: 'Suggested from the trucks loaded against this PFI today.',
          },
        ],
      },
      {
        label: 'Payments',
        fields: [
          { key: 'amountPaid', label: 'Actual amount paid', type: 'money', hint: 'Suggested from today’s matched deposits, if any.' },
          { key: 'totalInflow', label: 'Total inflow', type: 'money', hint: 'Suggested from all deposits matched to this PFI so far.' },
          {
            key: 'differentials', label: 'Differentials', type: 'money', derived: true,
            hint: 'Amount paid less today’s total — type over it if the day says otherwise.',
          },
        ],
      },
      {
        label: "Yesterday's settlement",
        fields: [
          {
            key: 'yesterdayDeficitPayment', label: 'Yesterday deficit payment', type: 'money',
            hint: 'Suggested from yesterday’s shortfall on this PFI, if there was one.',
          },
          {
            key: 'yesterdaySurplusPayment', label: 'Yesterday surplus payment', type: 'money',
            hint: 'Suggested from yesterday’s excess on this PFI, if there was one.',
          },
        ],
      },
      {
        label: 'Banking',
        fields: [
          { key: 'bankName', label: 'Bank', hint: 'Suggested from this PFI’s depot.' },
          { key: 'accountNumber', label: 'Account number' },
          REMARKS,
        ],
      },
    ],
    columns: [
      { key: 'litresSold', label: 'Qty sold', align: 'right', unit: true },
      { key: 'totalSalesAmount', label: 'Total', align: 'right', money: true },
    ],
    pdfTitle: 'Daily sales report',
    filePrefix: 'DailySalesReport',
  },

  product_manager: {
    type: 'product_manager',
    title: "Daily product manager's report",
    description: 'Product moved at your location today.',
    roleLabel: 'Location Manager',
    color: '581C87',
    sections: [
      {
        label: 'Opening',
        fields: [
          {
            key: 'openingStock', label: 'Product brought forward (opening) litres', type: 'number', unit: true,
            hint: 'Suggested from this PFI’s remaining balance.',
          },
        ],
      },
      {
        label: 'Today',
        fields: [
          {
            key: 'truckCount', label: 'No. of trucks loaded today', type: 'number',
            hint: 'Suggested from the trucks loaded against this PFI today.',
          },
          {
            key: 'receivedStock', label: 'Total ordered product today', type: 'number', unit: true,
            hint: 'Suggested from every order placed against this PFI today.',
          },
          {
            key: 'litresSold', label: 'Litres loaded today', type: 'number', unit: true,
            // Ordered and loaded are different questions, and the field above
            // already answers the first one. Suggesting the same total for
            // both made the pair meaningless.
            hint: 'Suggested from today’s orders that reached loading.',
          },
        ],
      },
      {
        label: 'Balances',
        fields: [
          { key: 'differentials', label: 'Differentials', type: 'money' },
          // Product standing in trucks, not ordered-minus-loaded — the filed
          // figures show the two are unrelated, so this one is only ever typed.
          { key: 'loadingLeftOver', label: 'Loading left over', type: 'number', unit: true },
          {
            key: 'tankBalance', label: 'Tank balance', type: 'number', derived: true, unit: true,
            hint: 'Opening + ordered − loaded — type over it if the dip says otherwise.',
          },
        ],
      },
      { label: 'Notes', fields: [REMARKS] },
    ],
    columns: [
      { key: 'litresSold', label: 'Litres loaded', align: 'right', unit: true },
      { key: 'tankBalance', label: 'Tank balance', align: 'right', unit: true },
    ],
    pdfTitle: "Daily product manager's report",
    filePrefix: 'ProductManagerReport',
  },
}

/** Which report each role files. Mirrors the upstream role → panel mapping. */
export const ROLE_REPORT: Record<number, ReportType> = {
  9: 'sales_manager',
  10: 'product_manager',
  5: 'security_gate',
  15: 'commissions',
  16: 'commissions',
  18: 'it_compliance',
}

/** Super admin files on behalf of any role, so it gets the full set. */
export const ALL_TYPES: ReportType[] = [
  'sales_manager',
  'product_manager',
  'security_gate',
  'commissions',
  'it_compliance',
]

/**
 * The location a report filed for no particular PFI is filed under.
 *
 * Compliance reports on the whole company, not on one batch, so its PFI and
 * location lines are optional on the form. The column is NOT NULL and the API
 * requires it, though, so "no location" has to be a real answer rather than an
 * omitted field — which is what it was, and it took the whole submission down
 * with a validation error the page showed as a bare "Validation failed".
 */
export const COMPANY_WIDE = 'Company-wide'

const n = (v: unknown) => {
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : 0
}
/** Blank and zero are different answers on a sheet filled in over a day. */
const filled = (v: unknown) => v !== '' && v !== null && v !== undefined

export type PriceBand = { price: unknown; litres: unknown }

/** A price table's volume, value and volume-weighted price. */
export function bandTotals(bands: unknown) {
  const rows = (Array.isArray(bands) ? bands : []).filter(
    (b: PriceBand) => b && (filled(b.price) || filled(b.litres)),
  ) as PriceBand[]
  const litres = rows.reduce((s, b) => s + n(b.litres), 0)
  const value = rows.reduce((s, b) => s + n(b.litres) * n(b.price), 0)
  return { count: rows.length, litres, value, avg: litres > 0 ? value / litres : 0 }
}

/**
 * Every figure a report works out for itself, from the rest of its own answers.
 *
 * One implementation, read three ways: the form fills its derived boxes from
 * it while you type, the history table and PDF fall back to it for a figure
 * filed before it had a column of its own, and the Reports Hub does the same.
 * They cannot disagree about what a report says because there is only one
 * place that says it.
 *
 * `src` is the form's values or a saved row — same field keys either way.
 * A blank result means "nothing to work this out from yet", never zero: a
 * hard 0 in an empty box reads as a real figure, and on the compliance sheet
 * it filed a day of trading as ₦0.
 */
export function derivedFor(type: ReportType, src: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const bands = bandTotals(src.priceBands)

  // Both sheets sell a day at several prices, so both take their volume and
  // value from the price table rather than having them typed twice.
  if (type === 'sales_manager' || type === 'it_compliance') {
    out.litresSold = bands.count ? String(bands.litres) : ''
    out.totalSalesAmount = bands.count ? String(bands.value) : ''
  }
  if (type === 'it_compliance') {
    // Weighted by volume, not a plain mean of the prices — a 100-litre band
    // and a 40,000-litre one do not weigh the same on the day.
    out.avgPrice = bands.count && bands.litres > 0 ? String(bands.avg) : ''
  }
  if (type === 'sales_manager') {
    out.differentials = filled(src.amountPaid)
      ? String(n(src.amountPaid) - n(src.totalSalesAmount))
      : ''
  }
  if (type === 'product_manager') {
    out.tankBalance =
      filled(src.openingStock) || filled(src.receivedStock) || filled(src.litresSold)
        ? String(n(src.openingStock) + n(src.receivedStock) - n(src.litresSold))
        : ''
  }
  if (type === 'commissions') {
    // Blank until the figure they are measured against is entered — an
    // outstanding of "0" against an unfilled Commission due reads as settled
    // when nothing is known yet.
    out.commissionOutstanding = filled(src.commissionDue)
      ? String(n(src.commissionDue) - n(src.amountPaid))
      : ''
    out.fundsRemaining = filled(src.fundsReceived)
      ? String(n(src.fundsReceived) - n(src.amountPaid))
      : ''
  }
  return out
}

/**
 * What a saved report says a field is.
 *
 * What was filed, where that was filed. Older rows predate the columns behind
 * the commission report's two outstanding figures, and those rows still have
 * everything needed to work them out — so they are, rather than printing a
 * dash where a number belongs.
 */
export function reportValue(row: Record<string, unknown>, key: string): unknown {
  const stored = row[key]
  if (filled(stored)) return stored
  const type = row.reportType as ReportType
  if (!type || !REPORTS[type]) return stored
  const derived = derivedFor(type, row)[key]
  return derived === undefined || derived === '' ? stored : derived
}
