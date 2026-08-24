import { jsPDF } from 'jspdf'
import { PDF, triggerDownload } from '#/lib/report-theme'

/**
 * A single-page A4 invoice, set in Satoshi.
 *
 * Laid out by hand rather than through autotable: an invoice is a fixed
 * document with one small line-item table, and autotable's flow model fights
 * that — it wants to own vertical position, which is exactly what a footer
 * pinned to the bottom of page one cannot allow.
 *
 * ── One page, always ──────────────────────────────────────────────────────
 *
 * Everything here is sized so a worst-case order still fits: long customer
 * and company names wrap to two lines and are then clipped, the notes block
 * is bounded, and the footer is drawn from the bottom edge upward rather than
 * after the content. An invoice that silently became two pages — with the
 * total stranded on the second — is the failure this shape rules out.
 *
 * ── Money is "NGN", not "₦" ───────────────────────────────────────────────
 *
 * Satoshi has no naira glyph. Not a subsetting casualty: U+20A6 is absent
 * from the face. Printing one would put an empty box beside every figure on a
 * financial document, so amounts are set in the ISO 4217 form, which is
 * standard on invoices regardless. See lib/satoshi-pdf-font.ts.
 */

/**
 * The issuer block.
 *
 * Address, RC and TIN are intentionally blank rather than filled with
 * plausible-looking values. This document goes to customers, and an invented
 * registration number on one is worse than an absent one — every field left
 * empty here simply does not render. Fill them in and they appear.
 */
export const ISSUER = {
  name: 'Soroman',
  tagline: 'Petroleum Products & Distribution',
  address: '',
  cityLine: '',
  phone: '',
  email: '',
  rcNumber: '',
  tin: '',
} as const

export interface InvoiceOrder {
  orderNumber?: string | null
  reference?: string | null
  createdAt?: string | null
  status?: string | null
  paymentStatus?: string | null
  customerName?: string | null
  customerCompanyName?: string | null
  companyName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  depotName?: string | null
  depotAddress?: string | null
  state?: string | null
  pfiNumber?: string | null
  productName?: string | null
  productUnit?: string | null
  quantity?: string | number | null
  price?: string | number | null
  totalAmount?: string | number | null
  deliveryType?: string | null
  expiresAt?: string | null
}

export interface InvoicePayment {
  bankName?: string | null
  accountNumber?: string | null
  accountName?: string | null
}

/** Money, always to the kobo, always with the currency named. */
const money = (v: unknown) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 'NGN 0.00'
  return `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const qty = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-NG') : '0'
}

const longDate = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-NG', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * The logo, as a data URL.
 *
 * Fetched at run time from /logo.png rather than bundled: it is already
 * served, and inlining 20 KB of base64 into the app for a document most
 * sessions never generate is not worth it. A failure here is not fatal — the
 * invoice simply sets the name as text, which is why this resolves to null
 * rather than throwing.
 */
async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo.png')
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * The amount written out, as invoices in Nigeria conventionally carry it.
 *
 * Sixty million reads as a wall of zeros, and a transposed digit in one is
 * invisible; the words are what a person actually checks the figure against.
 * Kobo are only spelled out when there are any — "and 00 kobo" on every whole
 * amount is noise.
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function underThousand(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` and ${underThousand(n % 100)}` : ''}`
}

export function amountInWords(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return ''
  const naira = Math.floor(n)
  const kobo = Math.round((n - naira) * 100)

  let words: string
  if (naira === 0) {
    words = 'Zero'
  } else {
    const scales = [
      [1_000_000_000, 'Billion'],
      [1_000_000, 'Million'],
      [1_000, 'Thousand'],
    ] as const
    let rest = naira
    const parts: string[] = []
    for (const [size, name] of scales) {
      if (rest >= size) {
        parts.push(`${underThousand(Math.floor(rest / size))} ${name}`)
        rest %= size
      }
    }
    if (rest) parts.push(underThousand(rest))
    words = parts.join(' ')
  }

  return `${words} Naira${kobo ? ` and ${underThousand(kobo)} Kobo` : ''} Only`
}

/** A4 in mm, and the margins everything else is measured from. */
const PAGE = { w: 210, h: 297, margin: 16 }
const RIGHT = PAGE.w - PAGE.margin
const CONTENT_W = PAGE.w - PAGE.margin * 2

/**
 * Builds the document and hands it back, rather than saving it.
 *
 * Split from the download so the layout can be rendered and inspected outside
 * a browser — and so anything that wants the invoice for another purpose
 * (attaching it to the confirmation email, showing a preview) does not have
 * to go through a file save to get it.
 */
