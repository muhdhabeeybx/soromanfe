import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NumberInput } from '#/components/ui/number-input'
import { Label } from '#/components/ui/label'
import { useNavigate } from '@tanstack/react-router'
import {
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Package,
  Plus,
  Copy,
  Mail,
  Phone,
  Banknote,
  FileCheck,
  Hourglass,
  Trash2,
  Download,
  Loader2,
} from 'lucide-react'
import { formatCurrency, formatAccountName } from '../utils/formatters'
import { downloadOrderInvoice } from '#/lib/invoice'
import { useToast } from '#/lib/hooks/useToast'
import type { OrderWizardReturn } from '../hooks/useOrderWizard'
import { useCreateExpectedPayment } from '#/lib/hooks/useExpectedPayments'

interface CompletionStepProps {
  wizard: OrderWizardReturn
}

type ExpectedRow = { id: number; amount: string; companyName: string }
let rowSeq = 0
const emptyRow = (): ExpectedRow => ({ id: rowSeq++, amount: '', companyName: '' })

/**
 * Optional, skippable: how the customer says they'll pay, noted while it's
 * fresh so a later anonymous bank transfer has something to be matched
 * against. Never blocks — closing this card without submitting is fine.
 *
 * One row per expected deposit — a customer paying in several tranches (or
 * paying for several companies at once) gets one row each, all saved as
 * separate expected-payment notes on submit. Company name rides in the
 * `reference` field the API already has; there is no separate column for it.
 */
