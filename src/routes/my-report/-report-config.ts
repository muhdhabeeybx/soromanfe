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
 * Several fields are seeded from data the system already has — a PFI's
 * remaining balance, its depot's bank account, the day's own orders — rather
 * than typed from scratch. `computed` fields go further: they are never
 * hand-edited at all, only ever the sum of the price bands or truck records
 * behind them. See -report-autofill.ts for where the numbers come from and
 * -report-panel.tsx for how a field gets suggested.
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
  /** Read-only, derived from the price bands or truck records — never typed. */
  computed?: boolean
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
  columns: Array<{ key: string; label: string; align?: 'right'; money?: boolean }>
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
          { key: 'fundsReceived', label: 'Funds received', type: 'money' },
          { key: 'litresSold', label: 'Total litres sold', type: 'number' },
          { key: 'truckCount', label: 'Trucks sold', type: 'number' },
          // Real columns. These used to be regexed out of the remarks text,
          // so editing your own note silently destroyed them.
          { key: 'customerCount', label: 'Customers', type: 'number' },
          { key: 'orderCount', label: 'Orders', type: 'number' },
        ],
      },
      {
        label: 'Commission',
        fields: [
          { key: 'commissionDue', label: 'Commission due', type: 'money' },
          { key: 'amountPaid', label: 'Total commission paid', type: 'money' },
          // Both derived, never typed: a stored total drifts the moment one
          // of its inputs is corrected. See derivedFor() below.
          { key: 'commissionOutstanding', label: 'Total commission not paid', type: 'money', computed: true },
          { key: 'fundsRemaining', label: 'Funds remaining', type: 'money', computed: true },
          REMARKS,
        ],
      },
    ],
    columns: [
      { key: 'fundsReceived', label: 'Funds received', align: 'right', money: true },
      { key: 'litresSold', label: 'Total ltrs sold', align: 'right' },
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
          { key: 'litresSold', label: 'Total litres ordered', type: 'number', hint: 'Suggested from today’s orders.' },
          { key: 'avgPrice', label: 'Price for the day (₦)', type: 'money', hint: 'Weighted average of today’s order prices.' },
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
      { key: 'litresSold', label: 'Litres', align: 'right' },
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
            key: 'openingStock', label: 'Product opening balance', type: 'number',
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
          { key: 'litresSold', label: 'Litres sold today', type: 'number', computed: true },
          { key: 'totalSalesAmount', label: 'Total sales amount today', type: 'money', computed: true },
          { key: 'truckCount', label: 'No. of trucks sold', type: 'number' },
        ],
      },
      {
        label: 'Payments',
        fields: [
          { key: 'amountPaid', label: 'Actual amount paid', type: 'money', hint: 'Suggested from today’s matched deposits, if any.' },
          { key: 'totalInflow', label: 'Total inflow', type: 'money', hint: 'Suggested from all deposits matched to this PFI so far.' },
          { key: 'differentials', label: 'Differentials', type: 'money', computed: true },
        ],
      },
      {
        label: "Yesterday's settlement",
        fields: [
          { key: 'yesterdayDeficitPayment', label: 'Yesterday deficit payment', type: 'money' },
          { key: 'yesterdaySurplusPayment', label: 'Yesterday surplus payment', type: 'money' },
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
      { key: 'litresSold', label: 'Qty sold', align: 'right' },
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
            key: 'openingStock', label: 'Product brought forward (opening) litres', type: 'number',
            hint: 'Suggested from this PFI’s remaining balance.',
          },
        ],
      },
      {
        label: 'Today',
        fields: [
          { key: 'truckCount', label: 'No. of trucks loaded today', type: 'number' },
          { key: 'receivedStock', label: 'Total ordered product today', type: 'number' },
          {
            key: 'litresSold', label: 'Litres loaded today', type: 'number',
            hint: 'Suggested from today’s orders against this PFI.',
          },
        ],
      },
      {
        label: 'Balances',
        fields: [
          { key: 'differentials', label: 'Differentials', type: 'money' },
          { key: 'loadingLeftOver', label: 'Loading left over', type: 'number' },
          { key: 'tankBalance', label: 'Tank balance', type: 'number', computed: true },
        ],
      },
      { label: 'Notes', fields: [REMARKS] },
    ],
    columns: [
      { key: 'litresSold', label: 'Litres loaded', align: 'right' },
      { key: 'tankBalance', label: 'Tank balance', align: 'right' },
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
