import { useEffect, useMemo, useRef, useState } from "react";
import {
  ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, calculateTotals, distributeDiscount, formatSar,
  type CartLine, type HeldCart, type OrderRecord, type OrderType, type PaymentMethod, type Product
} from "@cooffeup/shared";
import { CloudOff, Coffee, Minus, Pause, Pencil, Play, Plus, RefreshCw, Search, Send, ShoppingBag, Trash2, UserPlus, X } from "lucide-react";
import { api, ApiError } from "../api";
import { Notice, sarInput, toSar, useAction } from "../components";
import { cacheCatalog, cachedCatalog, queueOfflineSale, readHeldCarts, useOutboxSync, writeHeldCarts } from "../offline";
import { useSession } from "../session";

interface CartItem { product: Product; quantity: number; unitPrice: number; notes?: string }
interface CustomerOption { id: string; name: string; phone?: string; insights: { segmentLabel: string; visits: number } }
interface TableOption { id: string; label: string; status: string; statusLabel: string }
type Payment = { method: PaymentMethod; amount: string };
type Receipt = { receiptNumber: string; total: number; change: number; orderId?: string; offline: boolean };

const POS_METHODS: PaymentMethod[] = ["cash", "mada", "card", "apple_pay", "stc_pay"];

export function Pos() {
  const { staff, settings, can, hasFeature } = useSession();
  const sync = useOutboxSync(can("pos.sell"));
  const [products, setProducts] = useState<Product[]>(cachedCatalog);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>(settings.sector.orderTypes.includes("takeaway") ? "takeaway" : settings.sector.orderTypes[0]);
  const [tableId, setTableId] = useState("");
  const [tables, setTables] = useState<TableOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ method: "mada", amount: "" }]);
  const [held, setHeld] = useState<HeldCart[]>(readHeldCarts);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [panel, setPanel] = useState<"none" | "customer" | "held">("none");
  const action = useAction();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ data: Product[] }>("/api/v1/products").then(({ data }) => { setProducts(data); cacheCatalog(data); }).catch(() => undefined);
    if (hasFeature("tables") && can("tables.manage")) api<{ data: TableOption[] }>("/api/v1/tables").then(({ data }) => setTables(data)).catch(() => undefined);
  }, [can, hasFeature, receipt]);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const visible = products.filter((product) => (category === "all" || product.category === category) &&
    `${product.nameAr} ${product.nameEn} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  const lines: CartLine[] = cart.map((item) => ({ productId: item.product.id, name: item.product.nameAr, unitPrice: item.unitPrice, quantity: item.quantity, taxRateBps: item.product.taxRateBps, notes: item.notes }));
  const gross = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const discountValue = Math.min(sarInput(discount), gross);
  const maxDiscount = Math.floor((gross * staff.maxDiscountBps) / 10_000);
  const totals = calculateTotals(distributeDiscount(lines, discountValue));
  // An empty first row covers whatever the other rows leave unpaid, so single-method sales need no typing.
  const othersPaid = payments.slice(1).reduce((sum, payment) => sum + sarInput(payment.amount), 0);
  const paymentRows = payments.map((payment, index) => ({ method: payment.method, amount: payment.amount === "" && index === 0 ? Math.max(totals.total - othersPaid, 0) : sarInput(payment.amount) }));
  const paid = paymentRows.reduce((sum, payment) => sum + payment.amount, 0);
  const change = Math.max(paid - totals.total, 0);

  const add = (product: Product) => setCart((current) => current.some((item) => item.product.id === product.id)
    ? current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
    : [...current, { product, quantity: 1, unitPrice: product.price }]);
  const setQuantity = (id: string, delta: number) => setCart((current) => current.map((item) => item.product.id === id ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0));

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const exact = products.find((product) => product.barcode === query.trim() || product.sku.toLowerCase() === query.trim().toLowerCase());
    if (exact) { add(exact); setQuery(""); }
  }

  function editPrice(item: CartItem) {
    const value = window.prompt(`السعر الجديد لـ ${item.product.nameAr} (قبل الضريبة، ر.س)`, toSar(item.unitPrice));
    if (value === null) return;
    const price = sarInput(value);
    if (Number.isNaN(price) || price < 0) return;
    setCart((current) => current.map((line) => line.product.id === item.product.id ? { ...line, unitPrice: price } : line));
  }

  function reset() {
    setCart([]); setDiscount(""); setCustomer(null); setTableId(""); setPayments([{ method: "mada", amount: "" }]);
  }

  function payload() {
    return {
      type: orderType,
      lines: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, ...(item.unitPrice !== item.product.price ? { unitPrice: item.unitPrice } : {}), ...(item.notes ? { notes: item.notes } : {}) })),
      ...(discountValue ? { orderDiscount: discountValue } : {}),
      ...(customer ? { customerId: customer.id } : {}),
      ...(orderType === "dine_in" && tableId ? { tableId } : {})
    };
  }

  async function checkout() {
    if (!cart.length || action.busy) return;
    const order = { ...payload(), payments: paymentRows.filter((payment) => payment.amount > 0) };
    const key = crypto.randomUUID();
    const queueLocally = () => {
      const entry = queueOfflineSale(key, order);
      setReceipt({ receiptNumber: entry.localReceipt, total: totals.total, change, offline: true });
      reset();
    };
    if (!sync.online) return queueLocally();
    await action.run(async () => {
      try {
        const response = await api<{ data: OrderRecord; change: number }>("/api/v1/orders", { method: "POST", body: order, headers: { "idempotency-key": key } });
        setReceipt({ receiptNumber: response.data.receiptNumber, total: response.data.totals.total, change: response.change, orderId: response.data.id, offline: false });
        reset();
      } catch (error) {
        // The request may have reached the server; the same idempotency key makes the replay safe.
        if (error instanceof ApiError && error.status === 0) return queueLocally();
        throw error;
      }
    });
  }

  async function hold() {
    if (!cart.length) return;
    const label = window.prompt("اسم للسلة المعلقة (مثال: طاولة 3 أو اسم العميل)", customer?.name ?? `سلة ${held.length + 1}`);
    if (!label) return;
    const entry: HeldCart = { id: crypto.randomUUID(), label, payload: payload(), heldBy: staff.id, heldAt: new Date().toISOString() };
    const next = [entry, ...held];
    setHeld(next); writeHeldCarts(next); reset();
    if (sync.online) api("/api/v1/held-carts", { method: "POST", body: { id: entry.id, label, payload: entry.payload } }).catch(() => undefined);
  }

  function resume(entry: HeldCart) {
    const items = entry.payload.lines.flatMap((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      return product ? [{ product, quantity: line.quantity, unitPrice: (line as { unitPrice?: number }).unitPrice ?? product.price, notes: line.notes }] : [];
    });
    setCart(items);
    setOrderType(entry.payload.type);
    setTableId(entry.payload.tableId ?? "");
    const next = held.filter((candidate) => candidate.id !== entry.id);
    setHeld(next); writeHeldCarts(next); setPanel("none");
    if (sync.online) api(`/api/v1/held-carts/${entry.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  return <div className="pos">
    <section className="catalog">
      <div className="title">
        <div><p>{settings.sector.nameAr} · {staff.name}</p><h1>اختر المنتجات</h1></div>
        <div className="search"><Search size={19} /><input ref={searchRef} aria-label="بحث" placeholder="ابحث بالاسم أو امسح الباركود" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} /></div>
      </div>
      {(sync.pending > 0 || sync.needsReview.length > 0 || !sync.online) && <div className="sync-bar">
        <CloudOff size={16} />
        <span>{sync.online ? "متصل" : "بلا اتصال — يتم حفظ المبيعات على الجهاز"} · بانتظار المزامنة: {sync.pending}</span>
        {sync.online && sync.pending > 0 && <button onClick={() => void sync.syncNow()}><RefreshCw size={14} /> مزامنة الآن</button>}
        {sync.needsReview.map((entry) => <span key={entry.id} className="review">{entry.localReceipt}: {entry.lastError} <button onClick={() => sync.discard(entry.id)}>تجاهل</button></span>)}
      </div>}
      <nav className="chips"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>الكل</button>
        {categories.map((name) => <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}>{name}</button>)}</nav>
      <div className="products">{visible.map((product) => <button className="product" key={product.id} onClick={() => add(product)} disabled={product.stock <= 0 && sync.online}>
        <span className="cup"><Coffee /></span><span className={`stock ${product.stock <= (product.reorderLevel ?? 0) ? "low" : ""}`}>متوفر {product.stock}</span>
        <h3>{product.nameAr}</h3><small>{product.nameEn}</small><strong>{formatSar(product.price)}</strong>
      </button>)}</div>
    </section>

    <aside className="order">
      <div className="order-title">
        <div><ShoppingBag /><div><h2>الطلب الحالي</h2><small>{cart.reduce((sum, item) => sum + item.quantity, 0)} أصناف</small></div></div>
        <div className="row">
          {can("pos.hold_cart") && <button className="icon" title="تعليق السلة" onClick={hold} disabled={!cart.length}><Pause size={16} /></button>}
          {can("pos.hold_cart") && <button className="icon badge-wrap" title="السلات المعلقة" onClick={() => setPanel(panel === "held" ? "none" : "held")}><Play size={16} />{held.length > 0 && <i>{held.length}</i>}</button>}
          <button className="icon danger" title="مسح" onClick={reset}><Trash2 size={16} /></button>
        </div>
      </div>

      {panel === "held" && <div className="panel">
        <b>السلات المعلقة</b>
        {held.length === 0 ? <p className="muted">لا توجد سلات معلقة</p> : held.map((entry) => <button key={entry.id} className="list-item" onClick={() => resume(entry)}>
          <span>{entry.label}</span><small>{entry.payload.lines.reduce((sum, line) => sum + line.quantity, 0)} أصناف · {new Date(entry.heldAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</small>
        </button>)}
      </div>}

      <div className="segmented">{settings.sector.orderTypes.map((type) => <button key={type} className={orderType === type ? "selected" : ""} onClick={() => setOrderType(type)}>{ORDER_TYPE_LABELS[type]}</button>)}</div>
      {orderType === "dine_in" && tables.length > 0 && <select aria-label="الطاولة" value={tableId} onChange={(event) => setTableId(event.target.value)}>
        <option value="">بدون طاولة</option>{tables.map((table) => <option key={table.id} value={table.id}>{table.label} — {table.statusLabel}</option>)}
      </select>}

      {can("customers.view") && (customer
        ? <div className="customer-chip"><span><b>{customer.name}</b><small>{customer.insights.segmentLabel} · {customer.insights.visits} زيارات</small></span><button onClick={() => setCustomer(null)} aria-label="إزالة العميل"><X size={14} /></button></div>
        : <button className="ghost small" onClick={() => setPanel(panel === "customer" ? "none" : "customer")}><UserPlus size={15} /> إضافة عميل للطلب</button>)}
      {panel === "customer" && <CustomerPicker onPick={(picked) => { setCustomer(picked); setPanel("none"); }} canCreate={can("customers.manage")} />}

      <div className="lines">{cart.length === 0 ? <div className="empty"><ShoppingBag /><p>السلة فارغة</p><small>اختر منتجًا لبدء الطلب</small></div> : cart.map((item) => <div className="line" key={item.product.id}>
        <div><b>{item.product.nameAr}</b><small>{formatSar(item.unitPrice)}{item.unitPrice !== item.product.price && <em> (معدّل)</em>}
          {can("pos.price_override") && <button className="inline" title="تعديل السعر" onClick={() => editPrice(item)}><Pencil size={12} /></button>}</small></div>
        <div className="stepper"><button onClick={() => setQuantity(item.product.id, -1)} aria-label="إنقاص">{item.quantity === 1 ? <Trash2 /> : <Minus />}</button><span>{item.quantity}</span><button onClick={() => setQuantity(item.product.id, 1)} aria-label="زيادة"><Plus /></button></div>
      </div>)}</div>

      <div className="summary">
        {can("pos.discount") && cart.length > 0 && <label className="inline-field">خصم (ر.س)<input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0.00" /><small>الحد الأقصى {formatSar(maxDiscount)}</small></label>}
        {totals.discount > 0 && <p><span>الخصم</span><b>- {formatSar(totals.discount)}</b></p>}
        <p><span>المجموع قبل الضريبة</span><b>{formatSar(totals.taxable)}</b></p>
        <p><span>ضريبة القيمة المضافة</span><b>{formatSar(totals.tax)}</b></p>
        <div><span>الإجمالي</span><strong>{formatSar(totals.total)}</strong></div>
      </div>

      {cart.length > 0 && <div className="payments">
        {payments.map((payment, index) => <div className="payment-row" key={index}>
          <select aria-label="طريقة الدفع" value={payment.method} onChange={(event) => setPayments((current) => current.map((row, i) => i === index ? { ...row, method: event.target.value as PaymentMethod } : row))}>
            {POS_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
          </select>
          <input inputMode="decimal" aria-label="المبلغ" placeholder={index === 0 ? toSar(totals.total) : "0.00"} value={payment.amount}
            onChange={(event) => setPayments((current) => current.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} />
          {index > 0 && <button className="icon" aria-label="حذف" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>}
        </div>)}
        <div className="row between">
          {payments.length < 3 && <button className="link" onClick={() => setPayments((current) => [...current, { method: "cash", amount: "" }])}>+ دفع مجزأ</button>}
          {change > 0 && <span className="change">الباقي للعميل: <b>{formatSar(change)}</b></span>}
        </div>
      </div>}

      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="pay" onClick={checkout} disabled={!cart.length || action.busy || paid < totals.total}>
        {action.busy ? "جارٍ تنفيذ الدفع..." : paid < totals.total ? `المتبقي ${formatSar(totals.total - paid)}` : `دفع ${formatSar(totals.total)}`}
      </button>
    </aside>
    {receipt && <ReceiptDialog receipt={receipt} canSend={can("invoices.send")} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
  </div>;
}

function CustomerPicker({ onPick, canCreate }: { onPick: (customer: CustomerOption) => void; canCreate: boolean }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [name, setName] = useState("");
  const action = useAction();
  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(() => api<{ data: CustomerOption[] }>(`/api/v1/customers?q=${encodeURIComponent(term)}`).then(({ data }) => setResults(data)).catch(() => setResults([])), 250);
    return () => clearTimeout(timer);
  }, [term]);
  return <div className="panel">
    <input autoFocus placeholder="رقم الجوال أو الاسم" value={term} onChange={(event) => setTerm(event.target.value)} />
    {results.map((customer) => <button key={customer.id} className="list-item" onClick={() => onPick(customer)}><span>{customer.name}</span><small>{customer.phone} · {customer.insights.segmentLabel}</small></button>)}
    {canCreate && term.trim().length >= 2 && results.length === 0 && <form className="row" onSubmit={async (event) => {
      event.preventDefault();
      const created = await action.run(() => api<{ data: CustomerOption }>("/api/v1/customers", { method: "POST", body: { name, phone: term } }));
      if (created) onPick(created.data);
    }}>
      <input placeholder="اسم العميل الجديد" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
      <button className="primary small" disabled={action.busy}>إضافة</button>
    </form>}
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
  </div>;
}

function ReceiptDialog({ receipt, canSend, onClose }: { receipt: Receipt; canSend: boolean; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const action = useAction();
  return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
    <div className="dialog">
      <h2 id="receipt-title">{receipt.offline ? "تم حفظ البيع على الجهاز" : "تم الدفع بنجاح"}</h2>
      <p className="big-number">{formatSar(receipt.total)}</p>
      <p>رقم الإيصال: <b>{receipt.receiptNumber}</b></p>
      {receipt.change > 0 && <p className="change">الباقي للعميل: <b>{formatSar(receipt.change)}</b></p>}
      {receipt.offline && <Notice tone="warning">لا يوجد اتصال الآن. سيُرسل البيع تلقائيًا عند عودة الإنترنت ويحصل على رقم فاتورة نهائي.</Notice>}
      {canSend && receipt.orderId && <form className="row" onSubmit={(event) => {
        event.preventDefault();
        void action.run(() => api(`/api/v1/orders/${receipt.orderId}/send-invoice`, { method: "POST", body: { phone } }), "تم إرسال الفاتورة للعميل برسالة نصية");
      }}>
        <input inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="جوال العميل" />
        <button className="primary small" disabled={action.busy || phone.length < 9}><Send size={14} /> إرسال الفاتورة SMS</button>
      </form>}
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="pay" onClick={onClose} autoFocus>طلب جديد</button>
    </div>
  </div>;
}

