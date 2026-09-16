import { useEffect, useMemo, useState } from "react";
import { calculateTotals, formatSar, type Product } from "@cooffeup/shared";
import { Coffee, Minus, Plus, Search, ShoppingBag, Trash2, Wifi } from "lucide-react";

type CartItem = Product & { quantity: number };
const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function App() {
  const [products,setProducts] = useState<Product[]>([]);
  const [cart,setCart] = useState<CartItem[]>([]);
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  useEffect(() => { fetch(`${API}/api/v1/products`).then(r=>r.json()).then(r=>setProducts(r.data)).catch(()=>setMessage("تعذر الاتصال بالخادم")); }, []);
  const visible = products.filter(p => `${p.nameAr} ${p.nameEn} ${p.sku}`.toLowerCase().includes(query.toLowerCase()));
  const totals = useMemo(() => calculateTotals(cart.map(p=>({productId:p.id,name:p.nameAr,unitPrice:p.price,quantity:p.quantity,taxRateBps:p.taxRateBps}))),[cart]);
  const add = (product:Product) => setCart(current => current.some(p=>p.id===product.id) ? current.map(p=>p.id===product.id?{...p,quantity:p.quantity+1}:p) : [...current,{...product,quantity:1}]);
  const quantity = (id:string,delta:number) => setCart(current=>current.map(p=>p.id===id?{...p,quantity:p.quantity+delta}:p).filter(p=>p.quantity>0));
  async function checkout() {
    if (!cart.length || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify({type:"takeaway",lines:cart.map(p=>({productId:p.id,quantity:p.quantity})),payments:[{method:"mada",amount:totals.total}]})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "فشل الدفع");
      setMessage(`تم الدفع — الإيصال ${body.data.receiptNumber}`); setCart([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ"); } finally { setBusy(false); }
  }
  return <div className="shell">
    <header><div className="brand"><span><Coffee size={22}/></span><div><b>CooffeUp</b><small>نقطة البيع</small></div></div><div className="status"><Wifi size={16}/> النظام متصل وآمن</div><button className="cashier">عبدالله · كاشير</button></header>
    <main>
      <section className="catalog">
        <div className="title"><div><p>الوردية الصباحية</p><h1>اختر المنتجات</h1></div><div className="search"><Search size={19}/><input aria-label="بحث" placeholder="ابحث بالاسم أو الرمز" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
        <nav><button className="active">الكل</button><button>القهوة</button><button>المشروبات الباردة</button><button>المخبوزات</button></nav>
        <div className="products">{visible.map(p=><button className="product" key={p.id} onClick={()=>add(p)} disabled={p.stock===0}>
          <span className="cup"><Coffee/></span><span className="stock">متوفر {p.stock}</span><h3>{p.nameAr}</h3><small>{p.nameEn}</small><strong>{formatSar(p.price)}</strong>
        </button>)}</div>
      </section>
      <aside>
        <div className="order-title"><div><ShoppingBag/><div><h2>الطلب الحالي</h2><small>{cart.reduce((s,p)=>s+p.quantity,0)} أصناف</small></div></div><button onClick={()=>setCart([])}>مسح</button></div>
        <div className="order-type"><button>محلي</button><button className="selected">سفري</button><button>توصيل</button></div>
        <div className="lines">{cart.length===0?<div className="empty"><ShoppingBag/><p>السلة فارغة</p><small>اختر منتجًا لبدء الطلب</small></div>:cart.map(p=><div className="line" key={p.id}><div><b>{p.nameAr}</b><small>{formatSar(p.price)}</small></div><div className="stepper"><button onClick={()=>quantity(p.id,-1)}>{p.quantity===1?<Trash2/>:<Minus/>}</button><span>{p.quantity}</span><button onClick={()=>quantity(p.id,1)}><Plus/></button></div></div>)}</div>
        <div className="summary"><p><span>المجموع قبل الضريبة</span><b>{formatSar(totals.taxable)}</b></p><p><span>ضريبة القيمة المضافة (15%)</span><b>{formatSar(totals.tax)}</b></p><div><span>الإجمالي</span><strong>{formatSar(totals.total)}</strong></div></div>
        {message&&<div className="message" role="status">{message}</div>}
        <button className="pay" onClick={checkout} disabled={!cart.length||busy}>{busy?"جارٍ تنفيذ الدفع...":`دفع ${formatSar(totals.total)}`}</button>
      </aside>
    </main>
  </div>;
}
