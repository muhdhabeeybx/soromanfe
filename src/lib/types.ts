export interface AdminUser {
  id: string
  email: string
  firstName: string
  surname: string
  otherNames?: string
  phoneNumber?: string
  roles: string[]
  isActive: boolean
  suspended: boolean
  isPasswordSet: boolean
  profilePicture?: {
    url: string
    publicId: string
  }
  profilePictureUrl?: string
  profilePicturePublicId?: string
  lastLoginAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface Customer {
  _id: string
  name: string
  email: string
  phone: string
  companyName: string
  address: string
  status: 'Active' | 'Inactive'
  marketingOptOut?: boolean
  balance: string | number
  deposit: string | number
  previousDeposit: string | number
  paystackCustomerId?: string
  virtualAccountNumber?: string
  virtualAccountBank?: string
  virtualAccountName?: string
  dvaSubaccountCode?: string
  createdAt?: string
  updatedAt?: string
}

export interface CustomerLicense {
  id: number
  customerId: number
  companyName: string
  licenseUrl: string
  licensePublicId: string
  expiryDate: string | null
  status: 'pending' | 'approved' | 'rejected'
  verifiedBy: number | null
  verifiedByName: string
  verifiedAt: string | null
  verificationComment: string
  createdAt: string
  updatedAt: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerCompanyName?: string
}

export interface Truck {
  _id: string
  plateNumber: string
  model: string
  capacity: string
  status: 'In Transit' | 'Idle' | 'Maintenance'
  currentDriverId?: number | null
  driverName?: string | null
  driverPhone?: string | null
  driverLicense?: string | null
  fuelLevel: number
  mileage: string
  vin?: string
  year?: number
  make?: string
  type?: string
  insuranceExpiry?: string
  registrationExpiry?: string
  nextServiceMileage?: number
  previousDrivers?: {
    id: number
    driverId: number
    driverName: string
    assignedAt: string
  }[]
  createdAt?: string
  updatedAt?: string
}

export interface Driver {
  _id: string
  name: string
  email: string
  phone: string
  licenseNumber: string
  licenseClass: string
  rating: number
  status: 'Active' | 'On Trip' | 'Off Duty'
  assignedTruckId?: number | null
  assignedTruckPlate?: string | null
  assignedTruckModel?: string | null
  previousTrucks?: {
    id: number
    truckId: number
    truckPlate: string
    assignedAt: string
  }[]
  safetyScore: number
  licenseExpiry?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface Product {
  _id: string
  name: string
  sku: string
  category: string
  productType?: string
  gradeClass?: string
  description?: string
  density?: string
  flashPoint?: string
  unNumber?: string
  hazardClass?: string
  unit?: string
  supplier?: string
  createdAt?: string
  updatedAt?: string
}

export interface ProductCapacity {
  id: number
  productId: number
  capacity: number
  productName?: string | null
  productSku?: string | null
}

export interface ProductPrice {
  id: number
  productId: number
  currentPrice: string | number
  productName?: string | null
  productSku?: string | null
}

export interface Depot {
  _id: string
  name: string
  code: string
  address: string
  city: string
  state: string
  country: string
  postcode: string
  status: 'Active' | 'Maintenance' | 'High Capacity'
  establishedYear: string
  productCapacities: ProductCapacity[]
  productPrices: ProductPrice[]
  staff: {
    id: number
    adminId: number
    firstName: string | null
    surname: string | null
    email: string | null
  }[]
  paystackSubaccountCode?: string
  subaccountActive?: boolean
  subaccountSplitPercentage?: number
  createdAt?: string
  updatedAt?: string
}

export interface DepotItem {
  id: string
  name: string
  code: string
  address: string
  city: string
  state: string
  country: string
  postcode: string
  maxCapacity?: number
  status: string
  establishedYear: string
  productCapacities: ProductCapacity[]
  productPrices: ProductPrice[]
  staff: {
    id: number
    adminId: number
    firstName: string | null
    surname: string | null
    email: string | null
  }[]
  paystackSubaccountCode?: string
  subaccountActive?: boolean
  subaccountSplitPercentage?: number
}

export interface LpgStationCylinder {
  id?: string
  cylinderSizeKg: number
  quantity: number
}

export interface LpgPriceHistoryEntry {
  id: number
  lpgStationId: number
  pricePerKg: string
  setAt: string
}

export interface LpgStation {
  _id: string
  name: string
  code: string
  address: string
  city: string
  state: string
  country: string
  postcode: string
  lpgCapacityKg: number
  pricePerKg: number
  status: 'Active' | 'Maintenance' | 'High Capacity'
  establishedYear: string
  staff: {
    id: number
    adminId: number
    firstName: string | null
    surname: string | null
    email: string | null
  }[]
  pfis?: Pfi[]
  cylinders?: LpgStationCylinder[]
  priceHistory?: LpgPriceHistoryEntry[]
  paystackSubaccountCode?: string
  subaccountActive?: boolean
  subaccountSplitPercentage?: number
  createdAt?: string
  updatedAt?: string
}

export interface LpgStationItem {
  id: string
  name: string
  code: string
  address: string
  city: string
  state: string
  country: string
  postcode: string
  lpgCapacityKg: number
  pricePerKg: number
  status: string
  establishedYear: string
  staff: {
    id: number
    adminId: number
    firstName: string | null
    surname: string | null
    email: string | null
  }[]
  pfis?: Pfi[]
  cylinders?: LpgStationCylinder[]
  priceHistory?: LpgPriceHistoryEntry[]
  paystackSubaccountCode?: string
  subaccountActive?: boolean
  subaccountSplitPercentage?: number
}

export interface Pfi {
  _id: string
  id?: string | number
  pfiNumber: string
  status: 'active' | 'finished'
  description?: string
  pfiDate?: string | null
  locationId?: number | null
  lpgStationId?: number | null
  locationName?: string
  productId?: number | null
  productName?: string
  productUnit?: string
  startingQtyLitres?: number
  blQtyLitres?: number | null
  blQtyMt?: number | null
  qtyVolumeMt?: number
  soldQtyLitres?: number
  totalAmount?: string | number
  unitPrice?: string | number
  creditBalance?: string | number
  auditOfficerId?: number | null
  auditOfficerName?: string
  productOfficerId?: number | null
  productOfficerName?: string
  itComplianceOfficerId?: number | null
  itComplianceOfficerName?: string
  securityExitOfficerId?: number | null
  securityExitOfficerName?: string
  commissionOfficerId?: number | null
  commissionOfficerName?: string
  salesManagerId?: number | null
  salesManagerName?: string
  vesselBroker?: string
  vesselName?: string
  surveyorName?: string
  surveyorPhone?: string
  closureDate?: string | null
  totalInflow?: string | number
  closureBank?: string
  purchaseCost?: string | number
  aggregateExpenses?: string | number
  closureHandler?: string
  closureRemarks?: string
  createdAt?: string
  updatedAt?: string
}

export interface Order {
  _id: string
  orderNumber: string
  customerId: number
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerCompanyName?: string
  customerBalance?: string | number
  state: string
  depotId: number
  depotName?: string
  depotCode?: string
  depotAddress?: string
  productId: number
  productName?: string
  productSku?: string
  productUnit?: string
  productCategory?: string
  quantity: number
  price: string | number
  totalAmount: string | number
  deliveryType: 'delivery' | 'pickup'
  pfiId?: number | null
  pfiNumber?: string | null
  virtualAccountNumber?: string
  virtualAccountBank?: string
  virtualAccountName?: string
  paymentStatus: 'Unpaid' | 'Paid'
  /** Matches the order_status enum in the database, not a subset of it. */
  status: 'Pending' | 'Paid' | 'Released' | 'Loading' | 'Completed' | 'Cancelled' | 'Expired'
  /** Computed deadline: when this Pending/unpaid order will expire. Null for non-expirable orders. */
  expiresAt?: string | null
  expiredAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface PaystackDetails {
  transactionId?: number | null
  domain?: string | null
  status?: string | null
  reference?: string | null
  amount?: number | null
  currency?: string | null
  channel?: string | null
  gatewayResponse?: string | null
  message?: string | null
  paidAt?: string | null
  createdAt?: string | null
  fees?: number | null
  feesSplit?: unknown | null
  senderBankName?: string | null
  senderAccountNumber?: string | null
  senderName?: string | null
  senderCountry?: string | null
  senderNarration?: string | null
  receiverBankName?: string | null
  receiverAccountNumber?: string | null
  receiverAccountName?: string | null
  authorizationCode?: string | null
  bin?: string | null
  last4?: string | null
  cardType?: string | null
  bank?: string | null
  ipAddress?: string | null
  metadata?: unknown | null
  paystackCustomerCode?: string | null
  paystackCustomerEmail?: string | null
  rawEvent?: string | null
}

export interface Deposit {
  _id: string
  customerId: number
  customerName?: string
  customerPhone?: string
  customerCompanyName?: string
  amount: string | number
  type: 'credit' | 'debit'
  description: string
  reference: string
  recordedBy?: number | null
  recorderFirstName?: string | null
  recorderSurname?: string | null
  recorderEmail?: string | null
  balanceAfter: string | number
  paystackDetails?: PaystackDetails | null
  createdAt?: string
  updatedAt?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    total: number
    page: number
    pages: number
  }
}

export interface CollectionAccount {
  accountName: string
  accountNumber: string
  bankName: string
  isPrimary: boolean
  isActive: boolean
}

export interface FilingStation {
  _id: string
  customerCode?: string
  name: string
  contactPerson?: string
  contactPersonPhone?: string
  phoneNumber?: string
  altPhoneNumber?: string
  email?: string
  stationAddress?: string
  tankCapacity?: number
  pumpCount?: number
  bankDetails?: {
    bankName?: string
    accountName?: string
    accountNumber?: string
  }
  paystackCustomerId?: string
  virtualAccountNumber?: string
  virtualAccountBank?: string
  virtualAccountName?: string
  creditLimit?: string | number
  status: 'active' | 'dormant' | 'suspended'
  notes?: string
  lastTransactionDate?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface DeliveryCustomer {
  _id: string
  id?: string
  customerType: 'customer' | 'filling_station'
  customerCode?: string
  name: string
  phoneNumber: string
  altPhoneNumber?: string
  email?: string
  homeAddress?: string
  officeAddress?: string
  passportPhoto?: string
  contactPerson?: string
  contactPersonPhone?: string
  stationAddress?: string
  tankCapacity?: number
  pumpCount?: number
  bankDetails?: {
    bankName?: string
    accountName?: string
    accountNumber?: string
  }
  paystackCustomerId?: string
  virtualAccountNumber?: string
  virtualAccountBank?: string
  virtualAccountName?: string
  creditLimit?: string | number
  status: 'active' | 'dormant' | 'suspended'
  notes?: string
  lastTransactionDate?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Re-exported so DeliverySale can name it without importing across modules. */
export type DepositChannel = 'pos' | 'bank_deposit'

export interface DeliverySale {
  _id: string
  id?: string
  truckNumber: string
  dateLoaded: string
  depotLoaded: string
  customerId: string | number | null
  customerName?: string
  location: string
  quantity: number
  rate: string | number
  salesValue: string | number
  paymentAmount: string | number
  expensesAmount?: string | number
  balance: string | number
  payerName: string
  /** Free text as recorded — "1311924986 · Zenith Bank". Still the only bank record older rows have. */
  bank: string
  /** The managed account, on entries written since the ledger started linking them. */
  bankAccountId?: number | null
  /** How the money reached the bank. Null on every row that predates the split, and on rows that are not remittances. */
  depositChannel?: DepositChannel | null
  /**
   * The two legs of an overpayment moved between trucks share this id. Null
   * on an ordinary payment — a transfer is a pair of rows, one negative on
   * the truck the surplus left and one positive where it landed.
   */
  transferGroupId?: string | null
  /** The other truck and customer — "BWR810XB · Musa Damaturu". */
  transferCounterparty?: string | null
  dateOfPayment: string | null
  depositStatus?: 'pending' | 'partial' | 'paid' | string
  phoneNumber: string
  remarks: string
  enteredBy?: string
  allocationCode?: string | null
  collectionAccounts?: AccountEntry[] | null
  remittanceAccounts?: AccountEntry[] | null
  paymentMethod?: 'manual' | 'paystack_dva'
  paystackReference?: string | null
  paystackDetails?: Record<string, unknown> | null
  createdAt?: string
  updatedAt?: string
}

export interface DeliveryInventory {
  _id: string
  id?: string
  truckId: number | null
  truckNumber?: string
  pfiId: number | null
  pfiNumber?: string
  pfiProduct?: string
  depot?: string
  customerId: string | number | null
  customerName?: string
  quantityAllocated: number
  rate?: string | number
  dateAllocated: string
  dateOffloaded?: string | null
  loadingStatus?: 'loaded' | 'offloaded' | 'empty'
  location?: string
  pfiLocation?: string
  allocationCode?: string | null
  notes?: string
  createdBy?: string
  offloadedBy?: string
  collectionAccounts?: AccountEntry[] | null
  remittanceAccounts?: AccountEntry[] | null
  createdAt?: string
  updatedAt?: string
}

export interface AccountEntry {
  name: string
  bank: string
  number: string
}

export interface BankAccount {
  id: string | number
  bankName: string
  accountName: string
  accountNumber: string
  bankCode?: string
  branchName?: string
  currency: string
  status: 'Active' | 'Inactive' | 'Suspended'
  isDefault: boolean
  /** The PFIs that collect into this account — the assignment that matters. */
  pfiIds: (string | number)[]
  /** Derived server-side from the locations of `pfiIds`. Never sent by a client. */
  depotIds: (string | number)[]
  depots?: Array<{
    id: string | number
    name: string
    code: string
    city?: string
    state?: string
    country?: string
    status?: string
  }>
  lpgStationIds?: (string | number)[]
  lpgStations?: Array<{
    id: string | number
    name: string
    code: string
    city?: string
    state?: string
    country?: string
    status?: string
  }>
  /** Areas allowed to collect into this account — see BANK_ACCOUNT_USAGE. */
  usage?: string[]
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export interface Vendor {
  id: string | number
  name: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  taxId?: string
  status: 'Active' | 'Inactive'
  createdAt?: string
  updatedAt?: string
}

export interface VendorSummary {
  expenseCount: number
  totalRequested: number
  totalApproved: number
  totalPaid: number
  outstanding: number
  lastPaymentDate: string | null
}

export interface VendorExpenseRow {
  id: string | number
  reference_number: string
  expense_date: string
  description: string
  amount: number
  amount_paid: number | null
  bank_paid_from: string
  status: string
  category_name: string
  gl_code: string | null
  pfi_number: string | null
}

export interface CommissionRate {
  id: number
  depotId: number
  depotName: string
  depotCity?: string
  depotState?: string
  productId: number
  productName: string
  productSku?: string
  commissionRate: number
  createdAt?: string
  updatedAt?: string
}

export interface Commission {
  id: number
  orderId: number
  orderNumber: string
  orderCreatedAt?: string
  customerId: number
  customerName: string
  customerPhone?: string
  customerCompanyName?: string
  customerCommissionBankName?: string
  customerCommissionAccountName?: string
  customerCommissionAccountNumber?: string
  depotId: number
  depotName: string
  depotCity?: string
  depotState?: string
  productId: number
  productName: string
  productSku?: string
  quantity: number
  commissionRate: number
  commissionAmount: number
  status: 'pending' | 'paid'
  paidAt?: string | null
  paidBy?: number | null
  paidByName?: string | null
  trucks?: { truckNumber: string; quantity: number }[]
  createdAt?: string
}

export interface CommissionSummary {
  totalOrders: number
  totalQuantity: number
  pendingAmount: number
  paidAmount: number
}

