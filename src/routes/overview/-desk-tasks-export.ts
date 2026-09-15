import type { DeskAssignments, DeskWorkItem } from '#/lib/hooks/useDashboard'

/**
 * A person's pending work, as a file they can be handed.
 *
 * The panel names who owes what; this is that list off the screen and into
 * somebody's hands — a WhatsApp attachment to a gate officer, a printout on the
 * ticketing desk, the thing an admin walks into a meeting with.
 *
 * ── Per person, across every desk ──────────────────────────────────────────
 *
 * A person's file covers all their desks, not the one whose row was clicked.
 * Idris Aliyu is on gate-in and gate-out; handing him a sheet for one and
 * silently withholding the other would be worse than handing him nothing,
 * because he would work it and believe he was done.
 *
 * ── Real numbers, with a format ────────────────────────────────────────────
 *
 * Litres and hours go in as numbers with a cell format rather than
 * pre-formatted text, as everywhere else in this app: the first thing anybody
 * does with a list like this is sort it by how long something has been waiting.
 */

const QTY = '#,##0'
const HRS = '#,##0'

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Excel worksheet names: 31 chars, none of `\ / * ? : [ ]`, unique per book. */
function sheetName(raw: string, used: Set<string>) {
  const base = raw.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Sheet'
  let name = base
  let i = 2
  while (used.has(name)) name = `${base.slice(0, 28)}~${i++}`
  used.add(name)
  return name
}

/** A filename that survives being emailed around. */
const slug = (s: string) => s.trim().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'tasks'

const stamp = () => new Date().toISOString().slice(0, 10)

interface TaskRow {
  deskLabel: string
  /** "generate tickets for" — what this person has to do with the row. */
  verb: string
  item: DeskWorkItem
}

/** Every outstanding row belonging to one person, across all three desks. */
function rowsForPerson(staffId: number, desks: DeskAssignments[]): TaskRow[] {
  const out: TaskRow[] = []
  for (const d of desks) {
    if (d.failed) continue
    const mine = d.assignments.find((a) => a.staffId === staffId)
    if (!mine) continue
    for (const item of mine.items) {
      out.push({ deskLabel: d.label, verb: d.verb, item })
    }
  }
  // Longest-waiting first: the list is a work order, and the top of it should be
  // the thing that should have been done first.
  return out.sort((a, b) => b.item.hoursWaiting - a.item.hoursWaiting)
}

const HEADERS = [
  'Desk', 'To do', 'Reference', 'Truck', 'Customer', 'Litres', 'Batch (PFI)', 'Location',
  'Waiting (hours)', 'Waiting',
]

