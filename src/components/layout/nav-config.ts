import {
  ShieldCheck,
  LogOut,
  GaugeIcon,
  Truck,
  Contact,
  Warehouse,
  Package,
  FileText,
  Users,
  Ticket,
  Fuel,
  Landmark,
  BarChart3,
  Receipt,
  Building2,
  ShoppingBag,
  PlusCircle,
  DollarSign,
  FileSpreadsheet,
  LogIn,
  ClipboardList,
  Flame,
  Percent,
  MessageSquare,
  Store,
  Wallet,
  UserCircle,
  Pencil,
} from "lucide-react";

export type NavItem = {
  title: string;
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  path: string;
};

export type NavCategory = {
  category: string;
  items: NavItem[];
};

// Split out of Sidebar.tsx so it can be reused as the canonical path -> title
// mapping by the admin form's per-user page picker, without tripping the
// fast-refresh "file must only export components" rule on Sidebar.tsx.
export const navCategories: NavCategory[] = [
  {
    category: "", // Top of nav — no header
    items: [
      // { title: "Home", icon: Home, path: "/home" },
      { title: "Overview", icon: GaugeIcon, path: "/overview" },
    ],
  },
  {
    category: "Orders",
    items: [
      { title: "All Orders", icon: ShoppingBag, path: "/orders" },
      { title: "Manage Orders", icon: Pencil, path: "/order-management" },
      { title: "Create Order", icon: PlusCircle, path: "/admin-order" },
      // Two role-specific order views. Both are titled "Orders" upstream;
      // named for their audience here so a SuperAdmin, who sees both, can
      // tell them apart.
      // { title: "Marketing Orders", icon: ShoppingBag, path: "/sales-manager-view" },
      // { title: "Location Orders", icon: ShoppingBag, path: "/product-manager-view" },
      // One entry, because it is one book. Customers and leads were two pages
      // listing the same people from two directions — a lead who signed up
      // appeared on both, and there was no way to see that from either.
      { title: "Customers & Leads", icon: Contact, path: "/people" },
      // { title: "Customer Desk", icon: Contact, path: "/customer-desk" },
    ],
  },
  {
    category: "My Reports",
    items: [
      { title: "My Report", icon: FileText, path: "/my-report" },
      { title: "My Requests", icon: Receipt, path: "/expense-requests" },
      { title: "My Profile", icon: UserCircle, path: "/profile" },
    ],
  },
  {
    category: "Operations",
    items: [
      { title: "Loading Tickets", icon: Ticket, path: "/ticket" },
      { title: "Gate Entry", icon: LogIn, path: "/security/entry" },
      { title: "Gate Exit", icon: LogOut, path: "/security/exit" },
      { title: "Security Report", icon: ClipboardList, path: "/security-report" },
      { title: "Depots", icon: Warehouse, path: "/depots" },
      { title: "Products", icon: Package, path: "/products" },
    ],
  },
  {
    category: "Finance",
    items: [
      // { title: "Verify Payments", icon: ShieldCheck, path: "/payment-verify" },
      { title: "Finance Report", icon: FileSpreadsheet, path: "/confirmed-payments" },
      { title: "Pending Orders", icon: Wallet, path: "/payable-orders" },
      { title: "Deposits", icon: Receipt, path: "/deposits" },
      // { title: "Overpayment Refunds", icon: DollarSign, path: "/overpayment-refunds" },
      // { title: "Transfer Requests", icon: DollarSign, path: "/overpayment-requests" },
      { title: "Customer Commissions", icon: DollarSign, path: "/commissions" },
      { title: "Commission Rates", icon: Percent, path: "/commission-rates" },
      { title: "Bank Accounts", icon: Landmark, path: "/bank-accounts" },
      { title: "Bank Statements", icon: FileSpreadsheet, path: "/bank-statements" },
    ],
  },
  {
    category: "Transport",
    items: [
      { title: "Fleet Directory", icon: Truck, path: "/fleet-trucks" },
      { title: "Fleet Expense Ledger", icon: BarChart3, path: "/fleet-ledger" },
      { title: "Drivers Directory", icon: Contact, path: "/drivers" },
    ],
  },
  {
    category: "LPG Division",
    items: [
      { title: "LPG Division", icon: Flame, path: "/lpg" },
      { title: "LPG Dashboard", icon: GaugeIcon, path: "/lpg/dashboard" },
      { title: "LPG Plants", icon: Warehouse, path: "/lpg/plants" },
      { title: "LPG Stock Register", icon: Package, path: "/lpg/stock" },
      { title: "LPG Sales Register", icon: BarChart3, path: "/lpg/sales" },
    ],
  },
  {
    category: "LPG Home Delivery",
    items: [
      { title: "LPG Stations", icon: Flame, path: "/lpg-stations" },
      { title: "LPG Orders", icon: ShoppingBag, path: "/lpg-orders" },
      { title: "Order Requests", icon: FileText, path: "/lpg-order-request" },
    ],
  },
  {
    category: "Dangote Delivery",
    items: [
      { title: "Dangote Orders", icon: ShoppingBag, path: "/dangote-orders" },
      { title: "Order Requests", icon: FileText, path: "/dangote-order-request" },
      { title: "Dangote Products", icon: Package, path: "/dangote-products" },
      { title: "Licence Verification", icon: ShieldCheck, path: "/licence-verification" },
    ],
  },
  {
    category: "Truck Sales",
    items: [
      // { title: "Delivery Inventory", icon: Package, path: "/delivery-inventory" },
      { title: "Delivery Operations", icon: Truck, path: "/delivery-operations" },
      { title: "Delivery Customers", icon: Users, path: "/delivery-customer" },
      { title: "Sales Ledger", icon: BarChart3, path: "/sales-ledger" },
      { title: "Filling Stations", icon: Fuel, path: "/filing-stations" },
    ],
  },
  {
    category: "Admin",
    items: [
      { title: "Reports Hub", icon: FileSpreadsheet, path: "/admin-reports" },
      { title: "Messaging", icon: FileText, path: "/messaging" },
      // { title: "Assign PFI", icon: FileText, path: "/orders-pfi" },
      { title: "Product Pricing", icon: Fuel, path: "/product-pricing" },
      { title: "PFI Tracking", icon: FileText, path: "/pfi" },
      { title: "Expenses", icon: Receipt, path: "/expenses" },
      { title: "Vendors", icon: Store, path: "/vendors" },
      // { title: "Stock Management", icon: Package, path: "/inventory" },
      // { title: "Users Log", icon: ClipboardList, path: "/order-audit" },
      { title: "Manage Users", icon: Users, path: "/admin" },
    ],
  },
  {
    category: "Feedback",
    items: [{ title: "Feedback & Reviews", icon: MessageSquare, path: "/feedback-dashboard" }],
  },
];
