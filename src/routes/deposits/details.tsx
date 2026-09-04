import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#/components/ui/card'
import { Textarea } from '#/components/ui/textarea'
import { Label } from '#/components/ui/label'
import {
  ArrowLeft,
  AlertCircle,
  DollarSign,
  ArrowDownLeft,
  Calendar,
  User,
  Building2,
  Phone,
  Hash,
  FileText,
  Clock,
  Landmark,
  CreditCard,
  Globe,
  Send,
  ShieldCheck,
  Banknote,
  ArrowRightLeft,
  Info,
  Undo2,
} from 'lucide-react'
import type { Deposit } from '#/lib/hooks/useDeposits'
import { useReverseDeposit } from '#/lib/hooks/useDeposits'
import { toNum } from '#/lib/utils'
import { Breadcrumbs } from '#/components/Breadcrumbs'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink } from '#/components/ContactLink'

export const Route = createFileRoute('/deposits/details')({
  beforeLoad: () => routeGuard('/deposits'),
  component: DepositDetailPage,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(value)
}

function DepositDetailPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const deposit = (router.history.location.state as any)?.deposit as Deposit | undefined
  const [showReverse, setShowReverse] = useState(false)
  const [reverseReason, setReverseReason] = useState('')
  const reverseDeposit = useReverseDeposit()

  const handleBack = () => {
    window.history.length > 1 ? window.history.back() : navigate({ to: '/deposits/' as any })
  }

  const isReversal = Boolean(deposit?.reference?.startsWith('REV-'))
  const canReverse = Boolean(deposit && deposit.type === 'credit' && !isReversal)

  const handleReverse = async () => {
    if (!deposit) return
    await reverseDeposit.mutateAsync({ id: deposit._id, description: reverseReason.trim() || undefined })
    setShowReverse(false)
    navigate({ to: '/deposits/' as any })
  }

  if (!deposit) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
          <AlertCircle className="size-8" />
        </div>
        <h2 className="text-lg md:text-xl font-semibold text-foreground tracking-tight">No Deposit Selected</h2>
        <p className="text-muted-foreground max-w-sm">Please select a deposit from the list to view its details.</p>
        <Button onClick={() => navigate({ to: '/deposits/' as any })}>
          <ArrowLeft className="size-4" /> Back to Deposits
        </Button>
      </div>
    )
  }

  const ps = deposit.paystackDetails as Record<string, any> | null | undefined

  // Determine if this deposit was processed via Paystack or is a manual bank transfer
  const isPaystack = Boolean(
    ps?.transactionId ||
    ps?.paystackCustomerCode ||
    (ps?.gatewayResponse && String(ps.gatewayResponse).toLowerCase() !== 'manual') ||
    (ps?.channel && ps.channel !== 'manual_bank_transfer' && ps.channel !== 'manual')
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: 'Deposits', href: '/deposits' }, { label: 'Deposit Details' }]} />

      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader
      eyebrow="Finance"
      title="Deposit Details"
      description={`{isPaystack ? 'Paystack automated transaction details and customer information' : 'Manual bank deposit details and customer information'}`}
      backAction={handleBack}
      actions={
        canReverse ? (
          <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => setShowReverse(true)}>
            <Undo2 className="size-4" /> Reverse Deposit
          </Button>
        ) : isReversal ? (
          <Badge variant="outline" className="text-muted-foreground">This is a reversal</Badge>
        ) : undefined
      }
    />
      </header>

      <Card className="card-hover">
        <CardContent className="bg-primary/5 p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="size-20 rounded-full flex items-center justify-center shrink-0 bg-success text-success-foreground">
              <ArrowDownLeft className="size-9" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-success text-success-foreground">
                  Deposit
                </Badge>
                {deposit.reference && (
                  <Badge variant="outline" className="font-mono text-xs">Ref: {deposit.reference}</Badge>
                )}
                {isPaystack ? (
                  <Badge className="bg-muted/15 text-foreground dark:text-muted-foreground border-border/30 font-normal text-xs capitalize">
                    Paystack {ps?.channel ? `(${String(ps.channel).replace(/_/g, ' ')})` : ''}
                  </Badge>
                ) : (
                  <Badge className="bg-warning/15 text-warning border-warning/30 font-normal text-xs">
                    Manual Bank Transfer
                  </Badge>
                )}
              </div>
              <p className="text-3xl font-semibold mt-2 text-success">
                +{formatCurrency(toNum(deposit.amount))}
              </p>
              {deposit.customerName && (
                <p className="text-muted-foreground mt-1.5 text-sm flex items-center gap-1.5">
                  <User className="size-3.5 shrink-0" />
                  {deposit.customerName}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Calendar className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Transaction Info</CardTitle>
                <CardDescription className="text-xs">Date, type, and reference</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Date & Time</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <Clock className="size-3.5 text-muted-foreground" />
                {deposit.createdAt
                  ? new Date(deposit.createdAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Transaction Type</p>
              <div className="mt-1">
                <Badge className="bg-success text-success-foreground gap-1">
                  <ArrowDownLeft className="size-3" /> Deposit (Credit)
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Payment Method</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5 font-normal">
                <Landmark className="size-3.5 text-muted-foreground" />
                {isPaystack ? 'Paystack Gateway' : 'Manual Bank Transfer'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Reference</p>
              <p className="text-sm text-foreground mt-0.5 font-mono flex items-center gap-1.5">
                <Hash className="size-3.5 text-muted-foreground" />
                {deposit.reference || 'No reference provided'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Recorded By</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <User className="size-3.5 text-muted-foreground" />
                {deposit.recorderFirstName
                  ? `${deposit.recorderFirstName} ${deposit.recorderSurname || ''}`
                  : isPaystack ? 'Paystack System' : 'System'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-info/10 flex items-center justify-center text-info">
                <User className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Customer Info</CardTitle>
                <CardDescription className="text-xs">Associated customer details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Customer Name</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <User className="size-3.5 text-muted-foreground" />
                {deposit.customerName || 'Unknown Customer'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Phone</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <Phone className="size-3.5 text-muted-foreground" />
                <PhoneLink value={deposit.customerPhone} />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Company</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <Building2 className="size-3.5 text-muted-foreground" />
                {deposit.customerCompanyName || '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-success/10 flex items-center justify-center text-success">
                <DollarSign className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Financial Details</CardTitle>
                <CardDescription className="text-xs">Amount and balance information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Amount</p>
              <p className="text-2xl font-semibold mt-1 text-success">
                +{formatCurrency(toNum(deposit.amount))}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Balance After</p>
              <p className="text-lg font-semibold text-foreground mt-0.5 font-mono">
                {formatCurrency(toNum(deposit.balanceAfter || 0))}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                <FileText className="size-4" />
              </div>
              <div>
                <CardTitle className="text-sm">System Info</CardTitle>
                <CardDescription className="text-xs">Record identifiers</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Deposit ID</p>
              <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate select-all">{deposit._id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-normal uppercase">Last Updated</p>
              <p className="text-sm text-foreground mt-0.5 flex items-center gap-1.5">
                <Clock className="size-3.5 text-muted-foreground" />
                {deposit.updatedAt
                  ? new Date(deposit.updatedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        {deposit.description && (
          <Card className="md:col-span-2">
            <CardHeader className="border-b border-border">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                  <FileText className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Description / Notes</CardTitle>
                  <CardDescription className="text-xs">Transaction notes and details</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-sm text-foreground whitespace-pre-wrap">{deposit.description}</p>
            </CardContent>
          </Card>
        )}

        {/* ── Manual Deposit Details Section ── */}
        {!isPaystack && (
          <Card className="md:col-span-2 border-warning/20">
            <CardHeader className="bg-warning/5 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-warning/15 flex items-center justify-center text-warning">
                    <Landmark className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Manual Deposit Details</CardTitle>
                    <CardDescription className="text-xs">Direct bank transfer record (Recorded manually, not via Paystack)</CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs">
                  Manual Entry
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {/* Depositor / Payer Name */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <User className="size-3" /> Depositor / Payer Name
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {ps?.senderName || ps?.depositorName || deposit.customerName || '—'}
                  </p>
                </div>

                {/* Receiving Bank Name */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <Landmark className="size-3" /> Receiving Bank
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {ps?.bankName || ps?.receiverBankName || '—'}
                  </p>
                </div>

                {/* Receiving Account Name */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <User className="size-3" /> Receiving Account Name
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {ps?.accountName || ps?.receiverAccountName || '—'}
                  </p>
                </div>

                {/* Receiving Account Number */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <CreditCard className="size-3" /> Receiving Account Number
                  </p>
                  <p className="text-sm font-mono font-semibold text-foreground">
                    {ps?.accountNumber || ps?.receiverAccountNumber || '—'}
                  </p>
                </div>

                {/* Payment Date / Paid At */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <Clock className="size-3" /> Payment Date
                  </p>
                  <p className="text-sm text-foreground">
                    {ps?.paidAt || ps?.paymentDate
                      ? new Date(String(ps.paidAt || ps.paymentDate)).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : deposit.createdAt
                      ? new Date(deposit.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </p>
                </div>

                {/* Channel / Source */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                    <ArrowRightLeft className="size-3" /> Payment Type
                  </p>
                  <Badge variant="outline" className="font-mono text-xs capitalize mt-0.5">
                    Manual Bank Transfer
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Paystack Payment Details Section ── */}
        {isPaystack && ps && (
          <Card className="md:col-span-2 border-primary/20">
            <CardHeader className="bg-primary/5 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/15 flex items-center justify-center text-primary">
                  <Landmark className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Paystack Payment Details</CardTitle>
                  <CardDescription className="text-xs">Full transaction details from Paystack</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">

                {/* Sender Name */}
                {ps.senderName && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Send className="size-3" /> Sender Name
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.senderName)}</p>
                  </div>
                )}

                {/* Sender Bank */}
                {ps.senderBankName && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Landmark className="size-3" /> Sender Bank
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.senderBankName)}</p>
                  </div>
                )}

                {/* Sender Account Number */}
                {ps.senderAccountNumber && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <CreditCard className="size-3" /> Sender Account
                    </p>
                    <p className="text-sm font-mono font-semibold text-foreground">
                      {String(ps.senderAccountNumber).length <= 4
                        ? `****${ps.senderAccountNumber}`
                        : String(ps.senderAccountNumber)}
                    </p>
                  </div>
                )}

                {/* Receiver Bank */}
                {ps.receiverBankName && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Landmark className="size-3" /> Receiver Bank
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.receiverBankName)}</p>
                  </div>
                )}

                {/* Receiver Account Number */}
                {ps.receiverAccountNumber && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <CreditCard className="size-3" /> Receiver Account
                    </p>
                    <p className="text-sm font-mono font-semibold text-foreground">{String(ps.receiverAccountNumber)}</p>
                  </div>
                )}

                {/* Receiver Account Name */}
                {ps.receiverAccountName && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <User className="size-3" /> Receiver Account Name
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.receiverAccountName)}</p>
                  </div>
                )}

                {/* Channel */}
                {ps.channel && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <ArrowRightLeft className="size-3" /> Payment Channel
                    </p>
                    <Badge variant="outline" className="font-mono text-xs capitalize mt-0.5">
                      {String(ps.channel).replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}

                {/* Currency */}
                {ps.currency && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Banknote className="size-3" /> Currency
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.currency)}</p>
                  </div>
                )}

                {/* Fees */}
                {ps.fees != null && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <DollarSign className="size-3" /> Paystack Fees
                    </p>
                    <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(ps.fees))}</p>
                  </div>
                )}

                {/* Gateway Response */}
                {ps.gatewayResponse && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <ShieldCheck className="size-3" /> Gateway Response
                    </p>
                    <Badge
                      className={
                        String(ps.gatewayResponse).toLowerCase() === 'successful'
                          ? 'bg-success text-success-foreground'
                          : 'bg-warning text-warning-foreground'
                      }
                    >
                      {String(ps.gatewayResponse)}
                    </Badge>
                  </div>
                )}

                {/* Transaction Status */}
                {ps.status && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Info className="size-3" /> Transaction Status
                    </p>
                    <Badge
                      className={
                        String(ps.status).toLowerCase() === 'success'
                          ? 'bg-success text-success-foreground'
                          : 'bg-warning text-warning-foreground'
                      }
                    >
                      {String(ps.status)}
                    </Badge>
                  </div>
                )}

                {/* Sender Country */}
                {ps.senderCountry && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Globe className="size-3" /> Sender Country
                    </p>
                    <p className="text-sm font-semibold text-foreground">{String(ps.senderCountry)}</p>
                  </div>
                )}

                {/* Sender Narration */}
                {ps.senderNarration && (
                  <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <FileText className="size-3" /> Sender Narration
                    </p>
                    <p className="text-sm text-foreground">{String(ps.senderNarration)}</p>
                  </div>
                )}

                {/* Paystack Transaction ID */}
                {ps.transactionId && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Hash className="size-3" /> Paystack Transaction ID
                    </p>
                    <p className="text-xs font-mono text-muted-foreground select-all">{String(ps.transactionId)}</p>
                  </div>
                )}

                {/* Paystack Customer Code */}
                {ps.paystackCustomerCode && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Hash className="size-3" /> Paystack Customer Code
                    </p>
                    <p className="text-xs font-mono text-muted-foreground select-all">{String(ps.paystackCustomerCode)}</p>
                  </div>
                )}

                {/* Paid At */}
                {ps.paidAt && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Clock className="size-3" /> Paid At
                    </p>
                    <p className="text-sm text-foreground">
                      {new Date(String(ps.paidAt)).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                )}

                {/* IP Address */}
                {ps.ipAddress && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Globe className="size-3" /> IP Address
                    </p>
                    <p className="text-xs font-mono text-muted-foreground select-all">{String(ps.ipAddress)}</p>
                  </div>
                )}

                {/* Domain */}
                {ps.domain && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
                      <Info className="size-3" /> Domain
                    </p>
                    <Badge variant="outline" className="text-xs capitalize">{String(ps.domain)}</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={showReverse}
        onOpenChange={setShowReverse}
        title="Reverse this deposit?"
        description={`This debits ${formatCurrency(toNum(deposit.amount))} back out of ${deposit.customerName || 'this customer'}'s wallet. If some of it has already been spent on orders, it comes out of their current balance instead — this will fail if that balance can't cover it.`}
        confirmLabel="Reverse Deposit"
        variant="destructive"
        loading={reverseDeposit.isPending}
        onConfirm={handleReverse}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reverse-reason" className="text-xs">Reason (optional)</Label>
          <Textarea
            id="reverse-reason"
            rows={2}
            placeholder="e.g. Recorded against the wrong customer"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}