function ExpectedPaymentNote({ customerId, orderId }: { customerId: number; orderId: number }) {
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState(false)
  const [rows, setRows] = useState<ExpectedRow[]>([emptyRow()])
  const createExpectedPayment = useCreateExpectedPayment()

  if (saved) {
    return (
      <div className="max-w-2xl mx-auto flex items-center gap-2 rounded-xl border border-success/20 bg-success/5 p-4 text-sm text-success-foreground">
        <CheckCircle className="size-4 text-success shrink-0" />
        Noted — this'll show up when the desk reconciles bank transfers for this customer.
      </div>
    )
  }

  if (!open) {
    return (
      <div className="max-w-2xl mx-auto">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Hourglass className="size-4 mr-2" /> Customer told you how they'll pay?
        </Button>
      </div>
    )
  }

  const updateRow = (id: number, patch: Partial<ExpectedRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const usableRows = rows.filter((r) => r.amount || r.companyName.trim())

  const submit = async () => {
    for (const r of usableRows) {
      await createExpectedPayment.mutateAsync({
        customerId,
        orderId,
        expectedAmount: r.amount ? Number(r.amount) : undefined,
        reference: r.companyName.trim(),
      })
    }
    setSaved(true)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3 rounded-xl border-2 border-warning/30 bg-warning/5 p-5">
      <div className="flex items-center gap-2">
        <div className="size-9 rounded-lg bg-warning/15 flex items-center justify-center text-warning">
          <Hourglass className="size-5" />
        </div>
        <span className="font-semibold text-base text-foreground">Expected payment</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional — how the customer says they'll pay makes their bank transfer easy to
        spot later. Add a row per deposit they've told you about; skip if you don't know yet.
      </p>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1.5">
              {i === 0 && <Label htmlFor={`ep-amount-${r.id}`} className="text-xs">Amount</Label>}
              <NumberInput
                id={`ep-amount-${r.id}`}
                placeholder="0"
                className="text-right"
                value={r.amount}
                onValueChange={(v) => updateRow(r.id, { amount: v })}
              />
            </div>
            <div className="space-y-1.5">
              {i === 0 && <Label htmlFor={`ep-company-${r.id}`} className="text-xs">Company name</Label>}
              <Input
                id={`ep-company-${r.id}`}
                placeholder="e.g. Doe Enterprises"
                value={r.companyName}
                onChange={(e) => updateRow(r.id, { companyName: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={rows.length === 1}
              onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Remove row</span>
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
        <Plus className="size-4 mr-1" /> Add another deposit
      </Button>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Skip</Button>
        <Button type="button" size="sm" disabled={createExpectedPayment.isPending || usableRows.length === 0} onClick={submit}>
          {createExpectedPayment.isPending ? 'Saving…' : `Save ${usableRows.length > 1 ? `${usableRows.length} notes` : 'note'}`}
        </Button>
      </div>
    </div>
  )
}

export function CompletionStep({ wizard }: CompletionStepProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)
  const {
    placedOrder,
    paymentInfo,
    orderCompanyName,
    copied,
    setCopied,
    resetWizard,
  } = wizard

  if (!placedOrder) return null

  /**
   * The invoice carries the company name captured on the wizard, which the
   * order row does not always echo back — without it a customer trading under
   * a company would get an invoice billed to their personal name.
   */
  const downloadInvoice = async () => {
    setDownloading(true)
    try {
      await downloadOrderInvoice(
        { ...placedOrder, companyName: orderCompanyName || placedOrder.companyName },
        paymentInfo,
      )
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate the invoice')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div key="step-6" className="space-y-6 animate-fade-in">
      {/* Success Header */}
      <div className="flex flex-col items-center justify-center pt-8 gap-4 text-center">
        <div className="size-16 rounded-full bg-success/10 flex items-center justify-center text-success border border-success/20">
          <CheckCircle className="size-8" />
        </div>
        <div>
          <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">Order Created Successfully!</h2>
          <p className="text-muted-foreground max-w-md mx-auto mt-2">
            Order <span className="font-mono font-semibold text-primary">{placedOrder.orderNumber}</span> has been processed and customer balance was updated.
          </p>
        </div>
        {/* Offered here, at the moment the order lands, rather than only in
            the action row at the bottom — this is the point at which someone
            wants to hand the customer something. */}
        <Button size="lg" onClick={downloadInvoice} disabled={downloading} className="gap-2">
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {downloading ? 'Preparing invoice…' : 'Download Invoice'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
        {/* Virtual Account Card */}
        {paymentInfo?.accountNumber && (
          <div className="border-2 border-success/20 rounded-xl bg-success/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/15 flex items-center justify-center text-success">
                <Banknote className="size-4" />
              </div>
              <span className="font-semibold text-sm text-foreground">Dedicated Payment Account</span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Bank</p>
                <p className="text-sm font-semibold text-foreground">{paymentInfo.bankName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Account Number</p>
                <div className="flex items-center gap-2">
                  <p className="text-xl font-semibold font-mono text-foreground">{paymentInfo.accountNumber}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(paymentInfo.accountNumber)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-250 ease-luxe"
                    title="Copy account number"
 >
                    {copied ? <CheckCircle className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Account Name</p>
                <p className="text-sm font-semibold text-foreground">{paymentInfo.accountName || formatAccountName(placedOrder.customerName)}</p>
              </div>
            </div>
            <p className="text-xs text-success/80 leading-snug">Share this account number with the customer for payment.</p>
          </div>
        )}

        {/* Notification Status Card */}
        <div className="border rounded-xl bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-info/15 flex items-center justify-center text-info">
              <FileCheck className="size-4" />
            </div>
            <span className="font-semibold text-sm text-foreground">Notifications Sent</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className={`size-8 rounded-full flex items-center justify-center ${paymentInfo?.emailSent ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                <Mail className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-normal text-foreground">Invoice Email</p>
                <p className="text-xs text-muted-foreground">
                  {paymentInfo?.emailSent ? `Sent to ${placedOrder.customerEmail}` : 'No email on file - skipped'}
                </p>
              </div>
              {paymentInfo?.emailSent ? (
                <CheckCircle className="size-4 text-success" />
              ) : (
                <AlertCircle className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className={`size-8 rounded-full flex items-center justify-center ${paymentInfo?.smsSent ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                <Phone className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-normal text-foreground">Order Summary SMS</p>
                <p className="text-xs text-muted-foreground">
                  {paymentInfo?.smsSent ? `Sent to ${placedOrder.customerPhone}` : 'SMS not sent'}
                </p>
              </div>
              {paymentInfo?.smsSent ? (
                <CheckCircle className="size-4 text-success" />
              ) : (
                <AlertCircle className="size-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Order Summary */}
      <div className="max-w-2xl mx-auto border rounded-xl divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Order Summary</span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Product</span>
            <span className="font-semibold text-foreground">{placedOrder.productName || 'N/A'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Company</span>
            <span className="font-semibold text-foreground">{orderCompanyName || 'N/A'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Quantity</span>
            <span className="font-semibold text-foreground">{Number(placedOrder.quantity).toLocaleString()} {placedOrder.productUnit || 'Liters'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Unit Price</span>
            <span className="font-semibold text-foreground">{formatCurrency(placedOrder.price)}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Total</span>
            <span className="font-semibold text-primary">{formatCurrency(placedOrder.totalAmount)}</span>
          </div>
        </div>
      </div>

      {placedOrder.customerId && (
        <ExpectedPaymentNote customerId={Number(placedOrder.customerId)} orderId={Number(placedOrder.id)} />
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2 pb-4">
        <Button variant="outline" onClick={downloadInvoice} disabled={downloading}>
          {downloading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Download className="size-4 mr-2" />}
          Invoice
        </Button>
        <Button variant="outline" onClick={resetWizard}>
          <Plus className="size-4 mr-2" /> Place Another Order
        </Button>
        <Button  onClick={() => navigate({ to: '/orders' as any })}>
          Go to Orders List <ArrowRight className="size-4 ml-2" />
        </Button>
      </div>
    </div>
  )
}
