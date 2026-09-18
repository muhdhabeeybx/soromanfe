import { describe, expect, test, vi } from 'vitest'
import type { CfoReport, CfoRow } from '#/lib/hooks/useCfoReport'

const downloads: Array<{ blob: Blob; name: string }> = []

vi.mock('#/lib/report-theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/lib/report-theme')>()
  return { ...actual, triggerDownload: (blob: Blob, name: string) => { downloads.push({ blob, name }) } }
})

const row = (over: Partial<CfoRow> = {}): CfoRow => ({
  pfiId: 1, pfiNumber: 'PFI/41/26/MT ZONDA/CALABAR', locationName: 'Soroman Depot Calabar',
  productName: 'Petrol', productUnit: 'Litres', status: 'active', pfiType: 'coastal',
  date: '2026-09-17',
  initialQty: 23213083, cumulativeVolume: 22534950, dayVolume: 936000,
  salesValue: 28425100000, bankInflow: 28441100000,
  stockBalance: 678133, surplusDeficit: 16000000,
  orders: 120, dayOrders: 6,
  computed: {
    initialQty: 23213083, cumulativeVolume: 22534950, dayVolume: 936000,
    salesValue: 28425100000, bankInflow: 28441100000, statementInflow: 27000000000,
    // 1.44bn of wallet-era money with no statement line, and net transfers in.
    legacyInflow: 1441100000, transferIn: 100000000, transferOut: -100000000,
    stockBalance: 678133, surplusDeficit: 16000000,
  },
  edited: [], remarks: '', updatedBy: null, updatedByName: null, updatedAt: null,
  ...over,
})

const report = (): CfoReport => {
  const plain = row()
  const lpg = row({
    pfiId: 2, pfiNumber: 'PFI/45/26/DANGOTE/LPG', productName: 'Cooking Gas', productUnit: 'kg',
    initialQty: 160000, cumulativeVolume: 159060, dayVolume: 0, stockBalance: 940,
    salesValue: 151100000, bankInflow: 38500000, surplusDeficit: -112600000,
    computed: { ...plain.computed, initialQty: 160000, cumulativeVolume: 159060, dayVolume: 0, stockBalance: 940, salesValue: 151100000, bankInflow: 38500000, statementInflow: 38500000, surplusDeficit: -112600000 },
  })
  const corrected = row({
    pfiId: 3, pfiNumber: 'PFI/46/26/MT BORA/WARRI',
    bankInflow: 0, surplusDeficit: -28425100000,
    edited: ['bankInflow'], remarks: 'Bank confirmation pending', updatedByName: 'A Adeyemi',
    updatedAt: '2026-09-17T10:00:00Z',
  })

  const totals = {
    rows: 3, salesValue: 57001300000, bankInflow: 28479600000, surplusDeficit: -28521700000,
    orders: 360, dayOrders: 12,
    byUnit: {
      Litres: { unit: 'Litres', initialQty: 46426166, cumulativeVolume: 45069900, dayVolume: 1872000, stockBalance: 1356266 },
      kg: { unit: 'kg', initialQty: 160000, cumulativeVolume: 159060, dayVolume: 0, stockBalance: 940 },
    },
    periodByUnit: { Litres: 1872000, kg: 0 },
  }

  return {
    days: [
      { date: '2026-09-16', rows: [], totals: { ...totals, rows: 0, byUnit: {} } },
      { date: '2026-09-17', rows: [plain, lpg, corrected], totals },
    ],
    totals,
    meta: {
      dateFrom: '2026-09-16', dateTo: '2026-09-17', timezone: 'Africa/Lagos',
      pfis: [], duplicatesExcluded: 213824000, duplicateRows: 18,
      partPaidHeld: 2215462424, partPaidOrders: 17,
    },
  }
}

const filters = { periodLabel: '16 — 17 Sep 2026', locationName: 'All locations', pfiNumber: 'All PFIs', includeAll: false }

