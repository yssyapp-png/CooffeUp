import { useEffect, useMemo, useState } from "react";
import { calculateTotals, FREE_DRINK_POINTS, formatSar, type LoyaltySnapshot, type Product } from "@cooffeup/shared";
import { Coffee, Minus, Plus, Search, ShoppingBag, Trash2, Wifi } from "lucide-react";

type CartItem = Product & { quantity: number };
type Language = "ar" | "en";
const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const copy = {
  ar: {pos:"نقطة البيع",connected:"النظام متصل وآمن",shift:"الوردية الصباحية",choose:"اختر المنتجات",search:"ابحث بالاسم أو الرمز",all:"الكل",coffee:"القهوة",cold:"المشروبات الباردة",bakery:"المخبوزات",available:"متوفر",order:"الطلب الحالي",items:"أصناف",clear:"مسح",dineIn:"محلي",takeaway:"سفري",delivery:"توصيل",empty:"السلة فارغة",start:"اختر منتجًا لبدء الطلب",beforeTax:"المجموع قبل الضريبة",vat:"ضريبة القيمة المضافة (15%)",total:"الإجمالي",paying:"جارٍ تنفيذ الدفع...",pay:"دفع",customer:"رقم جوال العميل 05xxxxxxxx",lookup:"عرض النقاط",points:"نقطة",visits:"زيارة",freeDrink:"استبدال مشروب مجاني",paid:"تم الدفع — الإيصال",serverError:"تعذر الاتصال بالخادم",paymentFailed:"فشل الدفع"},
  en: {pos:"Point of Sale",connected:"System online and secure",shift:"Morning shift",choose:"Choose products",search:"Search by name or SKU",all:"All",coffee:"Coffee",cold:"Cold drinks",bakery:"Bakery",available:"In stock",order:"Current order",items:"items",clear:"Clear",dineIn:"Dine in",takeaway:"Takeaway",delivery:"Delivery",empty:"Cart is empty",start:"Choose a product to start",beforeTax:"Subtotal before VAT",vat:"VAT (15%)",total:"Total",paying:"Processing payment...",pay:"Pay",customer:"Customer mobile 05xxxxxxxx",lookup:"View points",points:"points",visits:"visits",freeDrink:"Redeem a free drink",paid:"Paid — receipt",serverError:"Could not connect to server",paymentFailed:"Payment failed"}
};

