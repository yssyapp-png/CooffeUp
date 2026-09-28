import { useEffect, useMemo, useRef, useState } from "react";
import { calculateTotals, FREE_DRINK_POINTS, formatSar, type LoyaltySnapshot, type OrderType, type Product } from "@cooffeup/shared";
import { Coffee, Minus, Plus, Search, ShoppingBag, Trash2, Wifi } from "lucide-react";

type CartItem = Product & { quantity: number };
type Language = "ar" | "en";
type Shift = { id: string; cashierId: string; status: "open" | "closed" };
const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const parseSar = (value: string): number | null => {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const halalas = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return halalas <= 100_000_000 ? halalas : null;
};

const copy = {
  ar: {pos:"نقطة البيع",connected:"النظام متصل",disconnected:"الخادم غير متصل",connecting:"جارٍ فحص الاتصال",shift:"الوردية",openShift:"فتح الوردية",shiftReady:"الوردية مفتوحة",closeShift:"إغلاق الوردية",countedCash:"النقد المعدود (ريال)",cashierId:"معرّف الكاشير",openingFloat:"رصيد افتتاح الصندوق (ريال)",choose:"قائمة المقهى",search:"ابحث بالاسم أو الرمز",all:"الكل",coffee:"القهوة",cold:"المشروبات الباردة",bakery:"المخبوزات",available:"متوفر",soldOut:"نفد المخزون",noResults:"لا توجد منتجات مطابقة",order:"الطلب الحالي",items:"أصناف",clear:"مسح",dineIn:"محلي",takeaway:"سفري",delivery:"توصيل",empty:"السلة فارغة",start:"اختر منتجًا لبدء الطلب",beforeTax:"المجموع قبل الضريبة",vat:"ضريبة القيمة المضافة (15%)",total:"الإجمالي",paying:"جارٍ تسجيل الطلب...",pay:"تسجيل الطلب",cash:"نقد",mada:"مدى (تسجيل فقط)",tendered:"المبلغ المستلم نقدًا (ريال)",change:"الفكة",customer:"رقم جوال العميل 05xxxxxxxx",lookup:"عرض النقاط",points:"نقطة",visits:"زيارة",freeDrink:"استبدال مشروب مجاني",paid:"تم تسجيل الطلب — الإيصال",serverError:"تعذر الاتصال بالخادم",paymentFailed:"تعذر تسجيل الطلب"},
  en: {pos:"Point of Sale",connected:"System online",disconnected:"Server offline",connecting:"Checking connection",shift:"Shift",openShift:"Open shift",shiftReady:"Shift open",closeShift:"Close shift",countedCash:"Counted cash (SAR)",cashierId:"Cashier ID",openingFloat:"Opening cash (SAR)",choose:"Cafe menu",search:"Search by name or SKU",all:"All",coffee:"Coffee",cold:"Cold drinks",bakery:"Bakery",available:"In stock",soldOut:"Sold out",noResults:"No matching products",order:"Current order",items:"items",clear:"Clear",dineIn:"Dine in",takeaway:"Takeaway",delivery:"Delivery",empty:"Cart is empty",start:"Choose a product to start",beforeTax:"Subtotal before VAT",vat:"VAT (15%)",total:"Total",paying:"Recording order...",pay:"Record order",cash:"Cash",mada:"Mada (record only)",tendered:"Cash received (SAR)",change:"Change",customer:"Customer mobile 05xxxxxxxx",lookup:"View points",points:"points",visits:"visits",freeDrink:"Redeem a free drink",paid:"Order recorded — receipt",serverError:"Could not connect to server",paymentFailed:"Could not record order"}
};

