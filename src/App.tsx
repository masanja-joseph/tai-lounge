import { cn } from "./lib/utils";
import { 
  ShoppingCart, 
  Utensils, 
  ListOrdered, 
  GlassWater, 
  Search,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  PlusCircle,
  X,
  CheckCircle2,
  AlertCircle,
  ChefHat,
  Send,
  Save,
  ArrowRightLeft,
  Users,
  Clock,
  Check,
  ChevronUp,
  ChevronDown,
  ShoppingBag,
  Settings
} from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLogin from "./components/StaffLogin";
import BrandingSettings from "./components/BrandingSettings";

interface Category {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  costPrice?: number | null;
  stockQuantity: number;
  unitOfMeasure: string;
  station: string;
  imageUrl?: string | null;
  category: Category;
}

interface Table {
  id: string;
  tableNumber: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  section: {
    id: string;
    name: string;
    code: string;
    isVip: boolean;
  };
  activeOrder?: {
    id: string;
    orderNumber: string;
    customerName?: string | null;
    total: number;
    status: string;
    openedAt: string;
    items?: Array<{ id: string; productName: string; quantity: number; station: string }>;
  } | null;
}

interface Section {
  id: string;
  name: string;
  code: string;
  isVip: boolean;
  tables: Table[];
}

interface OrderItem {
  id?: string;
  productId: string;
  productName: string;
  sku?: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  station: string;
  specialInstructions?: string | null;
  status?: string;
  isPreparationSubmitted?: boolean;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  serviceType: string;
  tableId?: string | null;
  tableNumber?: string | null;
  customerName?: string | null;
  guestCount: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string | null;
  openedAt: string;
  items: OrderItem[];
  table?: Table | null;
  tickets?: Array<{ id: string; ticketNumber: string; station: string; status: string }>;
}

interface PreparationTicket {
  id: string;
  ticketNumber: string;
  station: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  order: {
    orderNumber: string;
    tableNumber?: string | null;
    customerName?: string | null;
  };
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    specialInstructions?: string | null;
    status: string;
  }>;
}

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  method: string;
  provider?: string | null;
  reference?: string | null;
  status: string;
  createdAt: string;
}