export function App() {
  const [products,setProducts] = useState<Product[]>([]);
  const [cart,setCart] = useState<CartItem[]>([]);
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [language,setLanguage] = useState<Language>("ar");
  const [customerMobile,setCustomerMobile] = useState("");
  const [loyalty,setLoyalty] = useState<LoyaltySnapshot>();
  const [redeemFreeDrink,setRedeemFreeDrink] = useState(false);
  const tr = copy[language];
  useEffect(() => { fetch(`${API}/api/v1/products`).then(r=>r.json()).then(r=>setProducts(r.data)).catch(()=>setMessage(copy[language].serverError)); }, [language]);
  const visible = products.filter(p => `${p.nameAr} ${p.nameEn} ${p.sku}`.toLowerCase().includes(query.toLowerCase()));
  const checkoutLines = useMemo(() => {
    const lines = cart.map(p=>({productId:p.id,name:language === "ar" ? p.nameAr : p.nameEn,unitPrice:p.price,quantity:p.quantity,taxRateBps:p.taxRateBps,discount:0}));
    if (redeemFreeDrink) {
      const eligible = lines.filter(line => products.find(p=>p.id===line.productId)?.rewardEligible).sort((a,b)=>b.unitPrice-a.unitPrice)[0];
      if (eligible) eligible.discount = eligible.unitPrice;
    }
    return lines;
  },[cart,language,products,redeemFreeDrink]);
  const totals = useMemo(() => calculateTotals(checkoutLines),[checkoutLines]);
  const add = (product:Product) => setCart(current => current.some(p=>p.id===product.id) ? current.map(p=>p.id===product.id?{...p,quantity:p.quantity+1}:p) : [...current,{...product,quantity:1}]);
  const quantity = (id:string,delta:number) => setCart(current=>current.map(p=>p.id===id?{...p,quantity:p.quantity+delta}:p).filter(p=>p.quantity>0));
  async function loadLoyalty() {
    if (customerMobile.trim().length < 9) return;
    const response = await fetch(`${API}/api/v1/customers/${encodeURIComponent(customerMobile.trim())}/loyalty`);
    const body = await response.json();
    if (response.ok) { setLoyalty(body.data); setRedeemFreeDrink(false); }
  }
  async function checkout() {
    if (!cart.length || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify({type:"takeaway",customerMobile:customerMobile.trim() || undefined,redeemReward:redeemFreeDrink ? "free_drink" : undefined,lines:cart.map(p=>({productId:p.id,quantity:p.quantity})),payments:[{method:"mada",amount:totals.total}]})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? tr.paymentFailed);
      setMessage(`${tr.paid} ${body.data.receiptNumber}`); setCart([]); setLoyalty(body.data.loyalty); setRedeemFreeDrink(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ"); } finally { setBusy(false); }
  }
  return <div className="shell" dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
    <header><div className="brand"><span><Coffee size={22}/></span><div><b>CooffeUp</b><small>{tr.pos}</small></div></div><div className="status"><Wifi size={16}/> {tr.connected}</div><div className="header-actions"><button className="language" onClick={()=>setLanguage(language === "ar" ? "en" : "ar")}>{language === "ar" ? "English" : "العربية"}</button><button className="cashier">عبدالله · {tr.pos}</button></div></header>
    <main>
      <section className="catalog">
        <div className="title"><div><p>{tr.shift}</p><h1>{tr.choose}</h1></div><div className="search"><Search size={19}/><input aria-label={tr.search} placeholder={tr.search} value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
        <nav><button className="active">{tr.all}</button><button>{tr.coffee}</button><button>{tr.cold}</button><button>{tr.bakery}</button></nav>
        <div className="products">{visible.map(p=><button className="product" key={p.id} onClick={()=>add(p)} disabled={p.stock===0}>
          <span className="cup"><Coffee/></span><span className="stock">{tr.available} {p.stock}</span><h3>{language === "ar" ? p.nameAr : p.nameEn}</h3><small>{language === "ar" ? p.nameEn : p.nameAr}</small><strong>{formatSar(p.price, language === "ar" ? "ar-SA" : "en-SA")}</strong>
        </button>)}</div>
      </section>
      <aside>
        <div className="order-title"><div><ShoppingBag/><div><h2>{tr.order}</h2><small>{cart.reduce((s,p)=>s+p.quantity,0)} {tr.items}</small></div></div><button onClick={()=>setCart([])}>{tr.clear}</button></div>
        <div className="order-type"><button>{tr.dineIn}</button><button className="selected">{tr.takeaway}</button><button>{tr.delivery}</button></div>
        <div className="loyalty"><div className="customer-search"><input inputMode="tel" autoComplete="tel" value={customerMobile} onChange={e=>{setCustomerMobile(e.target.value);setLoyalty(undefined);setRedeemFreeDrink(false);}} placeholder={tr.customer}/><button onClick={loadLoyalty}>{tr.lookup}</button></div>{loyalty&&<><p><b>{loyalty.points} {tr.points}</b><span>{loyalty.visits} {tr.visits} · {loyalty.tier}</span></p>{loyalty.points>=FREE_DRINK_POINTS&&<label><input type="checkbox" checked={redeemFreeDrink} onChange={e=>setRedeemFreeDrink(e.target.checked)}/>{tr.freeDrink}</label>}</>}</div>
        <div className="lines">{cart.length===0?<div className="empty"><ShoppingBag/><p>{tr.empty}</p><small>{tr.start}</small></div>:cart.map(p=><div className="line" key={p.id}><div><b>{language === "ar" ? p.nameAr : p.nameEn}</b><small>{formatSar(p.price, language === "ar" ? "ar-SA" : "en-SA")}</small></div><div className="stepper"><button onClick={()=>quantity(p.id,-1)}>{p.quantity===1?<Trash2/>:<Minus/>}</button><span>{p.quantity}</span><button onClick={()=>quantity(p.id,1)}><Plus/></button></div></div>)}</div>
        <div className="summary"><p><span>{tr.beforeTax}</span><b>{formatSar(totals.taxable, language === "ar" ? "ar-SA" : "en-SA")}</b></p><p><span>{tr.vat}</span><b>{formatSar(totals.tax, language === "ar" ? "ar-SA" : "en-SA")}</b></p><div><span>{tr.total}</span><strong>{formatSar(totals.total, language === "ar" ? "ar-SA" : "en-SA")}</strong></div></div>
        {message&&<div className="message" role="status">{message}</div>}
        <button className="pay" onClick={checkout} disabled={!cart.length||busy}>{busy?tr.paying:`${tr.pay} ${formatSar(totals.total, language === "ar" ? "ar-SA" : "en-SA")}`}</button>
      </aside>
    </main>
  </div>;
}