export async function buildOrderInvoice(order: InvoiceOrder, payment?: InvoicePayment | null) {
  // Dynamic, so 80 KB of embedded font stays out of the main bundle and is
  // only fetched by someone who actually asks for an invoice.
  const { SATOSHI_REGULAR_B64, SATOSHI_BOLD_B64 } = await import('#/lib/satoshi-pdf-font')

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('Satoshi-Regular.ttf', SATOSHI_REGULAR_B64)
  doc.addFont('Satoshi-Regular.ttf', 'Satoshi', 'normal')
  doc.addFileToVFS('Satoshi-Bold.ttf', SATOSHI_BOLD_B64)
  doc.addFont('Satoshi-Bold.ttf', 'Satoshi', 'bold')

  const ink = PDF.ink
  const soft = PDF.inkSoft
  const brand = PDF.brandGreen

  const setText = (size: number, weight: 'normal' | 'bold' = 'normal', color = ink) => {
    doc.setFont('Satoshi', weight)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
  }
  /** A label in the small, wide, muted style used above every value. */
  const label = (text: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    setText(6.6, 'bold', soft)
    doc.text(text.toUpperCase(), x, y, { align })
  }
  const value = (text: string, x: number, y: number, weight: 'normal' | 'bold' = 'normal', size = 9.5, align: 'left' | 'right' = 'left') => {
    setText(size, weight, ink)
    doc.text(text || '—', x, y, { align })
  }
  /**
   * Wrap to a width, measured in the font it will actually be drawn in.
   *
   * jsPDF's splitTextToSize measures using whatever font is CURRENTLY set, not
   * the one you are about to draw with. Calling it after a 6.6pt label and
   * then rendering at 9.5pt produced a customer name that "fitted" on one line
   * and ran straight through the column beside it. Setting the font here makes
   * that mistake unavailable.
   */
  const wrap = (text: string, width: number, size: number, weight: 'normal' | 'bold' = 'normal'): string[] => {
    setText(size, weight, ink)
    return doc.splitTextToSize(text || '', width) as string[]
  }

  // ── Header band ─────────────────────────────────────────────────────────
  doc.setFillColor(brand[0], brand[1], brand[2])
  doc.rect(0, 0, PAGE.w, 34, 'F')

  const logo = await loadLogo()
  let nameX = PAGE.margin

  if (logo) {
    try {
      // On a white tile. The mark is solid brand green on transparency, so
      // placed straight onto the green band it would be very nearly invisible.
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(PAGE.margin, 7.5, 19, 19, 2.2, 2.2, 'F')
      doc.addImage(logo, 'PNG', PAGE.margin + 3, 10.5, 13, 13)
      nameX = PAGE.margin + 24
    } catch { /* fall through to text-only */ }
  }

  // The mark carries no wordmark of its own, so the name is still set — just
  // no longer as the thing standing in for a logo.
  doc.setFont('Satoshi', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(ISSUER.name.toUpperCase(), nameX, 16.5)
  doc.setFont('Satoshi', 'normal')
  doc.setFontSize(7.4)
  doc.setTextColor(226, 240, 235)
  doc.text(ISSUER.tagline, nameX, 22)

  doc.setFont('Satoshi', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(255, 255, 255)
  doc.text('INVOICE', RIGHT, 17, { align: 'right' })
  doc.setFont('Satoshi', 'normal')
  doc.setFontSize(8.4)
  doc.setTextColor(226, 240, 235)
  doc.text(order.reference || order.orderNumber || '', RIGHT, 22.8, { align: 'right' })

  // ── Watermark ───────────────────────────────────────────────────────────
  //
  // Drawn here, before any content: jsPDF paints in call order and has no
  // z-index, so "behind everything" means "first". Kept faint enough to stay
  // out of the way of the figures — a watermark that competes with the total
  // is worse than none — and wrapped in save/restoreGraphicsState so the
  // opacity cannot leak into the text that follows.
  if (logo) {
    try {
      const size = 110
      doc.saveGraphicsState()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc.setGState(new (doc as any).GState({ opacity: 0.045 }))
      doc.addImage(logo, 'PNG', (PAGE.w - size) / 2, (PAGE.h - size) / 2, size, size)
      doc.restoreGraphicsState()
    } catch { /* a watermark is decoration; never fail the invoice for it */ }
  }

  // ── Meta strip ──────────────────────────────────────────────────────────
  let y = 44
  const metaCols = [
    { k: 'Invoice no.', v: order.reference || order.orderNumber || '—' },
    { k: 'Date issued', v: longDate(order.createdAt) },
    { k: 'Payment status', v: order.paymentStatus || '—' },
    { k: 'Order status', v: order.status || '—' },
  ]
  const colW = CONTENT_W / metaCols.length
  metaCols.forEach((c, i) => {
    const x = PAGE.margin + i * colW
    label(c.k, x, y)
    value(String(c.v), x, y + 5, 'bold')
  })

  y += 12
  doc.setDrawColor(226, 232, 237)
  doc.setLineWidth(0.3)
  doc.line(PAGE.margin, y, RIGHT, y)

  // ── Billed to / Supply details ──────────────────────────────────────────
  y += 8
  const halfW = CONTENT_W / 2 - 4
  const rightX = PAGE.margin + CONTENT_W / 2 + 4

  label('Billed to', PAGE.margin, y)
  label('Supply details', rightX, y)
  y += 5.5

  const company = order.companyName || order.customerCompanyName || ''
  // A long trading name wraps to two lines and is then clipped: it must not
  // push the table down the page, and the customer knows their own name.
  const nameLines = wrap(order.customerName || '—', halfW, 9.5, 'bold').slice(0, 2)
  const depotLines = wrap(order.depotName || order.state || '—', halfW, 9.5, 'bold').slice(0, 2)

  // No PFI number: it is an internal allocation reference, and it means
  // nothing to the customer holding the invoice.
  const location = [order.state, order.depotAddress].filter(Boolean).join(' · ')

  const billRest = [
    ...(company ? wrap(company, halfW, 8.6).slice(0, 1) : []),
    order.customerPhone || '',
    order.customerEmail || '',
  ].filter(Boolean)
  const supplyRest = [
    location,
    order.deliveryType ? `${order.deliveryType[0].toUpperCase()}${order.deliveryType.slice(1)}` : '',
  ].filter(Boolean)

  setText(9.5, 'bold', ink)
  nameLines.forEach((l, i) => doc.text(l, PAGE.margin, y + i * 4.8))
  depotLines.forEach((l, i) => doc.text(l, rightX, y + i * 4.8))

  const restTop = y + Math.max(nameLines.length, depotLines.length) * 4.8 + 0.6
  setText(8.6, 'normal', soft)
  billRest.forEach((l, i) => doc.text(l, PAGE.margin, restTop + i * 4.4))
  supplyRest.forEach((l, i) => doc.text(l, rightX, restTop + i * 4.4))

  y = restTop + Math.max(billRest.length, supplyRest.length) * 4.4 + 7

  // ── Line items ──────────────────────────────────────────────────────────
  // Column x-positions: description left, the three figures right-aligned so
  // their digits line up under one another.
  const cQty = PAGE.margin + 96
  const cRate = PAGE.margin + 133
  const cAmt = RIGHT

  doc.setFillColor(243, 246, 248)
  doc.rect(PAGE.margin, y, CONTENT_W, 8, 'F')
  label('Description', PAGE.margin + 3, y + 5.2)
  label('Quantity', cQty, y + 5.2, 'right')
  label('Unit price', cRate, y + 5.2, 'right')
  label('Amount', cAmt - 3, y + 5.2, 'right')
  y += 8

  const unit = order.productUnit || 'Liters'
  const rowY = y + 7
  value(order.productName || 'Product', PAGE.margin + 3, rowY, 'bold', 10)
  setText(7.6, 'normal', soft)
  doc.text(`${qty(order.quantity)} ${unit} @ ${money(order.price)} per ${unit.replace(/s$/, '')}`, PAGE.margin + 3, rowY + 4.6)
  value(`${qty(order.quantity)} ${unit}`, cQty, rowY, 'normal', 9.5, 'right')
  value(money(order.price), cRate, rowY, 'normal', 9.5, 'right')
  value(money(order.totalAmount), cAmt - 3, rowY, 'bold', 9.5, 'right')

  y = rowY + 10
  doc.setDrawColor(226, 232, 237)
  doc.line(PAGE.margin, y, RIGHT, y)

  // ── Total ───────────────────────────────────────────────────────────────
  y += 5
  const totalW = 84
  const totalX = RIGHT - totalW
  doc.setFillColor(brand[0], brand[1], brand[2])
  doc.rect(totalX, y, totalW, 16, 'F')
  doc.setFont('Satoshi', 'bold')
  doc.setFontSize(6.8)
  doc.setTextColor(206, 231, 221)
  doc.text('TOTAL DUE', totalX + 5, y + 6)
  doc.setFontSize(13)
  doc.setTextColor(255, 255, 255)
  doc.text(money(order.totalAmount), RIGHT - 5, y + 12.4, { align: 'right' })

  // In the empty half of the total's own row, which is otherwise dead space.
  label('Amount in words', PAGE.margin, y + 6)
  wrap(amountInWords(order.totalAmount), totalX - PAGE.margin - 8, 8.2).slice(0, 3)
    .forEach((line, i) => {
      setText(8.2, 'normal', ink)
      doc.text(line, PAGE.margin, y + 11.5 + i * 4.2)
    })

  y += 24

  // ── Payment instructions ────────────────────────────────────────────────
  if (payment?.accountNumber) {
    doc.setFillColor(248, 250, 251)
    doc.setDrawColor(226, 232, 237)
    doc.roundedRect(PAGE.margin, y, CONTENT_W, 26, 1.5, 1.5, 'FD')
    label('Payment details', PAGE.margin + 5, y + 7)
    const payCols = [
      { k: 'Bank', v: payment.bankName || '—' },
      { k: 'Account number', v: payment.accountNumber },
      { k: 'Account name', v: payment.accountName || order.customerName || '—' },
    ]
    const payW = (CONTENT_W - 10) / payCols.length
    payCols.forEach((c, i) => {
      const x = PAGE.margin + 5 + i * payW
      label(c.k, x, y + 14.5)
      // Two lines, because an account name is the field most likely to be long
      // and is the one nobody can afford to read half of.
      wrap(String(c.v), payW - 4, 9.5, 'bold').slice(0, 2)
        .forEach((line, li) => doc.text(line, x, y + 20 + li * 4.4))
    })
    y += 32
  }

  // ── Terms ───────────────────────────────────────────────────────────────
  //
  // Anchored above the footer rather than after the content: on a one-line
  // order the block above ends around the middle of the page, and terms
  // floating in that gap read as an afterthought rather than as the closing
  // section of the document.
  const termsTop = PAGE.h - 56
  if (y < termsTop) {
    label('Terms', PAGE.margin, termsTop)
    setText(7.6, 'normal', soft)
    const terms = [
      'Payment is due on presentation of this invoice. Product is released against confirmed payment only.',
      'Quantities are as allocated at the depot named above; any variation is reconciled on the delivery ticket.',
      'Please quote the invoice number on every transfer so the payment can be matched to this order.',
    ]
    terms.forEach((t, i) => doc.text(t, PAGE.margin, termsTop + 6 + i * 4.2))
  }

  // ── Footer, drawn from the bottom edge up ───────────────────────────────
  //
  // Positioned against the page bottom rather than after the content, so it
  // sits in the same place whatever the order above it contained — and so a
  // long invoice can never push it onto a second page.
  const footTop = PAGE.h - 26
  doc.setDrawColor(226, 232, 237)
  doc.line(PAGE.margin, footTop, RIGHT, footTop)

  const issuerBits = [
    ISSUER.address,
    ISSUER.cityLine,
    ISSUER.phone,
    ISSUER.email,
    ISSUER.rcNumber ? `RC ${ISSUER.rcNumber}` : '',
    ISSUER.tin ? `TIN ${ISSUER.tin}` : '',
  ].filter(Boolean)

  // Just the issuer. The "computer generated" disclaimer and a second
  // generation date — the meta strip already carries the date issued — read as
  // system output rather than as a document from a company.
  setText(7.2, 'normal', soft)
  doc.text(
    issuerBits.length ? issuerBits.join('   ·   ') : `${ISSUER.name} — ${ISSUER.tagline}`,
    PAGE.margin,
    footTop + 6.5,
  )
  setText(7.2, 'bold', soft)
  doc.text(order.reference || order.orderNumber || '', RIGHT, footTop + 6.5, { align: 'right' })

  return doc
}

/** The filename an invoice saves under — reference-stamped, never "download.pdf". */
export const invoiceFilename = (order: InvoiceOrder) =>
  `Soroman-Invoice-${(order.reference || order.orderNumber || 'order').replace(/[^A-Za-z0-9-]/g, '')}.pdf`

export async function downloadOrderInvoice(order: InvoiceOrder, payment?: InvoicePayment | null) {
  const doc = await buildOrderInvoice(order, payment)
  triggerDownload(doc.output('blob'), invoiceFilename(order))
}
