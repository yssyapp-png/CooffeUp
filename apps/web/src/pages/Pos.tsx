import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateTotals, distributeDiscount, formatSar, parseSar,
  type CartLine, type HeldCart, type LoyaltySnapshot, type OrderRecord, type OrderType, type PaymentMethod, type Product
} from "@cooffeup/shared";
import { CloudOff, Coffee, Gift, Minus, Pause, Pencil, Play, Plus, RefreshCw, Search, Send, ShoppingBag, Trash2, UserPlus, X } from "lucide-react";
import { api, ApiError } from "../api";
import { Notice, toSar, useAction } from "../components";
import { useI18n } from "../i18n";
import { cacheCatalog, cachedCatalog, queueOfflineSale, readHeldCarts, useOutboxSync, writeHeldCarts } from "../offline";
import { useSession } from "../session";

interface CartItem { product: Product; quantity: number; unitPrice: number; notes?: string }
interface CustomerOption { id: string; name: string; phone?: string; insights: { segmentLabel: string; visits: number }; loyalty: LoyaltySnapshot & { tierLabel: string } }
interface TableOption { id: string; label: string; status: string; statusLabel: string }
type Payment = { method: PaymentMethod; amount: string };
type Receipt = { receiptNumber: string; total: number; change: number; orderId?: string; offline: boolean; pointsEarned?: number };

const POS_METHODS: PaymentMethod[] = ["cash", "mada", "card", "apple_pay", "stc_pay"];
const METHOD_NAMES: Record<"ar" | "en", Record<string, string>> = {
  ar: { cash: "نقدًا", mada: "مدى", card: "بطاقة ائتمانية", apple_pay: "Apple Pay", stc_pay: "STC Pay" },
  en: { cash: "Cash", mada: "mada", card: "Credit card", apple_pay: "Apple Pay", stc_pay: "STC Pay" }
};

const TIER_NAMES: Record<"ar" | "en", Record<LoyaltySnapshot["tier"], string>> = {
  ar: { member: "عضو", silver: "فضي", gold: "ذهبي", platinum: "بلاتيني" },
  en: { member: "Member", silver: "Silver", gold: "Gold", platinum: "Platinum" }
};

/** Mirrors the server: the reward covers one unit of the priciest eligible drink before any order discount. */
function applyReward(lines: CartLine[], products: Product[]): { lines: CartLine[]; reward: number } {
  const eligible = lines
    .filter((line) => products.find((product) => product.id === line.productId)?.rewardEligible && line.unitPrice * line.quantity - (line.discount ?? 0) >= line.unitPrice)
    .sort((a, b) => b.unitPrice - a.unitPrice)[0];
  if (!eligible) return { lines, reward: 0 };
  return { lines: lines.map((line) => line === eligible ? { ...line, discount: (line.discount ?? 0) + line.unitPrice } : line), reward: eligible.unitPrice };
}