export function App() {
  const [products,setProducts] = useState<Product[]>([]);
  const [cart,setCart] = useState<CartItem[]>([]);
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [connection,setConnection] = useState<"checking" | "online" | "offline">("checking");
  const [language,setLanguage] = useState<Language>("ar");
  const [customerMobile,setCustomerMobile] = useState("");
  const [loyalty,setLoyalty] = useState<LoyaltySnapshot>();
  const [redeemFreeDrink,setRedeemFreeDrink] = useState(false);
  const [shift,setShift] = useState<Shift>();
  const [cashierId,setCashierId] = useState(() => localStorage.getItem("cooffeup.cashierId") ?? "cashier-1");
  const [openingFloat,setOpeningFloat] = useState("0");
  const [orderType,setOrderType] = useState<OrderType>("takeaway");
  const [category,setCategory] = useState("all");
  const [paymentMethod,setPaymentMethod] = useState<"cash" | "mada">("cash");
  const [cashReceived,setCashReceived] = useState("");
  const [countedCash,setCountedCash] = useState("");
  const pendingCheckout = useRef<{ payload: string; key: string } | null>(null);
  const tr = copy[language];
  useEffect(() => {
    let active = true;
    async function checkConnection() {
      try {
        const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
        const body = response.ok ? await response.json() : null;
        if (active) setConnection(body?.ok === true ? "online" : "offline");
      } catch { if (active) setConnection("offline"); }
    }
    void checkConnection();
    const timer = window.setInterval(() => void checkConnection(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { fetch(`${API}/api/v1/products`).then(r=>r.json()).then(r=>setProducts(r.data)).catch(()=>setMessage(copy[language].serverError)); }, [language]);
  useEffect(() => { fetch(`${API}/api/v1/shifts`).then(r=>r.json()).then(body=>setShift((body.data as Shift[]).find(s=>s.status === "open" && s.cashierId === cashierId))).catch(()=>setMessage(copy[language].serverError)); }, [cashierId, language]);
  const visible = products.filter(p => (category === "all" || p.category === category) && `${p.nameAr} ${p.nameEn} ${p.sku}`.toLowerCase().includes(query.toLowerCase()));
  const checkoutLines = useMemo(() => {
    const lines = cart.map(p=>({productId:p.id,name:language === "ar" ? p.nameAr : p.nameEn,unitPrice:p.price,quantity:p.quantity,taxRateBps:p.taxRateBps,discount:0}));
    if (redeemFreeDrink) {
      const eligible = lines.filter(line => products.find(p=>p.id===line.productId)?.rewardEligible).sort((a,b)=>b.unitPrice-a.unitPrice)[0];
      if (eligible) eligible.discount = eligible.unitPrice;
    }
    return lines;
  },[cart,language,products,redeemFreeDrink]);
  const totals = useMemo(() => calculateTotals(checkoutLines),[checkoutLines]);
  const cashHalalas = parseSar(cashReceived);
  const validCash = cashHalalas !== null && cashHalalas >= totals.total;
  const canCheckout = connection === "online" && !!shift && cart.length > 0 && !busy && (totals.total === 0 || paymentMethod === "mada" || validCash);
  const add = (product:Product) => setCart(current => current.some(p=>p.id===product.id) ? current.map(p=>p.id===product.id?{...p,quantity:Math.min(p.stock,99,p.quantity+1)}:p) : [...current,{...product,quantity:1}]);
  const quantity = (id:string,delta:number) => setCart(current=>current.map(p=>p.id===id?{...p,quantity:Math.min(p.stock,99,p.quantity+delta)}:p).filter(p=>p.quantity>0));
  async function openShift() {
    const cash = parseSar(openingFloat);
    if (!cashierId.trim() || cash === null) { setMessage(language === "ar" ? "أدخل معرّف الكاشير ورصيدًا صحيحًا" : "Enter a cashier ID and valid opening cash"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/shifts/open`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cashierId:cashierId.trim(),openingFloat:cash})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? tr.serverError);
      localStorage.setItem("cooffeup.cashierId", cashierId.trim());
      setShift(body.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : tr.serverError); } finally { setBusy(false); }
  }
  async function closeShift() {
    if (!shift || busy || cart.length) return;
    const counted = parseSar(countedCash);
    if (counted === null) { setMessage(language === "ar" ? "أدخل النقد المعدود بصورة صحيحة" : "Enter valid counted cash"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/shifts/${shift.id}/close`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({countedCash:counted})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? tr.serverError);
      setShift(undefined); setCountedCash("");
      setMessage(`${tr.closeShift}: ${language === "ar" ? "المتوقع" : "Expected"} ${formatSar(body.data.expectedCash,language === "ar" ? "ar-SA" : "en-SA")} · ${language === "ar" ? "الفرق" : "Variance"} ${formatSar(body.data.variance,language === "ar" ? "ar-SA" : "en-SA")}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : tr.serverError); } finally { setBusy(false); }
  }
  async function loadLoyalty() {
    if (customerMobile.trim().length < 9) return;
    const response = await fetch(`${API}/api/v1/customers/${encodeURIComponent(customerMobile.trim())}/loyalty`);
    const body = await response.json();
    if (response.ok) { setLoyalty(body.data); setRedeemFreeDrink(false); }
  }
  async function checkout() {
    if (!canCheckout || !shift) return;
    setBusy(true); setMessage("");
    try {
      const payload = JSON.stringify({shiftId:shift.id,type:orderType,customerMobile:customerMobile.trim() || undefined,redeemReward:redeemFreeDrink ? "free_drink" : undefined,lines:cart.map(p=>({productId:p.id,quantity:p.quantity})),payments:totals.total === 0 ? [] : [{method:paymentMethod,amount:paymentMethod === "cash" ? cashHalalas : totals.total}]});
      if (pendingCheckout.current?.payload !== payload) pendingCheckout.current = {payload,key:crypto.randomUUID()};
      const response = await fetch(`${API}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":pendingCheckout.current.key},body:payload});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? tr.paymentFailed);
      pendingCheckout.current = null;
      setMessage(`${tr.paid} ${body.data.receiptNumber}${body.data.change ? ` · ${tr.change} ${formatSar(body.data.change,language === "ar" ? "ar-SA" : "en-SA")}` : ""}`); setCart([]); setLoyalty(body.data.loyalty); setRedeemFreeDrink(false); setCashReceived("");
      try {
        const refreshed = await fetch(`${API}/api/v1/products`);
        if (refreshed.ok) setProducts((await refreshed.json()).data);
      } catch { /* The sale succeeded; stock will refresh on the next load. */ }
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ"); } finally { setBusy(false); }
  }
  return <div className="shell" dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
    <header><div className="brand"><span><Coffee size={22}/></span><div><b>CooffeUp</b><small>{tr.pos}</small></div></div><div className="status" role="status"><Wifi size={16}/> {connection === "online" ? tr.connected : connection === "offline" ? tr.disconnected : tr.connecting}</div><div className="header-actions"><button className="language" onClick={()=>setLanguage(language === "ar" ? "en" : "ar")}>{language === "ar" ? "English" : "العربية"}</button><span className="cashier">{shift?.cashierId ?? cashierId}</span></div></header>
    <main>
      <section className="catalog">
        <div className="title"><div><p>{tr.shift}: {shift ? tr.shiftReady : tr.openShift}</p><h1>{tr.choose}</h1></div><div className="search"><Search size={19}/><input aria-label={tr.search} placeholder={tr.search} value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
        {!shift && <div className="shift-controls"><input aria-label={tr.cashierId} placeholder={tr.cashierId} value={cashierId} onChange={e=>setCashierId(e.target.value)}/><input aria-label={tr.openingFloat} placeholder={tr.openingFloat} inputMode="decimal" value={openingFloat} onChange={e=>setOpeningFloat(e.target.value)}/><button onClick={openShift} disabled={busy}>{tr.openShift}</button></div>}
        {shift && <div className="shift-controls"><input aria-label={tr.countedCash} placeholder={tr.countedCash} inputMode="decimal" value={countedCash} onChange={e=>setCountedCash(e.target.value)}/><button onClick={closeShift} disabled={busy||cart.length>0}>{tr.closeShift}</button></div>}
        <nav>{[["all",tr.all],["coffee",tr.coffee],["cold",tr.cold],["bakery",tr.bakery]].map(([id,label])=><button key={id} className={category===id?"active":""} onClick={()=>setCategory(id)}>{label}</button>)}</nav>
        <div className="products">{visible.map(p=><button className="product" key={p.id} onClick={()=>add(p)} disabled={p.stock===0} aria-label={`${language === "ar" ? p.nameAr : p.nameEn} — ${formatSar(p.price, language === "ar" ? "ar-SA" : "en-SA")}`}>
          <span className="cup"><Coffee/></span><span className="stock">{p.stock === 0 ? tr.soldOut : `${tr.available} ${p.stock}`}</span><h3>{language === "ar" ? p.nameAr : p.nameEn}</h3><small>{language === "ar" ? p.nameEn : p.nameAr}</small><strong>{formatSar(p.price, language === "ar" ? "ar-SA" : "en-SA")}</strong>
        </button>)}{visible.length === 0 && <div className="no-results">{tr.noResults}</div>}</div>
      </section>
      <aside>
        <div className="order-title"><div><ShoppingBag/><div><h2>{tr.order}</h2><small>{cart.reduce((s,p)=>s+p.quantity,0)} {tr.items}</small></div></div><button onClick={()=>setCart([])} disabled={cart.length === 0 || busy}>{tr.clear}</button></div>
        <div className="order-type">{([["dine_in",tr.dineIn],["takeaway",tr.takeaway],["delivery",tr.delivery]] as const).map(([id,label])=><button key={id} className={orderType===id?"selected":""} onClick={()=>setOrderType(id)}>{label}</button>)}</div>
        <div className="loyalty"><div className="customer-search"><input inputMode="tel" autoComplete="tel" value={customerMobile} onChange={e=>{setCustomerMobile(e.target.value);setLoyalty(undefined);setRedeemFreeDrink(false);}} placeholder={tr.customer}/><button onClick={loadLoyalty}>{tr.lookup}</button></div>{loyalty&&<><p><b>{loyalty.points} {tr.points}</b><span>{loyalty.visits} {tr.visits} · {loyalty.tier}</span></p>{loyalty.points>=FREE_DRINK_POINTS&&<label><input type="checkbox" checked={redeemFreeDrink} onChange={e=>setRedeemFreeDrink(e.target.checked)}/>{tr.freeDrink}</label>}</>}</div>
        <div className="lines">{cart.length===0?<div className="empty"><ShoppingBag/><p>{tr.empty}</p><small>{tr.start}</small></div>:cart.map(p=><div className="line" key={p.id}><div><b>{language === "ar" ? p.nameAr : p.nameEn}</b><small>{formatSar(p.price, language === "ar" ? "ar-SA" : "en-SA")}</small></div><div className="stepper"><button onClick={()=>quantity(p.id,-1)}>{p.quantity===1?<Trash2/>:<Minus/>}</button><span>{p.quantity}</span><button onClick={()=>quantity(p.id,1)}><Plus/></button></div></div>)}</div>
        <div className="summary"><p><span>{tr.beforeTax}</span><b>{formatSar(totals.taxable, language === "ar" ? "ar-SA" : "en-SA")}</b></p><p><span>{tr.vat}</span><b>{formatSar(totals.tax, language === "ar" ? "ar-SA" : "en-SA")}</b></p><div><span>{tr.total}</span><strong>{formatSar(totals.total, language === "ar" ? "ar-SA" : "en-SA")}</strong></div></div>
        <div className="payment-method"><label><input type="radio" name="payment" checked={paymentMethod === "cash"} onChange={()=>setPaymentMethod("cash")}/>{tr.cash}</label><label><input type="radio" name="payment" checked={paymentMethod === "mada"} onChange={()=>setPaymentMethod("mada")}/>{tr.mada}</label></div>
        {paymentMethod === "cash" && totals.total > 0 && <div className="cash-entry"><input aria-label={tr.tendered} placeholder={tr.tendered} inputMode="decimal" value={cashReceived} onChange={e=>setCashReceived(e.target.value)}/>{validCash && <small>{tr.change}: {formatSar(cashHalalas-totals.total,language === "ar" ? "ar-SA" : "en-SA")}</small>}</div>}
        {message&&<div className="message" role="status">{message}</div>}
        <button className="pay" onClick={checkout} disabled={!canCheckout}>{busy?tr.paying:`${tr.pay} ${formatSar(totals.total, language === "ar" ? "ar-SA" : "en-SA")}`}</button>
      </aside>
    </main>
  </div>;
}