describe('CFO report exports', () => {
  test('the workbook writes real numbers, per-row units, and every day', async () => {
    const { exportCfoReportExcel } = await import('./-cfo-report-export')
    downloads.length = 0
    await exportCfoReportExcel(report(), filters)

    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('CFO-REPORT_ALL_2026-09-16_2026-09-17.XLSX')

    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await downloads[0].blob.arrayBuffer())
    const ws = wb.getWorksheet('CFO Report')!
    expect(ws).toBeTruthy()

    const text: string[] = []
    const cells: Array<{ value: unknown; numFmt?: string; note?: unknown }> = []
    ws.eachRow((r) => {
      r.eachCell({ includeEmpty: false }, (c) => {
        if (typeof c.value === 'string') text.push(c.value)
        cells.push({ value: c.value, numFmt: c.numFmt, note: c.note })
      })
    })
    const all = text.join('\n')

    // Both days present, including the one with nothing on it.
    expect(all).toContain('WEDNESDAY, 16 SEPTEMBER 2026')
    expect(all).toContain('THURSDAY, 17 SEPTEMBER 2026')
    expect(all).toContain('No PFIs trading on this date.')

    // The footnotes the report must not go out without.
    expect(all).toContain('part-paid orders')
    expect(all).toContain('migration 0021')
    expect(all).toContain('cannot be typed over')

    // Quantities are numbers with a unit format, not text — and the LPG row
    // carries kg while the fuel rows carry L.
    const litreCells = cells.filter((c) => c.numFmt === '#,##0 "L"')
    const kgCells = cells.filter((c) => c.numFmt === '#,##0 "kg"')
    expect(litreCells.length).toBeGreaterThan(0)
    expect(kgCells.length).toBeGreaterThan(0)
    expect(litreCells.every((c) => typeof c.value === 'number')).toBe(true)
    expect(kgCells.some((c) => c.value === 159060)).toBe(true)

    // A corrected cell keeps the system's own figure in its note...
    const notes = cells.filter((c) => c.note).map((c) => JSON.stringify(c.note))
    expect(notes.some((n) => n.includes('28,441,100,000'))).toBe(true)
    // ...and a generated remark says outright that nobody typed it, so it can
    // never be quoted back as a colleague's judgement.
    expect(notes.some((n) => n.includes('Nobody typed this'))).toBe(true)

    // Money is a number with a naira format, so the column can be summed.
    const { NGN } = await import('#/lib/report-theme')
    expect(cells.some((c) => c.numFmt === NGN && c.value === 28425100000)).toBe(true)

    // The workbook keeps PFI and Location APART — a spreadsheet gets filtered
    // and pivoted one field at a time, and joining them only forces somebody
    // to split the column back out. The screen and the PDF merge them.
    const { CFO_SHEET_COLUMNS, CFO_CORE_COLUMNS } = await import('./-cfo-columns')
    const sheetKeys = CFO_SHEET_COLUMNS.map((c) => c.key)
    expect(sheetKeys).toContain('pfi')
    expect(sheetKeys).toContain('location')
    expect(sheetKeys).not.toContain('pfiLocation')
    const docKeys = CFO_CORE_COLUMNS.map((c) => c.key)
    expect(docKeys).toContain('pfiLocation')
    expect(docKeys).not.toContain('location')

    // Traced-to-bank sits immediately beside the inflow it qualifies — on its
    // own it is a number nobody can act on.
    expect(docKeys.indexOf('bankBacked')).toBe(docKeys.indexOf('bankInflow') + 1)
    expect(docKeys.indexOf('inflowMakeup')).toBe(docKeys.indexOf('bankBacked') + 1)

    // A share is written as a percentage, not as a raw fraction.
    expect(cells.some((c) => c.numFmt === '0%')).toBe(true)
  })

  test('traced-to-bank is the non-legacy share, and cannot exceed 100%', async () => {
    const { bankBackedShare } = await import('#/lib/hooks/useCfoReport')

    // The defect this pins: statementInflow ÷ bankInflow went ABOVE 1 on any
    // PFI that had transferred surplus away — on 18 September PFI 39 held
    // ₦29,388m against ₦29,524m of statement lines, because ₦202m had moved
    // to another order. "100.5% bank-backed" is a ratio of two things that do
    // not divide.
    const transferred = row({
      computed: { ...row().computed, bankInflow: 29388300000, statementInflow: 29524100000, legacyInflow: 100000, transferIn: 0, transferOut: -135900000 },
    })
    const share = bankBackedShare(transferred)!
    expect(share).toBeLessThanOrEqual(1)
    expect(Math.round(share * 100)).toBe(100)

    // Legacy money is the part nothing can evidence, so it is the part that
    // moves this figure.
    const legacy = row({
      computed: { ...row().computed, bankInflow: 33516900000, statementInflow: 30916500000, legacyInflow: 2545900000, transferIn: 54400000, transferOut: 0 },
    })
    expect(Math.round(bankBackedShare(legacy)! * 100)).toBe(92)

    // A corrected inflow has no known composition, so nothing is claimed.
    expect(bankBackedShare(row({ edited: ['bankInflow'] }))).toBeNull()
  })

  test('the stock bar measures what is LEFT, and reddens as it empties', async () => {
    const { stockShare, stockState } = await import('./-cfo-columns')

    // The defect this pins: the bar used to grow as the balance fell, because
    // it was drawn from cumulative sales — sales progress, which is a
    // different fact in the opposite direction.
    const full = row({ initialQty: 1000, cumulativeVolume: 0, stockBalance: 1000 })
    const empty = row({ initialQty: 1000, cumulativeVolume: 1000, stockBalance: 0 })
    expect(stockShare(full)).toBe(1)
    expect(stockShare(empty)).toBe(0)

    expect(stockState(row({ initialQty: 1000, stockBalance: 900 }))).toBe('healthy')
    expect(stockState(row({ initialQty: 1000, stockBalance: 200 }))).toBe('fair')
    expect(stockState(row({ initialQty: 1000, stockBalance: 50 }))).toBe('low')
  })

  test('the untraced money says what it actually is', async () => {
    const { inflowMakeup } = await import('./-cfo-columns')

    expect(
      inflowMakeup(row({ computed: { ...row().computed, legacyInflow: 2545900000, transferIn: 54400000, transferOut: 0 } })),
    ).toBe('₦2.55bn legacy — no bank record · ₦54.4m in from other orders')

    expect(
      inflowMakeup(row({ computed: { ...row().computed, legacyInflow: 0, transferIn: 0, transferOut: -135900000 } })),
    ).toBe('₦135.9m out to other orders')

    expect(
      inflowMakeup(row({ computed: { ...row().computed, legacyInflow: 0, transferIn: 0, transferOut: 0 } })),
    ).toBe('All matched to bank lines')
  })

  test('the PDF renders a real document, every day of it', async () => {
    /**
     * The render is most of the assertion.
     *
     * This path is where a wrong option shape fails at RUNTIME and nowhere
     * else — an autotable `foot` row whose length does not match its head, a
     * didParseCell reaching into a row index that is not there on a day with
     * no rows, a footnote wrapped past the end of the page. The fixture is
     * built to hit all three: an empty day, a mixed-unit totals row, and a
     * corrected cell.
     *
     * Under jsdom, jsPDF's save() writes to disk, so the finished file can be
     * weighed and then cleared away.
     */
    const { existsSync, statSync, unlinkSync } = await import('node:fs')
    const name = 'CFO-REPORT_ALL_2026-09-16_2026-09-17.PDF'
    if (existsSync(name)) unlinkSync(name)

    try {
      const { exportCfoReportPdf } = await import('./-cfo-report-export')
      await exportCfoReportPdf(report(), filters)

      expect(existsSync(name)).toBe(true)
      // A rendered document with three tables and a notes block, not an
      // empty shell — an empty jsPDF is roughly 1kB.
      expect(statSync(name).size).toBeGreaterThan(8000)
    } finally {
      if (existsSync(name)) unlinkSync(name)
    }
  })

  test('money shows kobo only where there is kobo', async () => {
    const { cfoDisplay, CFO_CORE_COLUMNS } = await import('./-cfo-columns')
    const money = CFO_CORE_COLUMNS.find((c) => c.key === 'salesValue')!
    const signed = CFO_CORE_COLUMNS.find((c) => c.key === 'surplusDeficit')!

    // A forced ".00" on three money columns is what pushed the PDF's figures
    // into wrapping mid-number.
    expect(cfoDisplay(money, 32784600000, 'Litres')).toBe('₦32,784,600,000')
    // ...but a real 99 kobo is never rounded away on a reconciliation sheet.
    expect(cfoDisplay(money, 56900000.99, 'Litres')).toBe('₦56,900,000.99')
    // Negatives are parenthesised, not signed with a glyph the PDF lacks.
    expect(cfoDisplay(signed, -112600000, 'Litres')).toBe('(₦112,600,000)')
  })

  test('a row writes its own remark, and a typed one always wins', async () => {
    const { rowRemark } = await import('./-cfo-columns')
    const base = row()

    // Half-sold and square: nothing worth saying beyond the two facts.
    const quiet = rowRemark({ ...base, dayVolume: 0, cumulativeVolume: 11000000, stockBalance: 12213083, surplusDeficit: 0 })
    expect(quiet.auto).toBe(true)
    expect(quiet.text).toBe('No movement. Settled in full.')

    const sold = rowRemark({ ...base, dayVolume: 936000, surplusDeficit: -112600000 })
    expect(sold.auto).toBe(true)
    expect(sold.text).toBe('Sold 936,000 L. ₦112.6m still owed.')

    // Nearly-dry is called out, because that is the unusual state.
    const dry = rowRemark({ ...base, dayVolume: 0, initialQty: 160000, cumulativeVolume: 159060, stockBalance: 940, productUnit: 'kg', surplusDeficit: 20000 })
    expect(dry.text).toContain('Nearly dry — 940 kg left.')

    // A person's words are never merged with a generated sentence.
    const typed = rowRemark({ ...base, remarks: 'Awaiting Dangote credit note.' })
    expect(typed).toEqual({ text: 'Awaiting Dangote credit note.', auto: false })
  })

  test('the PDF is written only in characters its typefaces carry', async () => {
    // Satoshi has neither U+20A6 nor U+2212, and jsPDF's Helvetica has
    // neither either. Both go missing SILENTLY — the naira sign printed as a
    // broken bar and the minus sign as nothing at all, which turned
    // "initial qty − cumulative" into "initial qty cumulative".
    const { nairaCompact, nairaIn, nairaSignedIn } = await import('./-cfo-columns')

    expect(nairaIn('NGN ')(32784600000)).toBe('NGN 32,784,600,000')
    expect(nairaSignedIn('NGN ')(-112600000)).toBe('(NGN 112,600,000)')
    expect(nairaCompact(732300000, 'NGN ')).toBe('NGN 732.3m')

    // The compact form's own minus is ASCII, so a negative never loses its sign.
    expect(nairaCompact(-5000000)).toBe('-₦5.0m')
    expect(nairaCompact(-5000000)).not.toContain('\u2212')
  })

  test('a single-unit day still totals its quantity columns', async () => {
    const { cfoTotalValues } = await import('./-cfo-columns')
    const r = report()
    const litresOnly = {
      ...r.totals,
      byUnit: { Litres: r.totals.byUnit.Litres },
    }
    const { values, unit } = cfoTotalValues(litresOnly, 'Day total')
    expect(unit).toBe('Litres')
    expect(values.stockBalance).toBe(1356266)

    // Mixed units have no sum, and say so rather than printing a wrong number.
    const mixed = cfoTotalValues(r.totals, 'Day total')
    expect(mixed.unit).toBeNull()
    expect(mixed.values.stockBalance).toBeNull()
    expect(mixed.values.salesValue).toBe(57001300000)
  })
})