export function Pos() {
  const { staff, settings, can, hasFeature } = useSession();
  const { t, tx, lang, locale, productName } = useI18n();
  const sar = (value: number) => formatSar(value, locale);
  const sync = useOutboxSync(can("pos.sell"));
  const [products, setProducts] = useState<Product[]>(cachedCatalog);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>(settings.sector.orderTypes.includes("takeaway") ? "takeaway" : settings.sector.orderTypes[0]);
  const [tableId, setTableId] = useState("");
  const [tables, setTables] = useState<TableOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [redeem, setRedeem] = useState(false);
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ method: "mada", amount: "" }]);
  const [held, setHeld] = useState<HeldCart[]>(readHeldCarts);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [panel, setPanel] = useState<"none" | "customer" | "held">("none");
  const [shiftBlocked, setShiftBlocked] = useState(false);
  const [readyBy, setReadyBy] = useState("");
  const action = useAction();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ data: Product[] }>("/api/v1/products").then(({ data }) => { setProducts(data); cacheCatalog(data); }).catch(() => undefined);
    if (hasFeature("tables") && can("tables.manage")) api<{ data: TableOption[] }>("/api/v1/tables").then(({ data }) => setTables(data)).catch(() => undefined);
    if (can("shifts.manage")) {
      api<{ data: unknown; requireOpenShift: boolean }>("/api/v1/shifts/current").then((response) => setShiftBlocked(response.requireOpenShift && !response.data)).catch(() => undefined);
    }
  }, [can, hasFeature, receipt]);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const visible = products.filter((product) => (category === "all" || product.category === category) &&
    `${product.nameAr} ${product.nameEn} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  const baseLines: CartLine[] = cart.map((item) => ({ productId: item.product.id, name: item.product.nameAr, unitPrice: item.unitPrice, quantity: item.quantity, taxRateBps: item.product.taxRateBps, notes: item.notes }));
  const canRedeem = Boolean(customer && customer.loyalty.freeDrinksAvailable > 0);
  const { lines, reward } = redeem && canRedeem ? applyReward(baseLines, products) : { lines: baseLines, reward: 0 };
  const gross = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity - (line.discount ?? 0), 0);
  const discountInvalid = discount.trim() !== "" && parseSar(discount) === null;
  const discountValue = Math.min(parseSar(discount) ?? 0, gross);
  const maxDiscount = Math.floor((baseLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) * staff.maxDiscountBps) / 10_000);
  const totals = calculateTotals(distributeDiscount(lines, discountValue));
  // An empty first row covers whatever the other rows leave unpaid, so single-method sales need no typing.
  const paymentsInvalid = payments.some((payment) => payment.amount.trim() !== "" && parseSar(payment.amount) === null);
  const othersPaid = payments.slice(1).reduce((sum, payment) => sum + (parseSar(payment.amount) ?? 0), 0);
  const paymentRows = totals.total === 0 ? [] : payments.map((payment, index) => ({
    method: payment.method, amount: payment.amount.trim() === "" && index === 0 ? Math.max(totals.total - othersPaid, 0) : parseSar(payment.amount) ?? 0
  }));
  const paid = paymentRows.reduce((sum, payment) => sum + payment.amount, 0);
  const change = Math.max(paid - totals.total, 0);
  const blocked = sync.online && shiftBlocked;

  // Online, the till cannot sell more than is in stock; offline sales are reconciled at sync.
  const add = (product: Product) => setCart((current) => {
    const existing = current.find((item) => item.product.id === product.id);
    if (sync.online && (existing?.quantity ?? 0) + 1 > product.stock) return current;
    return existing ? current.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { product, quantity: 1, unitPrice: product.price }];
  });
  const setQuantity = (id: string, delta: number) => setCart((current) => current.map((item) => item.product.id === id
    ? { ...item, quantity: delta > 0 && sync.online && item.quantity + delta > item.product.stock ? item.quantity : item.quantity + delta }
    : item).filter((item) => item.quantity > 0));

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const exact = products.find((product) => product.barcode === query.trim() || product.sku.toLowerCase() === query.trim().toLowerCase());
    if (exact) { add(exact); setQuery(""); }
  }

  function editPrice(item: CartItem) {
    const value = window.prompt(`${productName(item.product)} — ${t("newPrice")}`, toSar(item.unitPrice));
    if (value === null) return;
    const price = parseSar(value);
    if (price === null) return;
    setCart((current) => current.map((line) => line.product.id === item.product.id ? { ...line, unitPrice: price } : line));
  }

  function reset() {
    setCart([]); setDiscount(""); setCustomer(null); setRedeem(false); setTableId(""); setReadyBy(""); setPayments([{ method: "mada", amount: "" }]);
  }

  function payload() {
    return {
      type: orderType,
      lines: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, ...(item.unitPrice !== item.product.price ? { unitPrice: item.unitPrice } : {}), ...(item.notes ? { notes: item.notes } : {}) })),
      ...(discountValue ? { orderDiscount: discountValue } : {}),
      ...(customer ? { customerId: customer.id } : {}),
      ...(reward ? { redeemReward: "free_drink" as const } : {}),
      ...(hasFeature("pickup_tickets") && readyBy ? { pickupDueAt: new Date(readyBy).toISOString() } : {}),
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
        setReceipt({ receiptNumber: response.data.receiptNumber, total: response.data.totals.total, change: response.change, orderId: response.data.id, offline: false, pointsEarned: response.data.loyalty?.earned });
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
    const label = window.prompt(t("holdPrompt"), customer?.name ?? `${t("cart")} ${held.length + 1}`);
    if (!label) return;
    const { redeemReward: _reward, pickupDueAt: _due, ...rest } = payload();
    const entry: HeldCart = { id: crypto.randomUUID(), label, payload: rest, heldBy: staff.id, heldAt: new Date().toISOString() };
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

  const payLabel = action.busy ? t("processing")
    : paymentsInvalid || discountInvalid ? t("invalidAmount")
    : totals.total === 0 && cart.length ? t("recordFree")
    : paid < totals.total ? `${t("remaining")} ${sar(totals.total - paid)}` : `${t("pay")} ${sar(totals.total)}`;

  return <div className="pos">
    <section className="catalog">
      <div className="title">
        <div><p>{tx(settings.sector.nameAr)} · {staff.name}</p><h1>{t("chooseProducts")}</h1></div>
        <div className="search"><Search size={19} /><input ref={searchRef} aria-label={t("searchPlaceholder")} placeholder={t("searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} /></div>
      </div>
      {blocked && <Notice tone="warning">{t("shiftRequired")}</Notice>}
      {(sync.pending > 0 || sync.needsReview.length > 0 || !sync.online) && <div className="sync-bar">
        <CloudOff size={16} />
        <span>{sync.online ? t("connectedShort") : t("savedOnDevice")} · {t("awaitingSync")}: {sync.pending}</span>
        {sync.online && sync.pending > 0 && <button onClick={() => void sync.syncNow()}><RefreshCw size={14} /> {t("syncNow")}</button>}
        {sync.needsReview.map((entry) => <span key={entry.id} className="review">{entry.localReceipt}: {entry.lastError} <button onClick={() => sync.discard(entry.id)}>{t("ignore")}</button></span>)}
      </div>}
      <nav className="chips"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>{t("all")}</button>
        {categories.map((name) => <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}>{tx(name)}</button>)}</nav>
      <div className="products">{visible.map((product) => <button className="product" key={product.id} onClick={() => add(product)} disabled={product.stock <= 0 && sync.online}>
        <span className="cup"><Coffee /></span><span className={`stock ${product.stock <= (product.reorderLevel ?? 0) ? "low" : ""}`}>{product.stock <= 0 ? t("soldOut") : `${t("inStock")} ${product.stock}`}</span>
        <h3>{productName(product)}</h3><small>{lang === "ar" ? product.nameEn : product.nameAr}</small><strong>{sar(product.price)}</strong>
      </button>)}{visible.length === 0 && <p className="muted">{t("noResults")}</p>}</div>
    </section>

    <aside className="order">
      <div className="order-title">
        <div><ShoppingBag /><div><h2>{t("currentOrder")}</h2><small>{cart.reduce((sum, item) => sum + item.quantity, 0)} {t("items")}</small></div></div>
        <div className="row">
          {can("pos.hold_cart") && <button className="icon" title={t("holdCart")} aria-label={t("holdCart")} onClick={hold} disabled={!cart.length}><Pause size={16} /></button>}
          {can("pos.hold_cart") && <button className="icon badge-wrap" title={t("heldCarts")} aria-label={t("heldCarts")} onClick={() => setPanel(panel === "held" ? "none" : "held")}><Play size={16} />{held.length > 0 && <i>{held.length}</i>}</button>}
          <button className="icon danger" title={t("clear")} aria-label={t("clear")} onClick={reset}><Trash2 size={16} /></button>
        </div>
      </div>

      {panel === "held" && <div className="panel">
        <b>{t("heldCarts")}</b>
        {held.length === 0 ? <p className="muted">{t("noHeldCarts")}</p> : held.map((entry) => <button key={entry.id} className="list-item" onClick={() => resume(entry)}>
          <span>{entry.label}</span><small>{entry.payload.lines.reduce((sum, line) => sum + line.quantity, 0)} {t("items")} · {new Date(entry.heldAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</small>
        </button>)}
      </div>}

      <div className="segmented">{settings.sector.orderTypes.map((type) => <button key={type} className={orderType === type ? "selected" : ""} onClick={() => setOrderType(type)}>{t(type)}</button>)}</div>
      {orderType === "dine_in" && tables.length > 0 && <select aria-label={t("table")} value={tableId} onChange={(event) => setTableId(event.target.value)}>
        <option value="">{t("noTable")}</option>{tables.map((table) => <option key={table.id} value={table.id}>{table.label} — {table.statusLabel}</option>)}
      </select>}

      {can("customers.view") && (customer
        ? <div className="customer-chip">
          <span><b>{customer.name}</b><small>{TIER_NAMES[lang][customer.loyalty.tier]} · {customer.loyalty.points} {t("points")} · {customer.insights.visits} {t("visits")}</small></span>
          <button onClick={() => { setCustomer(null); setRedeem(false); }} aria-label={t("removeCustomer")}><X size={14} /></button>
        </div>
        : <button className="ghost small" onClick={() => setPanel(panel === "customer" ? "none" : "customer")}><UserPlus size={15} /> {t("addCustomer")}</button>)}
      {hasFeature("pickup_tickets") && <label className="inline-field">{t("readyBy")}<input type="datetime-local" value={readyBy} onChange={(event) => setReadyBy(event.target.value)} /></label>}
      {canRedeem && <label className="check reward"><input type="checkbox" checked={redeem} onChange={(event) => setRedeem(event.target.checked)} /> <Gift size={15} /> {t("freeDrink")}</label>}
      {panel === "customer" && <CustomerPicker onPick={(picked) => { setCustomer(picked); setRedeem(false); setPanel("none"); }} canCreate={can("customers.manage")} />}

      <div className="lines">{cart.length === 0 ? <div className="empty"><ShoppingBag /><p>{t("emptyCart")}</p><small>{t("emptyHint")}</small></div> : cart.map((item) => <div className="line" key={item.product.id}>
        <div><b>{productName(item.product)}</b><small>{sar(item.unitPrice)}{item.unitPrice !== item.product.price && <em> ({t("edited")})</em>}
          {can("pos.price_override") && <button className="inline" title={t("editPrice")} aria-label={t("editPrice")} onClick={() => editPrice(item)}><Pencil size={12} /></button>}</small></div>
        <div className="stepper"><button onClick={() => setQuantity(item.product.id, -1)} aria-label={t("decrease")}>{item.quantity === 1 ? <Trash2 /> : <Minus />}</button><span>{item.quantity}</span><button onClick={() => setQuantity(item.product.id, 1)} aria-label={t("increase")}><Plus /></button></div>
      </div>)}</div>

      <div className="summary">
        {can("pos.discount") && cart.length > 0 && <label className="inline-field">{t("discountSar")}<input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0.00" aria-invalid={discountInvalid} /><small>{t("maxDiscount")} {sar(maxDiscount)}</small></label>}
        {reward > 0 && <p><span>{t("reward")}</span><b>- {sar(reward)}</b></p>}
        {totals.discount - reward > 0 && <p><span>{t("discount")}</span><b>- {sar(totals.discount - reward)}</b></p>}
        <p><span>{t("subtotal")}</span><b>{sar(totals.taxable)}</b></p>
        <p><span>{t("vat")}</span><b>{sar(totals.tax)}</b></p>
        <div><span>{t("total")}</span><strong>{sar(totals.total)}</strong></div>
      </div>

      {cart.length > 0 && totals.total > 0 && <div className="payments">
        {payments.map((payment, index) => <div className="payment-row" key={index}>
          <select aria-label={t("paymentMethod")} value={payment.method} onChange={(event) => setPayments((current) => current.map((row, i) => i === index ? { ...row, method: event.target.value as PaymentMethod } : row))}>
            {POS_METHODS.map((method) => <option key={method} value={method}>{METHOD_NAMES[lang][method]}</option>)}
          </select>
          <input inputMode="decimal" aria-label={t("amount")} aria-invalid={payment.amount.trim() !== "" && parseSar(payment.amount) === null} placeholder={index === 0 ? toSar(Math.max(totals.total - othersPaid, 0)) : "0.00"} value={payment.amount}
            onChange={(event) => setPayments((current) => current.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} />
          {index > 0 && <button className="icon" aria-label={t("delete")} onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>}
        </div>)}
        <div className="row between">
          {payments.length < 3 && <button className="link" onClick={() => setPayments((current) => [...current, { method: "cash", amount: "" }])}>{t("splitPayment")}</button>}
          {change > 0 && <span className="change">{t("changeDue")}: <b>{sar(change)}</b></span>}
        </div>
      </div>}

      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="pay" onClick={checkout} disabled={!cart.length || action.busy || blocked || paymentsInvalid || discountInvalid || paid < totals.total}>{payLabel}</button>
    </aside>
    {receipt && <ReceiptDialog receipt={receipt} canSend={can("invoices.send")} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
  </div>;
}

function CustomerPicker({ onPick, canCreate }: { onPick: (customer: CustomerOption) => void; canCreate: boolean }) {
  const { t, lang } = useI18n();
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
    <input autoFocus placeholder={t("customerSearch")} aria-label={t("customerSearch")} value={term} onChange={(event) => setTerm(event.target.value)} />
    {results.map((customer) => <button key={customer.id} className="list-item" onClick={() => onPick(customer)}>
      <span>{customer.name}</span><small dir="ltr">{customer.phone}</small><small>{TIER_NAMES[lang][customer.loyalty.tier]} · {customer.loyalty.points} {t("points")}</small>
    </button>)}
    {canCreate && term.trim().length >= 2 && results.length === 0 && <form className="row" onSubmit={async (event) => {
      event.preventDefault();
      const created = await action.run(() => api<{ data: CustomerOption }>("/api/v1/customers", { method: "POST", body: { name, phone: term } }));
      if (created) onPick(created.data);
    }}>
      <input placeholder={t("newCustomerName")} aria-label={t("newCustomerName")} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
      <button className="primary small" disabled={action.busy}>{t("add")}</button>
    </form>}
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
  </div>;
}

function ReceiptDialog({ receipt, canSend, onClose }: { receipt: Receipt; canSend: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [phone, setPhone] = useState("");
  const action = useAction();
  return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
    <div className="dialog">
      <h2 id="receipt-title">{receipt.offline ? t("savedOffline") : t("paid")}</h2>
      <p className="big-number">{formatSar(receipt.total, locale)}</p>
      <p>{t("receiptNumber")}: <b>{receipt.receiptNumber}</b></p>
      {receipt.change > 0 && <p className="change">{t("changeDue")}: <b>{formatSar(receipt.change, locale)}</b></p>}
      {receipt.pointsEarned ? <p className="change"><Gift size={14} /> {t("pointsEarned")}: <b>{receipt.pointsEarned}</b></p> : null}
      {receipt.offline && <Notice tone="warning">{t("offlineNotice")}</Notice>}
      {canSend && receipt.orderId && <form className="row" onSubmit={(event) => {
        event.preventDefault();
        void action.run(() => api(`/api/v1/orders/${receipt.orderId}/send-invoice`, { method: "POST", body: { phone } }), t("smsSent"));
      }}>
        <input inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={(event) => setPhone(event.target.value)} aria-label={t("customerPhone")} />
        <button className="primary small" disabled={action.busy || phone.length < 9}><Send size={14} /> {t("sendSms")}</button>
      </form>}
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="pay" onClick={onClose} autoFocus>{t("newOrder")}</button>
    </div>
  </div>;
}
