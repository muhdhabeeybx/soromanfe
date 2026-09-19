import { describe, expect, test } from 'vitest'
import type { AccountStatementLine } from '#/lib/hooks/useBankStatements'

/**
 * The workbook is built for real and read back for real.
 *
 * Every defect this export has had — a column of text that could not be
 * totalled, a date a day out, a filter that was not stated — is invisible to a
 * type check and obvious the moment the file is opened. So the test opens it.
 */
let captured: Blob | null = null

// jsdom has no object URLs. Patching the two methods is also how the workbook
// is captured — the module hands its Blob to createObjectURL on the way to the
// download, so there is no need to intercept Blob itself.
URL.createObjectURL = (blob: Blob) => { captured = blob; return 'blob:x' }
URL.revokeObjectURL = () => {}

const line = (over: Partial<AccountStatementLine> = {}): AccountStatementLine => ({
  id: 1, txn_date: '2026-09-17', amount: '30000000',
  depositor: 'NIP/FDP/CENTIANO OIL AND GAS LTD', narration: 'COB TRF',
  bank_ref: 'S82139372', status: 'MATCHED',
  matched_deposit_id: 9, matched_order_id: 11896, matched_at: '2026-09-17T14:20:00Z',
  deposit_reference: 'S82139372', order_id: 11896, order_reference: 'AO11896',
  customer_name: 'OXX DOWNSREAM', matched_by_name: 'Adetona Saheed',
  statement_id: 3, filename: 'calnn.xlsx', uploaded_at: '2026-09-17T09:02:00Z',
  uploaded_by_name: 'Muideen Salami', imported_at: '2026-09-17T09:02:00Z',
  ...over,
}) as AccountStatementLine

const account = {
  bank_name: 'Zenith Bank',
  account_name: 'Soroman Portharcourt',
  account_number: '1311924900',
}

/** Builds the real workbook, then opens it the way a person would. */
async function build(lines: AccountStatementLine[], opts: Record<string, unknown> = {}) {
  captured = null
  const { exportStatementLines } = await import('./-statement-export')
  await exportStatementLines({ account, lines, ...opts } as never)
  if (!captured) throw new Error('no workbook was produced')
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await (captured as Blob).arrayBuffer())
  return wb.getWorksheet('Statement')!
}

describe('the statement workbook', () => {
  test('carries eleven columns, none of them a duplicate of another', async () => {
    const ws = await build([line()])
    const headers = ws.getRow(8).values as string[]
    expect(headers.slice(1)).toEqual([
      'Date', 'Amount', 'Depositor', 'Bank reference',
      'Status', 'Order', 'Customer', 'Matched by', 'Matched on',
      'Uploaded by', 'Uploaded on',
    ])
    // Deposit reference was the bank reference again; narration and the source
    // file belong to the upload, not the credit.
    expect(headers).not.toContain('Deposit reference')
    expect(headers).not.toContain('Narration')
    expect(headers).not.toContain('Source file')
  })

  test('the amount is a number with a currency format, so it can be totalled', async () => {
    const ws = await build([line({ amount: '30000000' })])
    const cell = ws.getCell('B9')
    expect(typeof cell.value).toBe('number')
    expect(cell.value).toBe(30000000)
    expect(cell.numFmt).toContain('₦')
  })

  test('the total is a real SUM over the rows, not a figure typed once', async () => {
    const ws = await build([
      line({ id: 1, amount: '1000' }),
      line({ id: 2, amount: '2500' }),
    ])
    const total = ws.getCell('B11').value as { formula: string; result: number }
    expect(total.formula).toBe('SUM(B9:B10)')
    expect(total.result).toBe(3500)
  })

  test('the transaction date is the day the bank printed, never a day out', async () => {
    const ws = await build([line({ txn_date: '2026-09-17' })])
    const d = ws.getCell('A9').value as Date
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(17)
  })

  test('a filtered export says so, because one that looks whole and is not is the worst case', async () => {
    const ws = await build([line()], { status: 'UNMATCHED' })
    expect(String(ws.getCell('A6').value)).toContain('not the whole statement')
  })

  test('an unfiltered export makes no such claim', async () => {
    const ws = await build([line()])
    expect(ws.getCell('A6').value ?? '').toBe('')
  })

  test('a matched line whose order is gone says so rather than showing blank', async () => {
    const ws = await build([line({ order_reference: null, order_id: null, status: 'MATCHED' })])
    expect(ws.getCell('F9').value).toBe('Order deleted')
  })

  test('the summary is cells, not one concatenated sentence', async () => {
    const ws = await build([line({ amount: '1000' }), line({ id: 2, amount: '500', status: 'UNMATCHED', matched_at: null })])
    expect(String(ws.getCell('A4').value)).toBe('PAYMENTS')
    expect(ws.getCell('A5').value).toBe(2)
    expect(String(ws.getCell('B4').value)).toBe('TOTAL CREDITED')
    expect(ws.getCell('B5').value).toBe(1500)
    expect(ws.getCell('C5').value).toBe(1000)  // matched
    expect(ws.getCell('D5').value).toBe(500)   // unmatched
  })

  test('the three bands sit above the column headers', async () => {
    const ws = await build([line()])
    expect(String(ws.getCell('A7').value)).toBe('THE CREDIT')
    expect(String(ws.getCell('E7').value)).toBe('MATCHED TO')
    expect(String(ws.getCell('J7').value)).toBe('IMPORTED')
  })
})