/** "3 days" reads better than "72 hours" on a queue this old. */
const waited = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hour${h === 1 ? '' : 's'}`)

function writeSheet(
  ws: import('exceljs').Worksheet,
  title: string,
  subtitle: string,
  rows: TaskRow[],
) {
  const lastCol = HEADERS.length

  ws.mergeCells(1, 1, 1, lastCol)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { bold: true, size: 13 }

  ws.mergeCells(2, 1, 2, lastCol)
  const m = ws.getCell(2, 1)
  m.value = subtitle
  m.font = { size: 9, color: { argb: 'FF6B7280' } }

  const head = ws.getRow(4)
  head.values = HEADERS
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }

  let cursor = 5
  for (const { deskLabel, verb, item } of rows) {
    const row = ws.getRow(cursor)
    row.values = [
      deskLabel,
      verb,
      item.ref || '',
      item.truckRef || '',
      item.customerName || '',
      item.quantity ?? null,
      item.pfiNumber || '',
      item.depotName || '',
      item.hoursWaiting,
      waited(item.hoursWaiting),
    ]
    row.getCell(6).numFmt = QTY
    row.getCell(9).numFmt = HRS
    cursor++
  }

  if (rows.length === 0) {
    ws.getCell(5, 1).value = 'Nothing outstanding.'
  }

  ws.getColumn(1).width = 18
  ws.getColumn(2).width = 22
  ws.getColumn(3).width = 26
  ws.getColumn(4).width = 16
  ws.getColumn(5).width = 26
  ws.getColumn(6).width = 14
  ws.getColumn(7).width = 34
  ws.getColumn(8).width = 28
  ws.getColumn(9).width = 15
  ws.getColumn(10).width = 14
  ws.views = [{ state: 'frozen', ySplit: 4 }]
}

/** One person's outstanding work, every desk they are on. */
export async function exportPersonTasks(
  staffId: number,
  name: string,
  desks: DeskAssignments[],
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const rows = rowsForPerson(staffId, desks)
  const ws = wb.addWorksheet('Pending tasks')
  writeSheet(
    ws,
    `${name} — pending tasks`,
    `${rows.length} outstanding as at ${new Date().toLocaleString()}`
      + (rows.length ? ` · longest waiting ${waited(rows[0].item.hoursWaiting)}` : ''),
    rows,
  )

  triggerDownload(await wb.xlsx.writeBuffer(), `Soroman_Tasks_${slug(name)}_${stamp()}.xlsx`)
}

/**
 * Everybody's, in one book — a sheet per person, plus the work nobody owns.
 *
 * The unassigned sheet is last and is never folded into a person's: it is a
 * staffing gap, and putting it on somebody's sheet would make them responsible
 * for work nobody gave them.
 */
export async function exportAllDeskTasks(desks: DeskAssignments[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()
  const used = new Set<string>()

  /** Everyone owing anything, with their total across desks. */
  const people = new Map<number, { name: string; count: number }>()
  for (const d of desks) {
    if (d.failed) continue
    for (const a of d.assignments) {
      const seen = people.get(a.staffId)
      people.set(a.staffId, {
        name: a.name,
        count: (seen?.count ?? 0) + a.count,
      })
    }
  }

  const ordered = [...people.entries()].sort((a, b) => b[1].count - a[1].count)

  for (const [staffId, { name }] of ordered) {
    const rows = rowsForPerson(staffId, desks)
    writeSheet(
      wb.addWorksheet(sheetName(name, used)),
      `${name} — pending tasks`,
      `${rows.length} outstanding as at ${new Date().toLocaleString()}`,
      rows,
    )
  }

  const orphans: TaskRow[] = desks.flatMap((d) => (
    d.failed ? [] : d.unassigned.items.map((item) => ({ deskLabel: d.label, verb: d.verb, item }))
  )).sort((a, b) => b.item.hoursWaiting - a.item.hoursWaiting)

  if (orphans.length > 0) {
    writeSheet(
      wb.addWorksheet(sheetName('Nobody assigned', used)),
      'Nobody assigned',
      'Nobody holding the desk’s role is scoped to these locations. Chasing will not clear this'
        + ' — somebody has to be assigned to the depot.',
      orphans,
    )
  }

  // The No batch sheet is switched off at the user's request — nobody is to see
  // that orders exist with no PFI on them, and this workbook is the copy most
  // likely to be passed around. Commented out together with the panel block in
  // overview/index.tsx; the server still reports the figures, so both come back
  // together.
  //
  // It stays out of every PERSON's sheet regardless of this: unworkable rows on
  // somebody's list would ask the impossible and make them look months behind.
  //
  // /**
  // * Orders and trucks with no batch, on their own sheet and never on a
  // * person's.
  // *
  // * They cannot be worked at all — a loading ticket draws against stock and
  // * there is no batch to draw from — so putting them on somebody's list would
  // * ask for the impossible and make them look months behind.
  // */
  // const batchless: TaskRow[] = desks.flatMap((d) => (
  // d.failed ? [] : d.noBatch.items.map((item) => ({ deskLabel: d.label, verb: d.verb, item }))
  // )).sort((a, b) => b.item.hoursWaiting - a.item.hoursWaiting)
  //
  // if (batchless.length > 0) {
  // writeSheet(
  // wb.addWorksheet(sheetName('No batch', used)),
  // 'No batch on the order',
  // 'These carry no PFI, so they cannot be ticketed or gated. Nobody is behind on them —'
  // + ' it is a records problem, not a queue.',
  // batchless,
  // )
  // }

  if (wb.worksheets.length === 0) {
    const ws = wb.addWorksheet('All clear')
    ws.getCell(1, 1).value = 'Every desk is clear.'
  }

  triggerDownload(await wb.xlsx.writeBuffer(), `Soroman_Desk_Tasks_${stamp()}.xlsx`)
}
