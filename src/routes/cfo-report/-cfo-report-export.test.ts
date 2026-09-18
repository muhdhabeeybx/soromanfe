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
      batches: [], duplicatesExcluded: 213824000, duplicateRows: 18,
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
    expect(all).toContain('No batches trading on this date.')

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

    // A corrected cell keeps the system's own figure in its note.
    const noted = cells.filter((c) => c.note)
    expect(noted.length).toBeGreaterThan(0)
    expect(JSON.stringify(noted[0].note)).toContain('28,441,100,000')

    // Money is a number with a naira format, so the column can be summed.
    const { NGN } = await import('#/lib/report-theme')
    expect(cells.some((c) => c.numFmt === NGN && c.value === 28425100000)).toBe(true)
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
