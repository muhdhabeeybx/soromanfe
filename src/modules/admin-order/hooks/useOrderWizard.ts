import { useState, useEffect } from 'react'
import { useCustomerList, useCreateCustomer } from '#/lib/hooks/useCustomers'
import { useDepots } from '#/lib/hooks/useDepots'
import { useCreateOrder } from '#/lib/hooks/useOrders'

export function useOrderWizard() {
  const createCustomerMutation = useCreateCustomer()
  const createOrderMutation = useCreateOrder()

  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  // Step 1: Customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [isRegisteringCustomer, setIsRegisteringCustomer] = useState(false)
  const [orderCompanyName, setOrderCompanyName] = useState('')
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    companyName: '',
    address: '',
  })

  // Step 2: Depot — the state used to be picked first and depots filtered by
  // it; now every active depot is offered directly and its own `state` rides
  // along on the order payload, derived rather than asked for.
  const [selectedDepot, setSelectedDepot] = useState<any>(null)

  // Step 3: Product
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [orderQuantity, setOrderQuantity] = useState('')

  // Step 4: Delivery
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'pickup'>('pickup')
  /**
   * Where the truck is going, asked only when Soroman is the one driving.
   *
   * The wizard used to take the delivery choice and stop there, so an order
   * that Soroman had undertaken to deliver recorded no destination at all —
   * the depot's own state rode along on `state` and read, on the review
   * screen and on the order, as though it were where the product was headed.
   *
   * Kept as two fields rather than one free-text line because the state is a
   * closed list and the town is not: the state can be picked, and the town
   * can be picked from that state's LGAs or typed when the place people
   * actually say is not one of them.
   */
  const [deliveryState, setDeliveryState] = useState('')
  const [deliveryTown, setDeliveryTown] = useState('')

  // Step 5: Completion
  const [placedOrder, setPlacedOrder] = useState<any>(null)
  const [paymentInfo, setPaymentInfo] = useState<any>(null)

  // Debounce customer search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(customerSearch)
      setSearchPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [customerSearch])

  // Backend queries
  const { data: customerSearchData, isLoading: isSearchingCustomers } = useCustomerList(
    { search: debouncedSearch || undefined, limit: 20, page: searchPage },
    { enabled: debouncedSearch.trim().length >= 2 }
  )
  const customers = customerSearchData?.customers || []
  const totalCustomers = customerSearchData?.pagination?.total || 0
  const hasMore = customers.length < totalCustomers

  const { data: depotsList, isLoading: isLoadingDepots } = useDepots({ limit: 100 })
  const depots = depotsList || []

  const activeDepots = depots.filter((d: any) => (d.status || 'Active') === 'Active')

  const handleRegisterCustomer = async () => {
    setErrors([])
    if (!newCustomerForm.name || !newCustomerForm.phone) {
      setErrors(['Name and Phone Number are required'])
      return
    }
    const cleaned = newCustomerForm.phone.replace(/[\s\-\(\)]/g, "");
    const isValid = /^(0|\+?234)\d{10}$/.test(cleaned) || /^8\d{9}$/.test(cleaned);
    if (!isValid) {
      setErrors(['Enter a valid Nigerian phone number (e.g. 08012345678)'])
      return
    }
    try {
      const response = await createCustomerMutation.mutateAsync(newCustomerForm)
      if (response.success && response.data?.customer) {
        setSelectedCustomer(response.data.customer)
        setIsRegisteringCustomer(false)
        setStep(2)
      } else {
        setErrors(['Failed to register customer'])
      }
    } catch (err: any) {
      setErrors([err?.response?.data?.message || err.message || 'Error registering customer'])
      // The number (or email) is already on someone. The server sends back who
      // — drop straight into the picker with them found, so the desk can use
      // that customer instead of guessing which record already holds it.
      const clash = err?.response?.data?.data?.existingCustomer
      if (clash) {
        setIsRegisteringCustomer(false)
        setIsSearchOpen(true)
        setCustomerSearch(clash.phone || clash.name || '')
      }
    }
  }

  const handlePlaceOrder = async () => {
    setErrors([])
    try {
      const totalAmount = Number(orderQuantity) * Number(selectedProduct.currentPrice)
      const payload = {
        customer: selectedCustomer._id || selectedCustomer.id,
        state: selectedDepot.state || '',
        depot: selectedDepot.id || selectedDepot._id,
        product: selectedProduct.product._id || selectedProduct.product.id,
        quantity: Number(orderQuantity),
        price: Number(selectedProduct.currentPrice),
        totalAmount,
        deliveryType,
        /**
         * Town first, then state — the way an address is read aloud, and the
         * way it is wanted by somebody dispatching a truck. Sent only on a
         * delivery; the server ignores it on a pickup anyway, and sending a
         * destination for an order nobody is delivering would put one on the
         * record.
         */
        deliveryAddress: deliveryType === 'delivery'
          ? [deliveryTown.trim(), deliveryState].filter(Boolean).join(', ')
          : '',
        companyName: orderCompanyName.trim(),
      }
      const response = await createOrderMutation.mutateAsync(payload)
      if (response.success && response.data?.order) {
        setPlacedOrder(response.data.order)
        setPaymentInfo(response.data.payment || null)
        setStep(6)
      }
    } catch (err: any) {
      setErrors([err?.response?.data?.message || err.message || 'Failed to place order'])
    }
  }

  /**
   * Validation for a single step, independent of where the user currently is.
   *
   * Kept separate from navigation so the UI can group several steps onto one
   * screen and validate the whole group before advancing. Returns all error
   * messages, or an empty array when the step is satisfied.
   */
  const validateStep = (target: number): string[] => {
    const errs: string[] = []
    if (target === 1) {
      if (!selectedCustomer) errs.push('Please select an existing customer or register a new one')
      if (!orderCompanyName.trim()) errs.push('Please enter the company name')
      return errs
    }
    if (target === 2) {
      if (!selectedDepot) errs.push('Please select a depot')
      return errs
    }
    if (target === 3) {
      if (!selectedProduct) errs.push('Please select a product')
      if (!orderQuantity || Number(orderQuantity) <= 0) errs.push('Please enter a valid quantity')
      if (selectedProduct && orderQuantity && Number(orderQuantity) > 0) {
        const prodKey = selectedProduct.product?._id || selectedProduct.product?.id || selectedProduct.productId
        const capacityEntry = selectedDepot?.productCapacities?.find(
          (pc: any) => String(pc.product?._id || pc.product?.id || pc.productId) === String(prodKey)
        )
        const availableStock = Number(capacityEntry?.availableStock ?? 0)
        if (availableStock <= 0) {
          errs.push(`This product is currently out of stock at ${selectedDepot?.name || 'this depot'} (no active PFI stock assigned).`)
        } else if (Number(orderQuantity) > availableStock) {
          errs.push(`Insufficient stock. Only ${availableStock.toLocaleString()} ${selectedProduct.product?.unit || 'Liters'} available in stock from assigned PFIs.`)
        }
      }
      return errs
    }
    if (target === 4) {
      // Only when we are the ones driving. A pickup order has no destination
      // to state — the customer's truck comes to the depot.
      if (deliveryType === 'delivery') {
        if (!deliveryState) errs.push('Please select the delivery state')
        if (!deliveryTown.trim()) errs.push('Please select or enter the delivery town')
      }
      return errs
    }
    return errs
  }

  const handleNextStep = () => {
    const stepErrors = validateStep(step)
    if (stepErrors.length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors([])
    if (step < 5) setStep(step + 1)
  }

  const handlePrevStep = () => {
    setErrors([])
    setStep(prev => Math.max(1, prev - 1))
  }

  const goToStep = (targetStep: number) => {
    setErrors([])
    setStep(targetStep)
  }

  const resetWizard = () => {
    setStep(1)
    setCustomerSearch('')
    setDebouncedSearch('')
    setIsSearchOpen(false)
    setSearchPage(1)
    setSelectedCustomer(null)
    setIsRegisteringCustomer(false)
    setOrderCompanyName('')
    setSelectedDepot(null)
    setSelectedProduct(null)
    setOrderQuantity('')
    setDeliveryState('')
    setDeliveryTown('')
    setPlacedOrder(null)
    setPaymentInfo(null)
    setErrors([])
  }

  return {
    // Step state
    step,
    setStep,
    errors,
    setErrors,
    validateStep,
    copied,
    setCopied,

    // Customer state
    customerSearch,
    setCustomerSearch,
    isSearchOpen,
    setIsSearchOpen,
    searchPage,
    setSearchPage,
    selectedCustomer,
    setSelectedCustomer,
    isRegisteringCustomer,
    setIsRegisteringCustomer,
    orderCompanyName,
    setOrderCompanyName,
    newCustomerForm,
    setNewCustomerForm,
    customers,
    totalCustomers,
    hasMore,
    isSearchingCustomers,
    createCustomerMutation,

    // Depot state
    selectedDepot,
    setSelectedDepot,
    setSelectedProduct,
    activeDepots,
    isLoadingDepots,

    // Product state
    selectedProduct,
    orderQuantity,
    setOrderQuantity,

    // Delivery state
    deliveryType,
    setDeliveryType,
    deliveryState,
    setDeliveryState,
    deliveryTown,
    setDeliveryTown,

    // Completion state
    placedOrder,
    paymentInfo,
    createOrderMutation,

    // Handlers
    handleRegisterCustomer,
    handlePlaceOrder,
    handleNextStep,
    handlePrevStep,
    goToStep,
    resetWizard,
  }
}

export type OrderWizardReturn = ReturnType<typeof useOrderWizard>