export default function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"POS" | "Tables" | "Orders" | "Tickets" | "Products" | "Branding">("POS");
  const [isStaffLoggedIn, setIsStaffLoggedIn] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Mobile Cart Bottom Sheet State
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  // Active POS Order State
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [currentOrderNumber, setCurrentOrderNumber] = useState<string>("New Tab");
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [serviceType, setServiceType] = useState<string>("DINE_IN");
  const [customerName, setCustomerName] = useState<string>("");
  const [cart, setCart] = useState<OrderItem[]>([]);
  
  // Modals & UI States
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [transferTargetTableId, setTransferTargetTableId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [ticketFilterStation, setTicketFilterStation] = useState<string>("ALL");
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New product form
  const [productForm, setProductForm] = useState({
    name: "",
    price: "",
    categoryId: "",
    stockQuantity: "50",
    unitOfMeasure: "Bottle",
    station: "BAR",
  });

  if (!isStaffLoggedIn) {
    return <StaffLogin branding={branding} onLoginSuccess={() => setIsStaffLoggedIn(true)} />;
  }

  const showNotification = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // 0. Fetch Branding
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: async () => {
      const res = await fetch('/api/branding');
      if (!res.ok) return null;
      return res.json();
    },
  });

  // 1. Fetch Categories
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch('/api/categories');
      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
  });

  // 2. Fetch Products
  const { data: products = [], isLoading: isLoadingProducts, isFetching: isFetchingProducts, refetch: refetchProducts } = useQuery<Product[]>({
    queryKey: ['products', selectedCategory, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory !== 'All') params.set('category', selectedCategory);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
  });

  // 3. Fetch Tables & Sections
  const { data: tables = [], refetch: refetchTables } = useQuery<Table[]>({
    queryKey: ['tables'],
    queryFn: async () => {
      const res = await fetch('/api/tables');
      if (!res.ok) throw new Error('Failed to fetch tables');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ['sections'],
    queryFn: async () => {
      const res = await fetch('/api/sections');
      if (!res.ok) throw new Error('Failed to fetch sections');
      return res.json();
    },
  });

  // 4. Fetch Active Orders
  const { data: activeOrders = [], refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ['orders', 'active'],
    queryFn: async () => {
      const res = await fetch('/api/orders?status=active');
      if (!res.ok) throw new Error('Failed to fetch active orders');
      return res.json();
    },
    refetchInterval: 5000,
  });

  // 5. Fetch Preparation Tickets
  const { data: tickets = [], refetch: refetchTickets } = useQuery<PreparationTicket[]>({
    queryKey: ['tickets', ticketFilterStation],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ticketFilterStation !== 'ALL') params.set('station', ticketFilterStation);
      params.set('status', 'active');
      const res = await fetch(`/api/tickets?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch tickets');
      return res.json();
    },
    refetchInterval: 4000,
  });

  // ----------------------------------------------------
  // MUTATIONS (API ACTIONS)
  // ----------------------------------------------------

  // Save / Open Order in Database
  const saveOrderMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error('Please add at least one item to save the order.');

      if (currentOrderId) {
        const newItems = cart.filter(item => !item.id);
        if (newItems.length > 0) {
          const res = await fetch(`/api/orders/${currentOrderId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: newItems.map(i => ({
                productId: i.productId,
                quantity: i.quantity,
                specialInstructions: i.specialInstructions,
              })),
            }),
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to add items to existing tab');
          }
        }
        return { id: currentOrderId, orderNumber: currentOrderNumber };
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: selectedTable?.id || null,
          serviceType: selectedTable?.section?.isVip ? 'VIP' : serviceType,
          customerName: customerName || null,
          items: cart.map(i => ({
            productId: i.productId,
            quantity: i.quantity,
            specialInstructions: i.specialInstructions,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save order in database');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setCurrentOrderId(data.id);
      setCurrentOrderNumber(data.orderNumber);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      showNotification('success', `Order ${data.orderNumber} saved to database!`);
    },
    onError: (err: any) => {
      showNotification('error', err.message);
    },
  });

  // Send Order Items to Bar & Kitchen
  const sendToPrepMutation = useMutation({
    mutationFn: async () => {
      let orderId = currentOrderId;

      if (!orderId) {
        if (cart.length === 0) throw new Error('Cannot send empty order to bar/kitchen.');
        const createRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: selectedTable?.id || null,
            serviceType: selectedTable?.section?.isVip ? 'VIP' : serviceType,
            customerName: customerName || null,
            items: cart.map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              specialInstructions: i.specialInstructions,
            })),
          }),
        });
        if (!createRes.ok) {
          const err = await createRes.json();
          throw new Error(err.error || 'Failed to initialize order before sending');
        }
        const created = await createRes.json();
        orderId = created.id;
        setCurrentOrderId(created.id);
        setCurrentOrderNumber(created.orderNumber);
      }

      const res = await fetch(`/api/orders/${orderId}/send-to-preparation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverNotes: 'Expedited from POS terminal' }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send items to bar/kitchen');
      }

      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      showNotification('success', data.message || 'Items routed to Bar and Kitchen!');
      if (currentOrderId) {
        loadOrderIntoPOS(currentOrderId);
      }
    },
    onError: (err: any) => {
      showNotification('error', err.message);
    },
  });

  // Transfer Table Mutation
  const transferTableMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrderId) throw new Error('No active order selected to transfer.');
      if (!transferTargetTableId) throw new Error('Please select a destination table.');

      const res = await fetch(`/api/orders/${currentOrderId}/transfer-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTableId: transferTargetTableId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to transfer table');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowTransferModal(false);
      setTransferTargetTableId("");
      setSelectedTable(data.table);
      showNotification('success', `Order successfully transferred to ${data.tableNumber}!`);
    },
    onError: (err: any) => {
      showNotification('error', err.message);
    },
  });

  // Ticket Status Progression Mutation
  const updateTicketStatusMutation = useMutation({
    mutationFn: async ({ ticketId, newStatus }: { ticketId: string; newStatus: string }) => {
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update ticket status');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      showNotification('success', `Ticket ${data.ticketNumber} marked as ${data.status}`);
    },
    onError: (err: any) => {
      showNotification('error', err.message);
    },
  });

  // Process Payment Mutation
  const processPaymentMutation = useMutation({
    mutationFn: async (data: { amount: number; method: string; provider?: string; reference?: string; idempotencyKey?: string }) => {
      if (!currentOrderId) throw new Error('No active order selected.');
      const res = await fetch(`/api/orders/${currentOrderId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to process payment');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['payments', currentOrderId] });
      showNotification('success', 'Payment processed successfully!');
      if (currentOrderId) {
        fetch(`/api/orders/${currentOrderId}`).then(res => res.json()).then(order => {
            setSelectedOrder(order);
            setShowReceiptModal(true);
            loadOrderIntoPOS(currentOrderId);
        });
      }
    },
    onError: (err: any) => {
      showNotification('error', err.message);
    },
  });

  // Load Existing Tab into POS
  const loadOrderIntoPOS = async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error('Could not load order details');
      const order: Order = await res.json();

      setCurrentOrderId(order.id);
      setCurrentOrderNumber(order.orderNumber);
      setSelectedTable(order.table || null);
      setServiceType(order.serviceType);
      setCustomerName(order.customerName || "");
      
      setCart(order.items.map(i => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        subtotal: i.subtotal,
        station: i.station,
        specialInstructions: i.specialInstructions,
        status: i.status,
        isPreparationSubmitted: i.isPreparationSubmitted,
      })));

      setActiveTab("POS");
      showNotification('success', `Tab ${order.orderNumber} loaded into POS terminal.`);
    } catch (err: any) {
      showNotification('error', err.message);
    }
  };

  // Reset to New Tab
  const resetPOS = () => {
    setCurrentOrderId(null);
    setCurrentOrderNumber("New Tab");
    setSelectedTable(null);
    setCustomerName("");
    setCart([]);
    showNotification('success', 'Ready for new order.');
  };

  // Cart operations
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item => item.productId === product.id ? { 
          ...item, 
          quantity: item.quantity + 1,
          subtotal: item.unitPrice * (item.quantity + 1)
        } : item);
      }
      return [...prev, {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: product.price,
        quantity: 1,
        subtotal: product.price,
        station: product.station,
        specialInstructions: null,
      }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { 
          ...item, 
          quantity: newQty,
          subtotal: item.unitPrice * newQty 
        } : null;
      }
      return item;
    }).filter(Boolean) as OrderItem[]);
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax;
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const navigationItems = [
    { id: "POS", label: "POS", icon: ShoppingCart },
    { id: "Tables", label: "Tables", icon: Utensils, badge: tables.filter(t => t.status === 'OCCUPIED').length },
    { id: "Orders", label: "Orders", icon: ListOrdered, badge: activeOrders.length },
    { id: "Tickets", label: "Bar/Kitchen", icon: ChefHat, badge: tickets.length },
    { id: "Products", label: "Catalog", icon: GlassWater },
    { id: "Branding", label: "Branding", icon: Settings },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-950 text-slate-100 font-sans selection:bg-rose-500 selection:text-white overflow-hidden">
      {/* Toast Notification */}
      {feedbackMsg && (
        <div className={cn(
          "fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-xs md:text-sm font-medium animate-in fade-in slide-in-from-top-2 border",
          feedbackMsg.type === 'success' 
            ? "bg-emerald-950 border-emerald-600 text-emerald-200" 
            : "bg-rose-950 border-rose-600 text-rose-200"
        )}>
          {feedbackMsg.type === 'success' ? <CheckCircle2 size={18} className="text-emerald-400 shrink-0" /> : <AlertCircle size={18} className="text-rose-400 shrink-0" />}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* DESKTOP SIDEBAR (Visible only on md: screens and larger) */}
      <aside className="hidden md:flex md:w-64 bg-slate-900 p-6 flex-col border-r border-slate-800 justify-between shrink-0 z-30">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center font-bold text-slate-950 text-lg shadow-md">
              TL
            </div>
            <div>
              <BrandLogo url={branding?.logoUrl} name={branding?.name || 'Tai Lounge'} size={150} className="text-xl" />
            </div>
          </div>

          <nav className="space-y-1.5">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 rounded-xl transition text-sm font-medium",
                  activeTab === item.id 
                    ? "bg-rose-600 text-white shadow-lg shadow-rose-950/40" 
                    : "text-slate-400 hover:bg-slate-800/80 hover:text-white"
                )}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                    activeTab === item.id ? "bg-white text-rose-700" : "bg-slate-800 text-amber-400"
                  )}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-4 border-t border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center justify-between mb-1">
            <span>Database:</span>
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Neon PostgreSQL
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Currency:</span>
            <span className="font-mono text-slate-300">TZS (Tanzania)</span>
          </div>
        </div>
      </aside>

      {/* MAIN VIEWPORT AREA */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* TAB 1: POS TERMINAL */}
        {activeTab === "POS" && (
          <main className="flex-1 p-3 md:p-6 overflow-y-auto flex flex-col pb-36 md:pb-6">
            {/* Header: Clean branding and actions */}
            <header className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <BrandLogo url={branding?.logoUrl} name={branding?.name || 'Tai Lounge'} size={150} className="text-2xl" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowTablePicker(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-amber-500 text-slate-200 transition text-xs font-semibold shadow-sm"
                  >
                    <Utensils size={13} className="text-amber-400 shrink-0" />
                    <span className="truncate max-w-[110px] sm:max-w-none">
                      {selectedTable ? selectedTable.tableNumber : "Table / VIP"}
                    </span>
                  </button>

                  <button
                    onClick={() => setShowAddProductModal(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition shrink-0 shadow-sm"
                  >
                    <PlusCircle size={14} />
                    <span className="hidden sm:inline">New Item</span>
                  </button>
                </div>
              </div>

              {/* Search Bar & Refresh */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search drinks & food..."
                    className="bg-slate-900 border border-slate-800 pl-9 pr-8 py-2 rounded-xl focus:outline-none focus:border-amber-500 w-full text-xs md:text-sm text-slate-100 placeholder:text-slate-500 transition"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => refetchProducts()}
                  title="Refresh Products"
                  className={cn(
                    "p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition shrink-0",
                    isFetchingProducts && "animate-spin text-amber-500"
                  )}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </header>

            {/* Categories Filter Pills */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-none shrink-0">
              <button 
                onClick={() => setSelectedCategory("All")}
                className={cn(
                  "px-3.5 py-1.5 rounded-full border transition whitespace-nowrap text-xs font-medium",
                  selectedCategory === "All"
                    ? "bg-rose-600 border-rose-500 text-white shadow-md shadow-rose-950/40"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                )}
              >
                All
              </button>
              {categories.map((cat) => (
                <button 
                  key={cat.id} 
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-full border transition whitespace-nowrap text-xs font-medium",
                    selectedCategory === cat.slug
                      ? "bg-rose-600 border-rose-500 text-white shadow-md shadow-rose-950/40"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Product Cards Grid — FULL VIEWPORT SPACE FOR PHONES */}
            {isLoadingProducts ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800 animate-pulse h-36" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/20 my-auto">
                <GlassWater className="w-10 h-10 text-slate-600 mb-2" />
                <h3 className="font-semibold text-slate-300 text-sm">No items found</h3>
                <p className="text-xs text-slate-500 mt-1">Try another category or add a new product.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 pb-32 md:pb-6">
                {products.map((product) => (
                  <div 
                    key={product.id} 
                    onClick={() => addToCart(product)}
                    className="group bg-slate-900/90 p-2.5 rounded-2xl border border-slate-800 hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-950/20 transition cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="h-20 sm:h-24 md:h-28 bg-slate-800 rounded-xl mb-2 overflow-hidden relative">
                        {product.imageUrl ? (
                          <img 
                            src={product.imageUrl} 
                            alt={product.name} 
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300" 
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-600 group-hover:text-amber-500 transition">
                            <GlassWater size={24} />
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono mt-0.5">
                              {product.category?.name}
                            </span>
                          </div>
                        )}
                        <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold bg-slate-950/80 text-slate-300">
                          {product.station}
                        </span>
                        <span className={cn(
                          "absolute top-1 right-1 px-1 py-0.5 rounded text-[8px] font-semibold",
                          product.stockQuantity <= 5 ? "bg-rose-950 text-rose-300" : "bg-slate-950/80 text-emerald-400"
                        )}>
                          {product.stockQuantity} left
                        </span>
                      </div>

                      <h3 className="font-semibold text-xs sm:text-sm text-slate-100 group-hover:text-amber-400 transition truncate leading-snug">
                        {product.name}
                      </h3>
                      <p className="text-[10px] text-slate-500 truncate">{product.unitOfMeasure}</p>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-800/60">
                      <span className="text-amber-500 font-bold text-xs sm:text-sm tabular-nums">
                        {product.price.toLocaleString()} <span className="text-[9px] font-normal text-amber-500/70">TZS</span>
                      </span>
                      <div className="w-6 h-6 rounded-lg bg-slate-800 group-hover:bg-rose-600 flex items-center justify-center text-slate-400 group-hover:text-white transition">
                        <Plus size={12} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        )}
        {/* TAB BRANDING: SETTINGS */}
        {activeTab === "Branding" && (
          <main className="flex-1 p-6 overflow-y-auto">
            <BrandingSettings />
          </main>
        )}
        {activeTab === "Tables" && (
          <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-36 md:pb-6">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">Lounge Floor Plan</h2>
                <p className="text-xs text-slate-400">View live table occupancy and manage table orders</p>
              </div>
              <button 
                onClick={() => refetchTables()} 
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="space-y-5">
              {sections.map((section) => (
                <div key={section.id} className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm md:text-base text-slate-100">{section.name}</h3>
                      {section.isVip && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          VIP Section
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">
                      {section.tables.filter(t => t.status === 'OCCUPIED').length} / {section.tables.length} Occupied
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {section.tables.map((table) => {
                      const isOccupied = table.status === 'OCCUPIED';
                      return (
                        <div
                          key={table.id}
                          className={cn(
                            "p-3 rounded-xl border transition flex flex-col justify-between",
                            isOccupied
                              ? "bg-slate-800/90 border-amber-500/40 shadow-md"
                              : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                          )}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-xs sm:text-sm text-slate-100">{table.tableNumber}</span>
                              <span className={cn(
                                "flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full",
                                isOccupied ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"
                              )}>
                                <span className={cn("w-1.5 h-1.5 rounded-full", isOccupied ? "bg-amber-400" : "bg-emerald-400")} />
                                {table.status}
                              </span>
                            </div>

                            <p className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Users size={11} /> {table.capacity} Seats
                            </p>

                            {isOccupied && table.activeOrder && (
                              <div className="mt-2 pt-1.5 border-t border-slate-700/60 text-xs">
                                <p className="font-mono text-amber-400 font-semibold text-[11px]">{table.activeOrder.orderNumber}</p>
                                <p className="font-mono text-slate-300 font-bold mt-0.5 text-xs">
                                  {table.activeOrder.total.toLocaleString()} TZS
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="mt-2.5 pt-1.5">
                            {isOccupied && table.activeOrder ? (
                              <button
                                onClick={() => loadOrderIntoPOS(table.activeOrder!.id)}
                                className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition"
                              >
                                Open Tab
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedTable(table);
                                  setActiveTab("POS");
                                  showNotification('success', `Assigned ${table.tableNumber} to active POS`);
                                }}
                                className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
                              >
                                Start Order
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </main>
        )}

        {/* TAB 3: ACTIVE ORDERS LIST */}
        {activeTab === "Orders" && (
          <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-36 md:pb-6">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">Active Lounge Tabs</h2>
                <p className="text-xs text-slate-400">Open orders, active bills, and kitchen/bar tickets</p>
              </div>
              <button onClick={() => refetchOrders()} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                <RefreshCw size={16} />
              </button>
            </div>

            {activeOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
                <ListOrdered className="w-12 h-12 text-slate-600 mb-2" />
                <h3 className="font-semibold text-slate-300">No active orders</h3>
                <p className="text-xs text-slate-500 mt-1">Start a new order from the POS or Tables tab.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {activeOrders.map((ord) => (
                  <div key={ord.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-base text-amber-400 font-mono">{ord.orderNumber}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-600/20 text-rose-300 border border-rose-600/30">
                          {ord.status}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 font-semibold mb-1">
                        {ord.tableNumber || ord.serviceType} {ord.customerName ? `· ${ord.customerName}` : ""}
                      </p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Clock size={12} /> Opened {new Date(ord.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>

                      <div className="mt-3 pt-2 border-t border-slate-800 space-y-1 text-xs">
                        <div className="flex justify-between text-slate-400">
                          <span>Items ({ord.items.length})</span>
                          <span className="font-mono">{ord.items.reduce((s, i) => s + i.quantity, 0)} pcs</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-100 pt-1">
                          <span>Balance Due</span>
                          <span className="font-mono text-amber-400">{ord.balanceDue.toLocaleString()} TZS</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex gap-2">
                      <button
                        onClick={() => loadOrderIntoPOS(ord.id)}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition"
                      >
                        Open in POS
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        )}

        {/* TAB 4: BAR & KITCHEN TICKETS */}
        {activeTab === "Tickets" && (
          <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-36 md:pb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">Preparation Tickets</h2>
                <p className="text-xs text-slate-400">Live order queue for Bar and Kitchen stations</p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {['ALL', 'BAR', 'KITCHEN'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setTicketFilterStation(st)}
                    className={cn(
                      "flex-1 sm:flex-none px-3 py-1.5 rounded-xl text-xs font-semibold border transition",
                      ticketFilterStation === st
                        ? "bg-rose-600 border-rose-500 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                    )}
                  >
                    {st === 'ALL' ? 'All' : st}
                  </button>
                ))}
                <button onClick={() => refetchTickets()} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {tickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
                <ChefHat className="w-12 h-12 text-slate-600 mb-2" />
                <h3 className="font-semibold text-slate-300">No active tickets</h3>
                <p className="text-xs text-slate-500 mt-1">Send drinks or food from the POS terminal to populate this queue.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {tickets.map((tkt) => (
                  <div key={tkt.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800">
                        <div>
                          <span className="font-mono font-bold text-sm text-slate-100">{tkt.ticketNumber}</span>
                          <p className="text-[11px] text-slate-400">{tkt.order.tableNumber || "Lounge Service"}</p>
                        </div>
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded",
                          tkt.station === 'BAR' ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                        )}>
                          {tkt.station}
                        </span>
                      </div>

                      <div className="space-y-1.5 py-2">
                        {tkt.items.map((item) => (
                          <div key={item.id} className="flex justify-between items-start text-xs">
                            <span className="text-slate-200">
                              <strong className="text-amber-400 font-mono mr-1.5">{item.quantity}x</strong>
                              {item.productName}
                              {item.specialInstructions && (
                                <span className="block text-[10px] text-rose-400 italic">
                                  Note: {item.specialInstructions}
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase">{item.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex gap-2">
                      {tkt.status === 'NEW' && (
                        <button
                          onClick={() => updateTicketStatusMutation.mutate({ ticketId: tkt.id, newStatus: 'PREPARING' })}
                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition"
                        >
                          Start Preparing
                        </button>
                      )}
                      {tkt.status === 'PREPARING' && (
                        <button
                          onClick={() => updateTicketStatusMutation.mutate({ ticketId: tkt.id, newStatus: 'READY' })}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition"
                        >
                          Mark Ready
                        </button>
                      )}
                      {tkt.status === 'READY' && (
                        <button
                          onClick={() => updateTicketStatusMutation.mutate({ ticketId: tkt.id, newStatus: 'SERVED' })}
                          className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1"
                        >
                          <Check size={14} /> Mark Served
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        )}

        {/* TAB 5: PRODUCTS CATALOG */}
        {activeTab === "Products" && (
          <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-36 md:pb-6">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">Lounge Inventory Catalog</h2>
                <p className="text-xs text-slate-400">Database-backed menu pricing and prep stations</p>
              </div>
              <button
                onClick={() => setShowAddProductModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition"
              >
                <PlusCircle size={15} /> Add
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs md:text-sm">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3">Item / SKU</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Station</th>
                      <th className="p-3">Stock</th>
                      <th className="p-3 text-right">Price (TZS)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {products.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-800/40">
                        <td className="p-3">
                          <span className="font-semibold text-slate-200">{p.name}</span>
                          <span className="block text-[10px] text-slate-500 font-mono">{p.sku}</span>
                        </td>
                        <td className="p-3 text-slate-400">{p.category?.name}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                            {p.station}
                          </span>
                        </td>
                        <td className="p-3 font-mono">{p.stockQuantity}</td>
                        <td className="p-3 text-right font-bold text-amber-500 font-mono">
                          {p.price.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        )}

        {/* DESKTOP FIXED ORDER SUMMARY PANEL (Visible on md: and up) */}
        {activeTab === "POS" && (
          <section className="hidden md:flex w-96 bg-slate-900 border-l border-slate-800 p-5 flex-col h-screen z-20 shadow-2xl shrink-0">
            {/* Order Header */}
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-slate-100 font-mono">
                    {currentOrderNumber}
                  </h3>
                  {currentOrderId && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-400">
                    {selectedTable ? selectedTable.tableNumber : "Walk-in Service"}
                  </span>
                  {selectedTable && (
                    <button 
                      onClick={() => setShowTransferModal(true)}
                      className="text-[10px] text-amber-400 hover:underline flex items-center gap-0.5"
                    >
                      <ArrowRightLeft size={10} /> Transfer
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => saveOrderMutation.mutate()}
                  disabled={saveOrderMutation.isPending || cart.length === 0}
                  title="Save / Hold Tab"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition disabled:opacity-40"
                >
                  <Save size={16} />
                </button>
                <button
                  onClick={resetPOS}
                  title="Clear Tab"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-grow space-y-2 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <ShoppingCart size={32} className="mb-2 opacity-30" />
                  <p className="text-xs">No items in active order.</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">Tap products on the left to add items.</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50">
                    <div className="text-xs min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-slate-100 truncate">{item.productName}</p>
                        <span className="text-[9px] font-bold px-1 rounded bg-slate-900 text-slate-400">
                          {item.station}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-500 font-mono mt-0.5">
                        {(item.unitPrice * item.quantity).toLocaleString()} TZS
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition" 
                        onClick={() => updateQuantity(item.productId, -1)}
                      >
                        <Minus size={11} />
                      </button>
                      <span className="text-xs font-bold w-5 text-center font-mono">{item.quantity}</span>
                      <button 
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition" 
                        onClick={() => updateQuantity(item.productId, 1)}
                      >
                        <Plus size={11} />
                      </button>
                      <button 
                        className="p-1 rounded text-rose-400 hover:bg-rose-950/60 ml-1 transition" 
                        onClick={() => removeFromCart(item.productId)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Calculations & Action Buttons */}
            <div className="border-t border-slate-800 pt-3 mt-2 space-y-1 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span className="font-mono">{subtotal.toLocaleString()} TZS</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Tax (18% VAT)</span>
                <span className="font-mono">{tax.toLocaleString()} TZS</span>
              </div>
              <div className="flex justify-between text-sm md:text-base font-bold text-slate-100 pt-1 border-t border-slate-800">
                <span>Total Due</span>
                <span className="text-amber-400 font-mono">{total.toLocaleString()} TZS</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => sendToPrepMutation.mutate()}
                  disabled={sendToPrepMutation.isPending || cart.length === 0}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-1.5"
                >
                  <Send size={13} className="text-amber-400" />
                  <span>Send to Bar/Kit</span>
                </button>
                <button
                  onClick={() => setShowPaymentModal(true)}
                  disabled={cart.length === 0}
                  className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition shadow-lg shadow-rose-900/30 text-xs flex items-center justify-center gap-1"
                >
                  <span>Charge Tab</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* MOBILE FLOATING ORDER PILL (Just above Bottom Bar when in POS with items) */}
        {activeTab === "POS" && totalItemCount > 0 && (
          <div className="md:hidden fixed bottom-[4.25rem] inset-x-3 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-700/80 rounded-2xl p-2.5 shadow-2xl z-30 flex items-center justify-between backdrop-blur-md">
            <div className="flex items-center gap-2 pl-1">
              <div className="w-8 h-8 rounded-xl bg-rose-600 flex items-center justify-center text-white font-bold text-xs shadow-md">
                {totalItemCount}
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-medium">
                  {selectedTable ? selectedTable.tableNumber : "Walk-in Service"}
                </p>
                <p className="text-xs font-bold text-amber-400 font-mono">
                  {total.toLocaleString()} TZS
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsMobileCartOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow transition"
            >
              <span>View Tab</span>
              <ChevronUp size={14} />
            </button>
          </div>
        )}

        {/* MOBILE EXPANDED CART BOTTOM SHEET */}
        {isMobileCartOpen && activeTab === "POS" && (
          <div className="md:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col justify-end animate-in fade-in duration-200">
            <div className="bg-slate-900 border-t border-slate-700 rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200 pb-4">
              {/* Sheet Drag Header */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-6 rounded-full bg-rose-500" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-100 font-mono">
                      {currentOrderNumber}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {selectedTable ? selectedTable.tableNumber : "Walk-in Service"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTable && (
                    <button 
                      onClick={() => {
                        setShowTransferModal(true);
                        setIsMobileCartOpen(false);
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-amber-400 flex items-center gap-1 font-medium"
                    >
                      <ArrowRightLeft size={11} /> Transfer
                    </button>
                  )}
                  <button
                    onClick={() => setIsMobileCartOpen(false)}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <ChevronDown size={20} />
                  </button>
                </div>
              </div>

              {/* Items List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {cart.length === 0 ? (
                  <div className="py-10 text-center text-slate-500">
                    <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No items in cart.</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.productId} className="flex justify-between items-center bg-slate-800/80 p-3 rounded-xl border border-slate-700/50">
                      <div className="text-xs min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-slate-100 truncate">{item.productName}</p>
                          <span className="text-[9px] font-bold px-1 rounded bg-slate-900 text-slate-400">
                            {item.station}
                          </span>
                        </div>
                        <p className="text-xs text-amber-500 font-mono mt-0.5 font-bold">
                          {(item.unitPrice * item.quantity).toLocaleString()} TZS
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button 
                          className="p-1.5 rounded bg-slate-700 text-slate-200" 
                          onClick={() => updateQuantity(item.productId, -1)}
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-xs font-bold w-6 text-center font-mono">{item.quantity}</span>
                        <button 
                          className="p-1.5 rounded bg-slate-700 text-slate-200" 
                          onClick={() => updateQuantity(item.productId, 1)}
                        >
                          <Plus size={12} />
                        </button>
                        <button 
                          className="p-1.5 rounded text-rose-400 hover:bg-rose-950/60 ml-1" 
                          onClick={() => removeFromCart(item.productId)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Sheet Totals & Action Buttons */}
              <div className="border-t border-slate-800 p-4 bg-slate-900/90 space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subtotal</span>
                  <span className="font-mono">{subtotal.toLocaleString()} TZS</span>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Tax (18% VAT)</span>
                  <span className="font-mono">{tax.toLocaleString()} TZS</span>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-100 pt-1 border-t border-slate-800">
                  <span>Total Payable</span>
                  <span className="text-amber-400 font-mono">{total.toLocaleString()} TZS</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    onClick={() => {
                      sendToPrepMutation.mutate();
                      setIsMobileCartOpen(false);
                    }}
                    disabled={sendToPrepMutation.isPending || cart.length === 0}
                    className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold py-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5"
                  >
                    <Send size={14} className="text-amber-400" />
                    <span>Send to Bar/Kit</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowPaymentModal(true);
                      setIsMobileCartOpen(false);
                    }}
                    disabled={cart.length === 0}
                    className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5"
                  >
                    <Save size={14} />
                    <span>Charge Tab</span>
                  </button>
                </div>

                <button
                  onClick={() => setIsMobileCartOpen(false)}
                  className="w-full py-1.5 text-center text-xs text-slate-400 hover:text-white"
                >
                  Continue Adding Products
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (Permanently at bottom on phones) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around px-2 z-40 shadow-2xl">
        {navigationItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setActiveTab(item.id as any);
              setIsMobileCartOpen(false);
            }}
            className={cn(
              "relative flex flex-col items-center justify-center flex-1 py-1 transition-all",
              activeTab === item.id 
                ? "text-rose-500 font-bold" 
                : "text-slate-400 hover:text-slate-200 font-medium"
            )}
          >
            <div className="relative">
              <item.icon size={20} className={cn(activeTab === item.id ? "scale-110 transition-transform" : "")} />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1.5 -right-2 bg-amber-500 text-slate-950 text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1 leading-none tracking-tight">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* MODAL 1: TABLE PICKER */}
      {showTablePicker && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100">Select Lounge Table / VIP Area</h3>
              <button onClick={() => setShowTablePicker(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="flex-grow overflow-y-auto space-y-4">
              <button
                onClick={() => {
                  setSelectedTable(null);
                  setServiceType("WALK_IN");
                  setShowTablePicker(false);
                  showNotification('success', 'Switched to Walk-in Bar Service');
                }}
                className="w-full p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-left hover:border-amber-500 transition"
              >
                <p className="font-bold text-sm text-amber-400">Walk-in / Bar Counter</p>
                <p className="text-xs text-slate-400">Direct ordering without assigned table</p>
              </button>

              {sections.map(section => (
                <div key={section.id}>
                  <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">{section.name}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {section.tables.map(tbl => (
                      <button
                        key={tbl.id}
                        disabled={tbl.status === 'OCCUPIED' && tbl.activeOrder?.id !== currentOrderId}
                        onClick={() => {
                          setSelectedTable(tbl);
                          setShowTablePicker(false);
                          showNotification('success', `Selected ${tbl.tableNumber}`);
                        }}
                        className={cn(
                          "p-2.5 rounded-xl border text-left transition",
                          tbl.status === 'OCCUPIED'
                            ? "bg-slate-800/40 border-slate-800 opacity-60"
                            : "bg-slate-800 border-slate-700 hover:border-amber-500"
                        )}
                      >
                        <p className="font-semibold text-xs text-slate-100 truncate">{tbl.tableNumber}</p>
                        <p className="text-[10px] text-slate-400">{tbl.capacity} Seats · {tbl.status}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TRANSFER TABLE */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100">Transfer Order to Another Table</h3>
              <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Moving <strong className="text-amber-400">{currentOrderNumber}</strong> from <strong className="text-slate-200">{selectedTable?.tableNumber}</strong> to an available table:
            </p>

            <select
              value={transferTargetTableId}
              onChange={(e) => setTransferTargetTableId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-xs md:text-sm focus:outline-none focus:border-amber-500 mb-5"
            >
              <option value="">Select an Available Table</option>
              {tables.filter(t => t.status === 'AVAILABLE' && t.id !== selectedTable?.id).map(t => (
                <option key={t.id} value={t.id}>
                  {t.tableNumber} ({t.section.name} · {t.capacity} seats)
                </option>
              ))}
            </select>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTransferModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => transferTableMutation.mutate()}
                disabled={transferTableMutation.isPending || !transferTargetTableId}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-xs"
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PAYMENT */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100">Process Payment</h3>
              <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                processPaymentMutation.mutate({
                    amount: parseInt(formData.get('amount') as string, 10),
                    method: formData.get('method') as string,
                    provider: formData.get('provider') as string || undefined,
                    reference: formData.get('reference') as string || undefined,
                    idempotencyKey: `pay-${Date.now()}`
                });
                setShowPaymentModal(false);
            }}>
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-400 mb-1">Amount (TZS)</label>
                  <input type="number" name="amount" required defaultValue={0} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100" />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Method</label>
                  <select name="method" required className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100">
                    <option value="CASH">Cash</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
                <div>
                    <label className="block text-slate-400 mb-1">Reference</label>
                    <input type="text" name="reference" placeholder="Provider ref" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100" />
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold">Pay</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD PRODUCT */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100">Add Product to Catalog</h3>
              <button onClick={() => setShowAddProductModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetch('/api/products', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...productForm,
                    price: parseInt(productForm.price, 10),
                    stockQuantity: parseInt(productForm.stockQuantity, 10),
                  }),
                })
                  .then(async (r) => {
                    if (!r.ok) {
                      const err = await r.json();
                      throw new Error(err.error);
                    }
                    return r.json();
                  })
                  .then((p) => {
                    queryClient.invalidateQueries({ queryKey: ['products'] });
                    setShowAddProductModal(false);
                    showNotification('success', `Product "${p.name}" added to database!`);
                  })
                  .catch((err) => showNotification('error', err.message));
              }}
              className="space-y-3 text-xs md:text-sm"
            >
              <div>
                <label className="block text-slate-400 mb-1">Item Name *</label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="e.g. Safari Lager"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Price (TZS) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    placeholder="e.g. 3500"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Stock</label>
                  <input
                    type="number"
                    value={productForm.stockQuantity}
                    onChange={(e) => setProductForm({ ...productForm, stockQuantity: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category *</label>
                <select
                  required
                  value={productForm.categoryId}
                  onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Unit</label>
                  <select
                    value={productForm.unitOfMeasure}
                    onChange={(e) => setProductForm({ ...productForm, unitOfMeasure: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Bottle">Bottle</option>
                    <option value="Can">Can</option>
                    <option value="Shot">Shot</option>
                    <option value="Glass">Glass</option>
                    <option value="Portion">Portion</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Prep Station</label>
                  <select
                    value={productForm.station}
                    onChange={(e) => setProductForm({ ...productForm, station: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  >
                    <option value="BAR">Bar</option>
                    <option value="KITCHEN">Kitchen</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
