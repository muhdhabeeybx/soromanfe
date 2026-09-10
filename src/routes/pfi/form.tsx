import { useState, useEffect, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Loader2, Save, CheckCircle, AlertCircle, FileText, Banknote, Users, Ship,
  Anchor, Fuel, Truck, Calculator, Info,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect } from '#/components/ui/native-select'
import { CommaInput } from '#/components/ui/comma-input'
import { StatusChip } from '#/components/ui/status-chip'
import { Checkbox } from '#/components/ui/checkbox'
import { PageLoader } from '#/components/PageLoader'
import { MICRO, PANEL, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import {
  useCreatePfi, useUpdatePfi, useDepotsForFilter, usePfiDetails,
  usePfiLocations, useSetLocationsForPfi, useAttachDeliveryTrucks,
} from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { useAdminList } from '#/lib/hooks/useAdmin'
import { routeGuard } from '#/lib/route-guard'
import { naira, unitNames, SurplusDeficit } from '#/routes/pfi/-pfi-utils'
import {
  TruckPicker, useFleetPicks, truckSelectionSummary, type TruckSelection,
} from '#/components/delivery-operations/TruckPicker'
import type { PfiType } from '#/lib/types'

export const Route = createFileRoute('/pfi/form')({
  beforeLoad: () => routeGuard('/pfi'),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || '',
  }),
  component: PFIForm,
})

const EMPTY_FORM = {
  id: '',
  pfiType: 'coastal' as PfiType,
  // Most batches are raised to trade. One bought ahead of selling says so.
  notStarted: false,
  pfiDate: '',
  pfiNumber: '',
  description: '',
  locationId: '',
  productId: '',
  productUnit: '',
  startingQtyLitres: '',
  qtyVolumeMt: '',
  blQtyLitres: '',
  blQtyMt: '',
  ticketCount: '',
  unitPrice: '',
  creditBalance: '',
  auditOfficerId: '',
  productOfficerId: '',
  itComplianceOfficerId: '',
  securityExitOfficerId: '',
  commissionOfficerId: '',
  salesManagerId: '',
  vesselBroker: '',
  vesselName: '',
  surveyorName: '',
  surveyorPhone: '',
}

type FormState = typeof EMPTY_FORM

/**
 * Narrowed to the string-valued keys, not `keyof FormState`: the form also
 * carries a boolean now, and a select's `value` cannot take one. Keeping the
 * type honest here is what makes that a compile error rather than a control
 * that renders blank.
 */
type StringKeys = { [K in keyof FormState]: FormState[K] extends string ? K : never }[keyof FormState]

const OFFICER_FIELDS: Array<{ label: string; key: StringKeys }> = [
  { label: 'Audit Officer', key: 'auditOfficerId' },
  { label: 'Product Officer', key: 'productOfficerId' },
  { label: 'IT Compliance Officer', key: 'itComplianceOfficerId' },
  { label: 'Security Exit Officer', key: 'securityExitOfficerId' },
  { label: 'Commission Officer', key: 'commissionOfficerId' },
  { label: 'Sales Manager', key: 'salesManagerId' },
]

/**
 * The three kinds of batch, and what each one is actually asking for.
 *
 * Presented as a choice up front rather than as fields that appear later,
 * because the answer changes what the rest of the form even means: a coastal
 * batch is billed on a BL figure that a gantry batch does not have, a gantry
 * batch is counted in tickets that a coastal one does not issue, and a
 * delivery batch is the only one sold anywhere other than where it sits.
 */
const PFI_TYPES: Array<{
  value: PfiType
  label: string
  hint: string
  icon: React.ReactNode
}> = [
  {
    value: 'coastal',
    label: 'Coastal',
    hint: 'Arrives by vessel. Billed on the BL figure, measured again in the tank.',
    icon: <Anchor />,
  },
  {
    value: 'gantry',
    label: 'Gantry',
    hint: 'Bought at the loading gantry and split into tickets. One quantity, no vessel.',
    icon: <Fuel />,
  },
  {
    value: 'delivery',
    label: 'Delivery',
    hint: 'Loaded onto trucks at one depot and sold at several. Counted in trucks.',
    icon: <Truck />,
  },
]

/** The label for a type wherever one is named in a sentence or a chip. */
const TYPE_LABEL: Record<PfiType, string> = {
  coastal: 'Coastal',
  gantry: 'Gantry',
  delivery: 'Delivery',
}

function formatDateToInput(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toISOString().substring(0, 10)
  } catch {
    return ''
  }
}

/** Field-level messages from a Zod validation failure — `{errors:[{path,message}]}`. */
function getFieldErrors(err: any): Record<string, string> {
  const errors = err?.response?.data?.errors
  if (!Array.isArray(errors)) return {}
  const map: Record<string, string> = {}
  for (const e of errors) {
    if (e?.path && e?.message) map[String(e.path)] = String(e.message)
  }
  return map
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="flex items-start gap-1 text-xs font-medium text-destructive">
      <AlertCircle className="mt-px size-3 shrink-0" />
      {message}
    </p>
  )
}

