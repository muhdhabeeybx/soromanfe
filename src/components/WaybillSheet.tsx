import { format } from 'date-fns'
import { Globe, Phone } from 'lucide-react'

import { depotPhones, truckSuffix } from '#/lib/depot-contacts'

/**
 * One waybill — a full physical page per truck.
 *
 * ── Sized in millimetres, against A4 ───────────────────────────────────────
 *
 * The page box is 210 x 297mm, which is what `@page { size: A4 }` in
 * styles.css actually prints onto. It used to be min-h-[1056px] — US Letter at
 * 96dpi — so every sheet came out 67px short of the foot of the paper, the
 * footer floated above the margin, and the on-screen preview had the wrong
 * shape from the page it claimed to be previewing. Millimetres remove the dpi
 * assumption entirely: 210mm is 210mm whatever the browser thinks a pixel is.
 *
 * Everything else stays in absolute units rather than the design system's
 * tokens: this sheet is measured against paper, not a viewport, and must come
 * out identical whatever the operator's zoom or theme. It is deliberately the
 * one surface in the app that ignores dark mode.
 */

const LABEL = 'text-xs font-normal uppercase text-neutral-500'
const VALUE = 'mt-0.5 text-sm font-semibold text-black'
const HINT = 'text-xs uppercase text-neutral-300'

function Cell({
  label,
  value,
  mono,
}: {
  label: string
  value?: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="border-b border-r border-neutral-300 px-3 py-2 last:border-r-0">
      <p className={LABEL}>{label}</p>
      <p className={`${VALUE} ${mono ? 'font-mono' : ''} min-h-[18px]`}>{value}</p>
    </div>
  )
}

function SignatureLine({ label, hint = true }: { label: string; hint?: boolean }) {
  return (
    <div className="pt-6">
      <div className="border-t border-neutral-400" />
      <p className="mt-1 text-xs font-semibold text-black">{label}</p>
      {hint && <p className={HINT}>Full Name &amp; Signature</p>}
    </div>
  )
}

export function WaybillSheet({ data }: { data: Record<string, any> }) {
  const phones = depotPhones(data.location)

  // Only a multi-truck order gets a letter suffix; a single truck prints bare.
  const reference =
    Number(data.totalTrucks) > 1
      ? `${data.reference} (Truck ${truckSuffix(Number(data.truckNumber))})`
      : data.reference

  const litres = Number(data.litres || 0)
  const productLine = `${data.product || '—'} x ${litres.toLocaleString('en-NG')} ${data.productUnit || 'Litres'}`

  // The formatter yields an empty string rather than a placeholder, so an
  // order with no loading time prints the label above blank space.
  const loadingAt = data.loadingAt
    ? format(new Date(data.loadingAt), 'd MMM yyyy · HH:mm')
    : ''

  return (
    <article className="waybill-sheet relative mx-auto flex h-[297mm] w-[210mm] flex-col overflow-hidden bg-white px-[14mm] py-[12mm] text-black">
      {/* Watermark sits behind everything. */}
      <img
        src="/logo.png"
        alt=""
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 w-[70%] -translate-x-1/2 -translate-y-1/2 opacity-[0.06]"
      />

      <div className="relative flex flex-1 flex-col">
        {/*
          * Header.
          *
          * One lockup, not three floating pieces. The logo, the company and
          * the depot were stacked with the depot drifting below on its own
          * line and the reference adrift at the other margin — three things
          * that belong together reading as three separate ones. Now the mark
          * sits against a rule with the name and depot beside it, and the
          * reference is a bordered field rather than loose text, because that
          * is what it is: the number somebody quotes back.
          */}
        <header className="flex items-stretch justify-between gap-6 border-b-2 border-[#00563c] pb-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" aria-hidden className="size-11 shrink-0" />
            <div className="border-l border-neutral-300 pl-3">
              <p className="text-[17px] leading-tight font-semibold tracking-tight text-black">
                Soroman Energy
              </p>
              <p className="mt-0.5 text-[13px] leading-tight font-semibold text-[#007a55]">
                {data.location || '—'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end justify-center">
            <p className={LABEL}>Order Reference</p>
            <p className="mt-1 rounded border border-neutral-400 px-2.5 py-1 font-mono text-[15px] leading-none font-bold text-black">
              {reference}
            </p>
          </div>
        </header>

        {/* Banner */}
        <div className="mt-3.5 bg-[#00563c] px-4 py-2 text-center">
          <p className="text-sm font-semibold text-white uppercase">
            Waybill &amp; Payment Receipt
          </p>
        </div>

        {/* Details */}
        <div className="mt-3.5 border-t border-l border-neutral-300">
          <div className="grid grid-cols-2">
            <Cell label="Company's Name" value={data.company} />
            {/* Printed blank — filled in by hand at the depot. */}
            <Cell label="NMDPRA Number" />
            <Cell label="Contact Person" value={data.customerName} />
            <Cell label="Phone Number" value={data.customerPhone} />
            <Cell label="Product" value={productLine} />
            <Cell label="Loading Date &amp; Time" value={loadingAt} />
            <Cell label="Truck Number" value={data.plateNumber} mono />
            <Cell
              label="Truck Driver"
              value={
                data.driverName
                  ? `${data.driverName}${data.driverPhone ? ` - ${data.driverPhone}` : ''}`
                  : ''
              }
            />
          </div>

          {/* Written in by hand on delivery. */}
          <div className="border-r border-b border-neutral-300 px-3 py-2">
            <p className={LABEL}>Delivery Address</p>
            <p className="min-h-[34px]" />
          </div>

          {/* The loader records what actually went into each compartment. */}
          <div className="border-r border-b border-neutral-300 px-3 py-2">
            <p className={LABEL}>Compartment Details</p>
            <table className="mt-1.5 w-full border-collapse">
              <thead>
                <tr>
                  {['S/N', 'Quantity', 'Ullage'].map((h) => (
                    <th
                      key={h}
                      className="border border-neutral-300 px-2 py-1 text-left text-xs font-normal text-neutral-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((n) => (
                  <tr key={n}>
                    <td className="border border-neutral-300 px-2 py-1.5 text-xs font-normal">
                      {n}
                    </td>
                    <td className="border border-neutral-300 px-2 py-1.5" />
                    <td className="border border-neutral-300 px-2 py-1.5" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-6 grid grid-cols-2 gap-x-10">
          <SignatureLine label="Loader's Name" hint={false} />
          <SignatureLine label="Accounts" />
          <SignatureLine label="Commercial Manager" />
          <SignatureLine label="Depot Manager" />
          <SignatureLine label="Dispatch Officer" />
          <SignatureLine label="Security" />
        </div>

        {/* Footer pinned to the foot of the sheet. */}
        <footer className="mt-auto flex items-end justify-between gap-6 pt-8">
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-neutral-700">
              <Globe className="size-3 shrink-0" />
              Visit ordersoroman.com to order fuel online without stress!
            </p>
            <p className="flex items-center gap-1.5 text-xs text-neutral-700">
              <Phone className="size-3 shrink-0" />
              {phones.join('  ·  ')}
            </p>
          </div>
          <p className="max-w-[46%] border-l border-neutral-300 pl-4 text-xs leading-relaxed text-neutral-600">
            This waybill and receipt confirm successful payment and authorization for the
            associated truck transaction. For enquiries or verification, kindly contact
            Soroman Energy.
          </p>
        </footer>
      </div>
    </article>
  )
}