function Field({
  label, required, hint, error, children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {label}
        {/* A dot, not a bare asterisk pushed against the last letter — it
            reads as punctuation there and disappears next to "PFI No". */}
        {required && (
          <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
        )}
        {required && <span className="sr-only">(required)</span>}
      </Label>
      {children}
      {/* An error replaces its hint rather than stacking under it: two lines
          of small grey-and-red text below one input is where people stop
          reading either. */}
      {error ? <FieldError message={error} /> : hint ? <p className="text-xs leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * An input with a fixed unit written into the field itself.
 *
 * The unit belongs where the number is typed, not only in the label above it:
 * once someone is three fields down a form they are reading the boxes, not
 * the captions, and "₦" beside the cursor is what stops a price being typed
 * into a quantity. Pointer events are off so the adornment never eats a click
 * meant for the input.
 */
function Adorned({
  prefix, suffix, children,
}: {
  prefix?: string
  suffix?: string
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          {prefix}
        </span>
      )}
      <div className={cn(prefix && '[&_input]:pl-7', suffix && '[&_input]:pr-14')}>{children}</div>
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}

function Section({
  icon, title, description, step, aside, children,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  /** Position in the sequence, so a long form reads as a route with an end. */
  step?: number
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={PANEL}>
      <div className={cn(PANEL_RAIL, 'gap-4')}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-muted text-foreground/70 [&_svg]:size-4">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {step != null && (
                <span className={cn(MICRO, 'font-semibold text-muted-foreground/70')}>
                  {String(step).padStart(2, '0')}
                </span>
              )}
              {title}
            </p>
            {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className={cn(PANEL_BODY, 'space-y-5')}>{children}</div>
    </section>
  )
}

/**
 * A figure the form works out rather than asks for.
 *
 * Deliberately not an input. PFI value is quantity × price and sales value is
 * what confirmed-paid orders brought in — both are already known, and a box
 * to type them into is an invitation to record a second answer that disagrees
 * with the first.
 */
function Computed({
  label, value, hint, tone,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: string
}) {
  return (
    <div className="min-w-0">
      <p className={cn(MICRO, 'font-semibold text-muted-foreground')}>{label}</p>
      <p className={cn('mt-1 truncate text-lg font-semibold tracking-tight', tone || 'text-foreground')}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

function PFIForm() {
  const navigate = useNavigate()
  const { id } = Route.useSearch()
  const isEdit = !!id
  const createPfi = useCreatePfi()
  const updatePfi = useUpdatePfi()

  const { data: editingPfi, isLoading: isLoadingPfi } = usePfiDetails(id)

  const { data: statesData } = useDepotsForFilter()
  const { data: productsData } = useProductList()
  const { data: adminsData } = useAdminList()

  const depots = Array.isArray(statesData) ? statesData : ((statesData as any)?.depots || (statesData as any)?.results || [])
  const products = Array.isArray(productsData) ? productsData : ((productsData as any)?.products || (productsData as any)?.results || [])
  const staff = Array.isArray(adminsData) ? adminsData : []

  /**
   * The allowlist lives in its own table, so it is fetched and saved on its
   * own. `usePfiDetails` does not carry it and the create endpoint does not
   * take it — see the note on the submit below.
   */
  const editingPfiId = editingPfi?.id != null ? Number(editingPfi.id) : null
  const { data: allowedLocations } = usePfiLocations(
    isEdit && editingPfi?.pfiType === 'delivery' ? editingPfiId : null,
  )
  const setLocations = useSetLocationsForPfi()
  const attachTrucks = useAttachDeliveryTrucks()

  /**
   * The trucks this batch is loaded onto, picked rather than counted.
   *
   * This field was a typed number — "Number of Trucks: 20" — which recorded
   * the number twenty and identified no trucks: no plates, no drivers, no
   * quantity loaded. So a delivery batch raised here had nothing to put in the
   * inventory register and never appeared on the delivery inventory page or the
   * sales ledger, with nothing on the form to say why. Picking real trucks is
   * the same question asked so that it has a usable answer, and the count is
   * then derived from it rather than typed beside it.
   */
  const fleet = useFleetPicks()
  const [truckSelection, setTruckSelection] = useState<TruckSelection>({})
  const trucks = truckSelectionSummary(truckSelection, fleet)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    if (isEdit && editingPfi) {
      setForm({
        id: String(editingPfi._id || editingPfi.id || ''),
        // Rows written before the distinction existed carry no type, and every
        // one of them is coastal — it was the only kind there was.
        pfiType: editingPfi.pfiType === 'gantry' || editingPfi.pfiType === 'delivery'
          ? editingPfi.pfiType
          : 'coastal',
        // A closed batch is never shown as not-started: closing is the
        // /finish endpoint's business and this form must not undo it.
        notStarted: editingPfi.status === 'not_started',
        pfiDate: formatDateToInput(editingPfi.pfiDate),
        pfiNumber: editingPfi.pfiNumber || '',
        description: editingPfi.description || '',
        locationId: editingPfi.locationId ? String(editingPfi.locationId) : '',
        productId: editingPfi.productId ? String(editingPfi.productId) : '',
        productUnit: editingPfi.productUnit || '',
        startingQtyLitres: editingPfi.startingQtyLitres != null ? String(editingPfi.startingQtyLitres) : '',
        qtyVolumeMt: editingPfi.qtyVolumeMt != null ? String(editingPfi.qtyVolumeMt) : '',
        blQtyLitres: editingPfi.blQtyLitres != null ? String(editingPfi.blQtyLitres) : '',
        blQtyMt: editingPfi.blQtyMt != null ? String(editingPfi.blQtyMt) : '',
        ticketCount: editingPfi.ticketCount != null ? String(editingPfi.ticketCount) : '',
        unitPrice: editingPfi.unitPrice != null ? String(editingPfi.unitPrice) : '',
        creditBalance: editingPfi.creditBalance != null ? String(editingPfi.creditBalance) : '',
        auditOfficerId: editingPfi.auditOfficerId ? String(editingPfi.auditOfficerId) : '',
        productOfficerId: editingPfi.productOfficerId ? String(editingPfi.productOfficerId) : '',
        itComplianceOfficerId: editingPfi.itComplianceOfficerId ? String(editingPfi.itComplianceOfficerId) : '',
        securityExitOfficerId: editingPfi.securityExitOfficerId ? String(editingPfi.securityExitOfficerId) : '',
        commissionOfficerId: editingPfi.commissionOfficerId ? String(editingPfi.commissionOfficerId) : '',
        salesManagerId: editingPfi.salesManagerId ? String(editingPfi.salesManagerId) : '',
        vesselBroker: editingPfi.vesselBroker || '',
        vesselName: editingPfi.vesselName || '',
        surveyorName: editingPfi.surveyorName || '',
        surveyorPhone: editingPfi.surveyorPhone || '',
      })
    }
  }, [isEdit, editingPfi])

  /**
   * Null until something is ticked, then the local copy wins.
   *
   * Deliberately not seeded into state by an effect. Copying server data into
   * state on every fetch means a refetch — a window refocus is enough —
   * silently discards a half-made selection. Falling through to the server's
   * answer while untouched, and holding the edit once made, keeps both.
   */
  const [editedDepots, setEditedDepots] = useState<number[] | null>(null)
  const selectedDepots = editedDepots ?? (allowedLocations ?? []).map((d) => Number(d.id))

  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isGantry = form.pfiType === 'gantry'
  const isDelivery = form.pfiType === 'delivery'
  /**
   * Neither gantry nor delivery is weighed against shipping papers.
   *
   * Both are collected on land — one at a loading gantry, one onto trucks —
   * so the BL figures, the MT weights, the vessel and the surveyor are facts
   * about a cargo that neither of them is. They also share the shape of the
   * cost section: one quantity, a price, and a count of the units it was
   * split into.
   */
  const isCargo = !isGantry && !isDelivery

  /** The picked product's unit, so no label ever says "Litres" over a tonnage. */
  const unit = useMemo(() => unitNames(form.productUnit), [form.productUnit])

  /** Six selects that all read "Unassigned" hide how many are actually set. */
  const assignedOfficers = OFFICER_FIELDS.filter(({ key }) => !!form[key]).length

  // The live preview: appears as soon as either figure is entered, because
  // that's the earliest point a surplus/deficit or a cargo value means
  // anything — waiting for both fields to be complete would hide the number
  // exactly when someone is checking it against the papers as they type.
  //
  // Which quantity the value runs off is the whole difference between the two
  // kinds: coastal is billed for the BL figure whatever landed in the tank,
  // while gantry and delivery are billed for the quantity bought, which is
  // the only one either of them has.
  const preview = useMemo(() => {
    const bl = form.blQtyLitres === '' ? null : Number(form.blQtyLitres)
    const tank = form.startingQtyLitres === '' ? null : Number(form.startingQtyLitres)
    const price = form.unitPrice === '' ? null : Number(form.unitPrice)
    const costQty = isCargo ? bl : tank
    return {
      show: isCargo ? bl != null || tank != null : tank != null || price != null,
      surplusDeficit: isCargo && bl != null && tank != null ? tank - bl : null,
      pfiValue: costQty != null && price != null ? costQty * price : null,
    }
  }, [isCargo, form.blQtyLitres, form.startingQtyLitres, form.unitPrice])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditedDepots(null)
    setTruckSelection({})
    setError('')
    setFieldErrors({})
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setFieldErrors({})

    const nextErrors: Record<string, string> = {}
    if (!form.pfiNumber.trim()) nextErrors.pfiNumber = 'PFI number is required.'
    if (!form.locationId) nextErrors.locationId = 'Location is required.'
    if (!form.productId) nextErrors.productId = 'Product is required.'
    /**
     * A delivery batch is worth what its trucks loaded, so its quantity is
     * not typed and cannot be validated as if it were. What is required
     * instead is a manifest — and on an EDIT, not even that: the trucks
     * already on the batch are not shown here, so an edit that changes only a
     * price must not demand a fresh selection.
     */
    if (isDelivery) {
      if (!isEdit && trucks.problem) nextErrors.trucks = trucks.problem
    } else if (!form.startingQtyLitres || Number(form.startingQtyLitres) <= 0) {
      nextErrors.startingQtyLitres = `Quantity (${unit.plural}) is required and must be greater than 0.`
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setError('Please fix the highlighted fields.')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        pfiType: form.pfiType,
        // Only ever the two live states. A finished batch's status is not
        // this form's to move, so an edit of one leaves it untouched.
        ...(editingPfi?.status === 'finished'
          ? {}
          : { status: form.notStarted ? 'not_started' : 'active' }),
        pfiDate: form.pfiDate || null,
        pfiNumber: form.pfiNumber.trim(),
        description: form.description,
        locationId: form.locationId || null,
        productId: form.productId,
        productUnit: form.productUnit || undefined,
        // Sent as the manifest's sum so a batch is never briefly worth zero;
        // PUT /trucks rebuilds it server-side straight after, which is the
        // figure that stands.
        startingQtyLitres: isDelivery
          ? trucks.loaded
          : Number(form.startingQtyLitres) || 0,
        unitPrice: form.unitPrice === '' ? 0 : Number(form.unitPrice),
        creditBalance: form.creditBalance === '' ? 0 : Number(form.creditBalance),
        // The field sets are mutually exclusive, so each is sent only for the
        // kind it belongs to. The server clears the other side anyway — this
        // just means the request says the same thing the form does.
        //
        // ticketCount carries the gantry ticket count and the delivery truck
        // count. One column because it is one fact — how many units the
        // allocation was split into — and the label follows the type.
        ...(!isCargo
          ? {
              // Counted from the picked trucks on a delivery batch, typed on a
              // gantry one. Same column, and on delivery it can no longer
              // disagree with the manifest beside it.
              ticketCount: isDelivery
                ? (trucks.count || null)
                : form.ticketCount === '' ? null : Number(form.ticketCount),
            }
          : {
              qtyVolumeMt: form.qtyVolumeMt === '' ? null : Number(form.qtyVolumeMt),
              // Blank means unknown, not zero — a false 0 would make every
              // downstream money figure compute against it instead of reading "—".
              blQtyLitres: form.blQtyLitres === '' ? null : Number(form.blQtyLitres),
              blQtyMt: form.blQtyMt === '' ? null : Number(form.blQtyMt),
              vesselBroker: form.vesselBroker || null,
              vesselName: form.vesselName || null,
              surveyorName: form.surveyorName || null,
              surveyorPhone: form.surveyorPhone || null,
            }),
        auditOfficerId: form.auditOfficerId || null,
        productOfficerId: form.productOfficerId || null,
        itComplianceOfficerId: form.itComplianceOfficerId || null,
        securityExitOfficerId: form.securityExitOfficerId || null,
        commissionOfficerId: form.commissionOfficerId || null,
        salesManagerId: form.salesManagerId || null,
      }

      /**
       * The allowlist is a second request, after the PFI exists.
       *
       * PUT /pfis/:id/locations is the only endpoint that writes it — create
       * and update accept `allowedDepotIds` in their schema but do nothing
       * with it — and on a create there is no id to address until the first
       * request comes back. It is sent after the PFI is safely saved rather
       * than before, so a rejected allowlist cannot lose the batch.
       */
      let savedId = form.id
      if (isEdit && form.id) {
        await updatePfi.mutateAsync({ id: form.id, data: payload })
      } else {
        const res = await createPfi.mutateAsync(payload)
        const created = res?.data?.pfi ?? res?.data
        savedId = created?.id != null ? String(created.id) : ''
      }

      if (isDelivery && savedId) {
        // Sent even when empty: clearing the list is a real edit, and on a
        // batch switched away from delivery the stale allowlist is what would
        // keep letting other depots sell from it.
        await setLocations.mutateAsync({
          pfiId: Number(savedId),
          depotIds: selectedDepots,
        })

        /**
         * And the trucks, in both tables they belong to.
         *
         * This is what makes the batch appear on the delivery inventory page
         * and in the sales ledger. Both list truck LOADS rather than batches,
         * so without this the PFI existed, carried a quantity, and showed up
         * on neither — which is exactly what it used to do.
         */
        if (trucks.trucks.length > 0) {
          await attachTrucks.mutateAsync({
            pfiId: Number(savedId),
            pfiNumber: form.pfiNumber.trim(),
            // `: any` as everywhere else in this file — `depots` and `products`
            // are unions of a typed array and the envelope fallback, so TS
            // cannot pick one signature for the callback.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            depotName: depots.find((d: any) => String(d.id || d._id) === form.locationId)?.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            productName: products.find((p: any) => String(p.id || p._id) === form.productId)?.name,
            dateAllocated: form.pfiDate || new Date().toISOString().slice(0, 10),
            trucks: trucks.trucks,
          })
        }
      }

      setSubmitted(true)
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 409) {
        const msg = err?.response?.data?.message || 'A PFI with this number already exists.'
        setFieldErrors({ pfiNumber: msg })
        setError(msg)
      } else {
        const apiFieldErrors = getFieldErrors(err)
        if (Object.keys(apiFieldErrors).length > 0) {
          setFieldErrors(apiFieldErrors)
          setError('Please fix the highlighted fields.')
        } else {
          setError(getErrorMessage(err) || 'Failed to save PFI details')
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isEdit && isLoadingPfi) return <PageLoader />

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
          <CheckCircle className="size-8" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          PFI {isEdit ? 'updated' : 'registered'} successfully
        </h2>
        <p className="max-w-sm text-muted-foreground">
          {TYPE_LABEL[form.pfiType]} Pro Forma Invoice{' '}
          <span className="font-mono font-semibold text-foreground">{form.pfiNumber}</span> has been saved.
        </p>
        <div className="mt-2 flex gap-3">
          {!isEdit && (
            <Button variant="outline" onClick={() => { setSubmitted(false); resetForm() }}>
              Add another
            </Button>
          )}
          <Button onClick={() => navigate({ to: '/pfi' })}>Back to PFI list</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Admin"
        title={isEdit ? 'Edit PFI' : 'Add New PFI'}
        description={
          isEdit
            ? isGantry
              ? 'Modify quantity, cost, tickets and officers for this gantry PFI.'
              : isDelivery
                ? 'Modify quantity, cost, trucks, locations and officers for this delivery PFI.'
                : 'Modify quantities, cost, officers and vessel details for this PFI.'
            : 'Register a new PFI.'
        }
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-1">
          <div className="space-y-6">
            <Section
              step={1}
              icon={isGantry ? <Fuel /> : isDelivery ? <Truck /> : <Anchor />} title="PFI Type"
              description="How this batch was bought. It decides what the rest of the form asks for."
              aside={
                <StatusChip tone="accent" className="hidden shrink-0 sm:inline-flex">
                  {TYPE_LABEL[form.pfiType]}
                </StatusChip>
              }
            >
              {/* Three now, so they stop being a pair of half-width cards. */}
              <div className="grid gap-3 sm:grid-cols-3">
                {PFI_TYPES.map((t) => {
                  const active = form.pfiType === t.value
                  return (
                    <button
                      key={t.value} type="button"
                      aria-pressed={active}
                      onClick={() => set('pfiType', t.value)}
                      className={cn(
                        'group relative flex items-start gap-3 rounded-lg border p-4 text-left transition-colors duration-250 ease-luxe',
                        active
                          ? 'border-accent bg-accent/5'
                          : 'border-foreground/15 hover:border-foreground/30 hover:bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-250 ease-luxe [&_svg]:size-4',
                          active ? 'bg-accent/15 text-accent' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {t.icon}
                      </span>
                      <span className="min-w-0 pr-6">
                        <span className={cn('block text-sm font-semibold', active ? 'text-accent' : 'text-foreground')}>
                          {t.label}
                        </span>
                        <span className="mt-1 block text-xs leading-snug text-muted-foreground">{t.hint}</span>
                      </span>
                      {/* The tick, not just the tint — on a two-card choice a
                          colour shift alone reads as a hover state. */}
                      <CheckCircle
                        className={cn(
                          'absolute right-3 top-3 size-4 transition-opacity duration-250 ease-luxe',
                          active ? 'text-accent opacity-100' : 'opacity-0',
                        )}
                      />
                    </button>
                  )
                })}
              </div>

              {/* Whether the batch is trading yet.
                  A cargo is bought, shipped and paid for weeks before the
                  first litre leaves the depot, and those costs have to land
                  on the batch that incurred them. Marking it not-started
                  lets it take expenses while staying out of the stock and
                  revenue totals, so "PMS remaining" never counts product
                  nobody can ship today.
                  Hidden once a batch is closed: reopening it is not this
                  form's business. */}
              {editingPfi?.status !== 'finished' && (
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors duration-250 ease-luxe',
                    form.notStarted
                      ? 'border-warning/40 bg-warning/5'
                      : 'border-foreground/15 hover:border-foreground/30 hover:bg-muted/40',
                  )}
                >
                  <Checkbox
                    checked={form.notStarted}
                    onCheckedChange={(v) => set('notStarted', v === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Not selling yet</span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                      The cargo exists and can take expenses, but its stock and revenue stay
                      out of the portfolio totals until you start it from the PFI list.
                    </span>
                  </span>
                </label>
              )}

              {/* Switching an existing batch discards figures that stop
                  applying, and finding that out after saving is too late. */}
              {isEdit && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <Info className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p className="text-xs leading-snug text-muted-foreground">
                    {isCargo
                      ? <>Saving as <span className="font-semibold text-foreground">coastal</span> clears this PFI’s ticket or truck count.</>
                      : <>Saving as <span className="font-semibold text-foreground">{form.pfiType}</span> clears this PFI’s BL figures, vessel and surveyor details.</>}
                  </p>
                </div>
              )}
            </Section>

            <Section
              step={2}
              icon={<FileText />} title="Identity"
              description="What this batch is and where it's going."
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date" hint="The date on the invoice, not today.">
                  <Input type="date" value={form.pfiDate} onChange={(e) => set('pfiDate', e.target.value)} />
                </Field>
                <Field
                  label="PFI No" required error={fieldErrors.pfiNumber}
                  hint="Must be unique — it is how every expense and order finds this batch."
                >
                  <Input
                    className="font-mono font-semibold"
                    placeholder="e.g. PFI-50" value={form.pfiNumber}
                    aria-invalid={!!fieldErrors.pfiNumber}
                    onChange={(e) => set('pfiNumber', e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Description" hint="A short note to tell this batch apart in a list of fifty.">
                <Input
                  placeholder="e.g. PMS" value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field
                  label={isDelivery ? 'Loaded at' : 'Location'} required error={fieldErrors.locationId}
                  hint={
                    isDelivery
                      ? 'The depot the trucks load at. Where it may be SOLD is the list below.'
                      : 'Only orders at this depot can be assigned to the batch.'
                  }
                >
                  <NativeSelect
                    value={form.locationId} aria-invalid={!!fieldErrors.locationId}
                    onChange={(e) => set('locationId', e.target.value)}
                  >
                    <option value="">Select location</option>
                    {depots.map((d: any) => (
                      <option key={d.id || d._id} value={String(d.id || d._id)}>
                        {d.name}{d.code ? ` (${d.code})` : ''}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  label="Product" required error={fieldErrors.productId}
                  hint={
                    form.productUnit
                      ? `Measured in ${unit.plural.toLowerCase()} — every quantity below follows.`
                      : 'One product per PFI. Its unit sets how quantities are measured.'
                  }
                >
                  <NativeSelect
                    value={form.productId} aria-invalid={!!fieldErrors.productId}
                    onChange={(e) => {
                      const v = e.target.value
                      const selected = products.find((p: any) => String(p.id || p._id) === v)
                      setForm((f) => ({ ...f, productId: v, productUnit: selected?.unit || f.productUnit }))
                    }}
                  >
                    <option value="">Select product</option>
                    {products.map((p: any) => (
                      <option key={p.id || p._id} value={String(p.id || p._id)}>
                        {p.name}{p.unit ? ` (${p.unit})` : ''}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>

              {/* Where it may be sold, which only a delivery batch has.
                  A coastal or gantry batch is sold out of the depot it sits
                  in, so `locationId` above is the whole answer there and this
                  would be a list with one right tick. A delivery batch is
                  loaded at one depot and sold at several, and that list is
                  what decides which locations may place an order against it. */}
              {isDelivery && (
                <Field
                  label="Locations that may sell from it"
                  hint={
                    selectedDepots.length > 0
                      ? `${selectedDepots.length} selected. The loading depot can always sell from it, ticked or not.`
                      : 'Tick every depot that can place orders against this batch. Leave it empty and only the loading depot can.'
                  }
                >
                  <div className="grid gap-1 rounded-lg border border-foreground/15 p-2 sm:grid-cols-2 lg:grid-cols-3">
                    {depots.map((d: any) => {
                      const depotId = Number(d.id || d._id)
                      const isSource = !!form.locationId && depotId === Number(form.locationId)
                      return (
                        <label
                          key={depotId}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedDepots.includes(depotId)}
                            onCheckedChange={() =>
                              setEditedDepots(
                                selectedDepots.includes(depotId)
                                  ? selectedDepots.filter((x) => x !== depotId)
                                  : [...selectedDepots, depotId],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{d.name}</span>
                            {/* Named rather than hidden: ticking the loading
                                depot changes nothing, so its absence from the
                                list is not somebody's mistake. */}
                            {isSource && (
                              <span className={cn(MICRO, 'text-muted-foreground')}>
                                loaded here · always allowed
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </Field>
              )}

              {/* The trucks. Only a delivery batch has any, and picking them
                  here is what puts the batch on the delivery inventory page
                  and in the sales ledger — both list truck LOADS, not
                  batches, so a batch with no trucks has nothing to appear as.
                  Creating one used to leave both empty with no hint why. */}
              {isDelivery && (
                <div className="space-y-1.5">
                  <TruckPicker
                    fleet={fleet}
                    value={truckSelection}
                    onChange={setTruckSelection}
                    unit={unit.short}
                    hint={
                      isEdit
                        ? 'Ticked trucks are ADDED to this batch. What is already on it stays.'
                        : 'Tick a truck and it takes its rated capacity. Change it to what actually went on.'
                    }
                  />
                  {(fieldErrors.trucks || trucks.problem) && (
                    <p className={cn(
                      'text-xs',
                      fieldErrors.trucks ? 'text-destructive' : 'text-muted-foreground',
                    )}>
                      {fieldErrors.trucks || trucks.problem}
                    </p>
                  )}
                </div>
              )}

              {/* Coastal measures twice — the tank against the papers — so it
                  asks twice. Gantry and delivery have one quantity, and it
                  lives beside the price it is charged at, in the cost section
                  below. */}
              {isCargo && (
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label={`Tank Quantity (${unit.plural})`} required error={fieldErrors.startingQtyLitres}
                    hint="What measured into the tank — this is what you can sell."
                  >
                    <Adorned suffix={unit.short}>
                      <CommaInput
                        className="font-semibold tabular-nums"
                        value={form.startingQtyLitres} aria-invalid={!!fieldErrors.startingQtyLitres}
                        placeholder="e.g. 1,000,000"
                        onValueChange={(v) => set('startingQtyLitres', v)}
                      />
                    </Adorned>
                  </Field>
                  <Field label="Tank Quantity (MT)" hint="The same tank figure by weight. Optional.">
                    <Adorned suffix="MT">
                      <CommaInput
                        className="tabular-nums"
                        value={form.qtyVolumeMt} placeholder="e.g. 820"
                        onValueChange={(v) => set('qtyVolumeMt', v)}
                      />
                    </Adorned>
                  </Field>
                </div>
              )}
            </Section>

            <Section
              step={3}
              icon={<Banknote />}
              title={isCargo ? 'Cargo Cost' : 'Quantity & Cost'}
              description={
                isGantry
                  ? 'What was bought at the gantry, at what price, over how many tickets.'
                  : isDelivery
                    ? 'What was loaded out, at what price, over how many trucks.'
                    : "What the shipping papers say you're billed for."
              }
            >
              {!isCargo ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label={`Quantity (${unit.plural})`}
                      required={!isDelivery} error={fieldErrors.startingQtyLitres}
                      hint={
                        isDelivery
                          ? 'The sum of what the trucks loaded, rebuilt from the manifest when it saves.'
                          : 'What was bought. There is only one quantity on a gantry batch.'
                      }
                    >
                      <Adorned suffix={unit.short}>
                        {isDelivery ? (
                          <Input
                            className="font-semibold tabular-nums"
                            value={trucks.loaded ? trucks.loaded.toLocaleString() : ''}
                            placeholder="0"
                            readOnly
                          />
                        ) : (
                          <CommaInput
                            className="font-semibold tabular-nums"
                            value={form.startingQtyLitres} aria-invalid={!!fieldErrors.startingQtyLitres}
                            placeholder="e.g. 1,000,000"
                            onValueChange={(v) => set('startingQtyLitres', v)}
                          />
                        )}
                      </Adorned>
                    </Field>
                    <Field
                      label={`Price per ${unit.singular}`}
                      hint="What you were charged per unit, to the kobo."
                    >
                      <Adorned prefix="₦">
                        <CommaInput
                          className="font-semibold tabular-nums"
                          value={form.unitPrice} placeholder="950.00"
                          onValueChange={(v) => set('unitPrice', v)}
                        />
                      </Adorned>
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* One column, one meaning: how many units the allocation
                        was split into. A gantry batch counts tickets and a
                        delivery batch counts trucks — but a delivery batch's
                        trucks are PICKED below, so its count is derived from
                        them rather than typed here. Typing it was how a batch
                        came to record twenty trucks while identifying none. */}
                    {isDelivery ? (
                      <Field
                        label="Number of Trucks"
                        hint={
                          trucks.count > 0
                            ? `${trucks.count} picked below, carrying ${trucks.loaded.toLocaleString()} ${unit.plural.toLowerCase()}.`
                            : 'Counted from the trucks you pick below.'
                        }
                      >
                        <Adorned suffix="trucks">
                          <Input
                            className="tabular-nums"
                            value={trucks.count ? String(trucks.count) : ''}
                            placeholder="0"
                            readOnly
                          />
                        </Adorned>
                      </Field>
                    ) : (
                      <Field
                        label="Number of Tickets" error={fieldErrors.ticketCount}
                        hint="How many gantry tickets the allocation was split into."
                      >
                        <Adorned suffix="tickets">
                          <CommaInput
                            className="tabular-nums"
                            value={form.ticketCount} placeholder="25"
                            aria-invalid={!!fieldErrors.ticketCount}
                            onValueChange={(v) => set('ticketCount', v)}
                          />
                        </Adorned>
                      </Field>
                    )}
                    <Field
                      label="Credit Note"
                      hint="Rebate or claim credited back. Reduces the batch's total cost."
                    >
                      <Adorned prefix="₦">
                        <CommaInput
                          className="tabular-nums"
                          value={form.creditBalance} placeholder="0.00"
                          onValueChange={(v) => set('creditBalance', v)}
                        />
                      </Adorned>
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label={`BL Figures (${unit.plural})`}
                      hint="From the shipping papers — this is what you are billed for."
                    >
                      <Adorned suffix={unit.short}>
                        <CommaInput
                          className="font-semibold tabular-nums"
                          value={form.blQtyLitres} placeholder="e.g. 1,000,000"
                          onValueChange={(v) => set('blQtyLitres', v)}
                        />
                      </Adorned>
                    </Field>
                    <Field label="BL Figures (MT)" hint="The same BL figure by weight. Optional.">
                      <Adorned suffix="MT">
                        <CommaInput
                          className="tabular-nums"
                          value={form.blQtyMt} placeholder="e.g. 820"
                          onValueChange={(v) => set('blQtyMt', v)}
                        />
                      </Adorned>
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label={`Price per ${unit.singular}`}
                      hint="What you were charged per unit, to the kobo."
                    >
                      <Adorned prefix="₦">
                        <CommaInput
                          className="font-semibold tabular-nums"
                          value={form.unitPrice} placeholder="950.00"
                          onValueChange={(v) => set('unitPrice', v)}
                        />
                      </Adorned>
                    </Field>
                    <Field
                      label="Credit Balance"
                      hint="Rebate, discount or claim credited back. Reduces the grand total cost."
                    >
                      <Adorned prefix="₦">
                        <CommaInput
                          className="tabular-nums"
                          value={form.creditBalance} placeholder="0.00"
                          onValueChange={(v) => set('creditBalance', v)}
                        />
                      </Adorned>
                    </Field>
                  </div>
                </>
              )}

              {/* Neither figure is typed in. PFI value is quantity × price, and
                  sales value is what confirmed-paid orders on this batch have
                  brought in — a second copy of either would be free to drift
                  away from the numbers everything else reports. */}
              {preview.show && (
                <div className="rounded-lg border border-foreground/15 bg-muted/40 p-4">
                  <p className={cn(MICRO, 'mb-3 flex items-center gap-1.5 font-semibold text-muted-foreground')}>
                    <Calculator className="size-3.5" />
                    Worked out for you
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {!isCargo ? (
                      <>
                        <Computed
                          label="PFI Value"
                          value={naira(preview.pfiValue)}
                          hint={`Quantity × price per ${unit.singular.toLowerCase()}`}
                        />
                        <Computed
                          label="Sales Value"
                          value={isEdit ? naira(editingPfi?.financials?.revenue ?? null) : '—'}
                          tone="text-accent"
                          hint={
                            isEdit
                              ? 'From orders on this PFI with payment confirmed'
                              : 'Accrues as orders are placed and payment is confirmed'
                          }
                        />
                      </>
                    ) : (
                      <>
                        <Computed
                          label="Surplus/Deficit"
                          value={
                            <SurplusDeficit
                              litres={preview.surplusDeficit} unit={form.productUnit}
                              className="text-lg font-semibold"
                            />
                          }
                          hint="Tank figure against the papers"
                        />
                        <Computed
                          label="PFI (Cargo) Cost"
                          value={naira(preview.pfiValue)}
                          hint={`BL quantity × price per ${unit.singular.toLowerCase()}`}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
            </Section>
          </div>

          <div className="space-y-6">
            <Section
              step={4}
              icon={<Users />} title="Officers"
              description="Assign staff for each role."
              aside={
                <span className={cn(MICRO, 'hidden shrink-0 font-semibold text-muted-foreground sm:block')}>
                  {assignedOfficers}/{OFFICER_FIELDS.length} assigned
                </span>
              }
            >
              <div className="grid grid-cols-2 gap-4">
                {OFFICER_FIELDS.map(({ label, key }) => (
                  <Field key={key} label={label}>
                    <NativeSelect value={form[key]} onChange={(e) => set(key, e.target.value)}>
                      <option value="">Unassigned</option>
                      {staff.map((u: any) => (
                        <option key={u.id} value={String(u.id)}>{u.full_name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                ))}
              </div>
            </Section>

            {/* A gantry batch never touches a vessel, so there is nothing here
                to leave blank. */}
            {isCargo && (
            <Section
              step={5}
              icon={<Ship />} title="Vessel & Surveyor"
              description="Who carried the cargo and who measured it on discharge."
              aside={
                <span className={cn(MICRO, 'hidden shrink-0 font-semibold text-muted-foreground/70 sm:block')}>
                  Optional
                </span>
              }
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Vessel Broker" hint="Who arranged the shipment.">
                  <Input placeholder="Broker name" value={form.vesselBroker} onChange={(e) => set('vesselBroker', e.target.value)} />
                </Field>
                <Field label="Vessel Name" hint="As it appears on the shipping papers.">
                  <Input placeholder="e.g. MV Lagos Star" value={form.vesselName} onChange={(e) => set('vesselName', e.target.value)} />
                </Field>
                <Field label="Surveyor Name" hint="Whoever signed off the tank measurement.">
                  <Input placeholder="Surveyor full name" value={form.surveyorName} onChange={(e) => set('surveyorName', e.target.value)} />
                </Field>
                <Field label="Surveyor Phone" hint="For querying a discharge figure later.">
                  <Input type="tel" placeholder="e.g. 08012345678" value={form.surveyorPhone} onChange={(e) => set('surveyorPhone', e.target.value)} />
                </Field>
              </div>
            </Section>
            )}
          </div>
        </div>

        {/* Sticky, because the form is long enough that the save button is off
            screen for most of the time someone is filling it in. The blur and
            hairline keep it reading as a bar over the page rather than a
            floating slab — this system has no shadows. */}
        <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-foreground/15 bg-background/85 px-1 py-4 backdrop-blur">
          <p className="mr-auto text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{TYPE_LABEL[form.pfiType]}</span> PFI
            {form.pfiNumber ? <> · <span className="font-mono font-semibold text-foreground">{form.pfiNumber}</span></> : null}
          </p>
          <Button type="button" variant="outline" onClick={() => navigate({ to: '/pfi' })}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting} className="min-w-[9rem]">
            {isSubmitting ? <Loader2 className="animate-spin" /> : <Save data-icon="inline-start" />}
            {isSubmitting ? 'Saving…' : isEdit ? 'Update PFI' : 'Save PFI'}
          </Button>
        </div>
      </form>
    </div>
  )
}
