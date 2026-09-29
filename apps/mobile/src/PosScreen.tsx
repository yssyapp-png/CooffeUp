import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { calculateTotals, distributeDiscount, formatSar, parseSar, type CartLine, type OrderRecord, type PaymentMethod, type Product } from "@cooffeup/shared";
import { api, ApiError } from "./api";
import { Notice } from "./Notice";
import { newId, queueSale, type useOutbox } from "./outbox";
import { readJson, writeJson } from "./storage";
import { colors, ui } from "./theme";

interface CustomerOption { id: string; name: string; loyalty: { points: number; tierLabel: string; freeDrinksAvailable: number } }
type Receipt = { receiptNumber: string; total: number; change: number; offline: boolean; points?: number };

const CATALOG_KEY = "cooffeup.catalog";
const METHODS: Array<{ id: PaymentMethod; label: string }> = [{ id: "cash", label: "نقدًا" }, { id: "mada", label: "مدى" }, { id: "card", label: "بطاقة" }, { id: "apple_pay", label: "Apple Pay" }];

/** Same rule as the server and web till: the reward covers one unit of the priciest eligible drink. */
function applyReward(lines: CartLine[], products: Product[]) {
  const eligible = lines.filter((line) => products.find((product) => product.id === line.productId)?.rewardEligible).sort((a, b) => b.unitPrice - a.unitPrice)[0];
  return eligible ? lines.map((line) => (line === eligible ? { ...line, discount: line.unitPrice } : line)) : lines;
}

export function PosScreen({ outbox, shiftOpen, onSold }: { outbox: ReturnType<typeof useOutbox>; shiftOpen: boolean | null; onSold: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [redeem, setRedeem] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const { data } = await api<{ data: Product[] }>("/api/v1/products");
      setProducts(data);
      await writeJson(CATALOG_KEY, data);
    } catch {
      // Offline: keep selling from the last catalogue this phone downloaded.
      setProducts(await readJson<Product[]>(CATALOG_KEY, []));
    }
  }, []);
  useEffect(() => { void loadProducts(); }, [loadProducts, receipt]);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const visible = products.filter((product) => category === "all" || product.category === category);
  const baseLines: CartLine[] = products.filter((product) => cart[product.id]).map((product) => ({ productId: product.id, name: product.nameAr, unitPrice: product.price, quantity: cart[product.id], taxRateBps: product.taxRateBps }));
  const rewardOn = redeem && Boolean(customer?.loyalty.freeDrinksAvailable);
  const lines = rewardOn ? applyReward(baseLines, products) : baseLines;
  const totals = calculateTotals(distributeDiscount(lines, 0));
  const cashValue = parseSar(cash);
  const paid = method === "cash" ? (cash.trim() === "" ? totals.total : cashValue ?? -1) : totals.total;
  const change = Math.max(paid - totals.total, 0);
  const blocked = outbox.online && shiftOpen === false;
  const canPay = baseLines.length > 0 && !busy && !blocked && paid >= totals.total;

  const add = (product: Product) => setCart((current) => {
    const quantity = (current[product.id] ?? 0) + 1;
    return outbox.online && quantity > product.stock ? current : { ...current, [product.id]: quantity };
  });
  const remove = (id: string) => setCart((current) => {
    const next = { ...current, [id]: (current[id] ?? 0) - 1 };
    if (next[id] <= 0) delete next[id];
    return next;
  });

  async function findCustomer() {
    setError("");
    try {
      const { data } = await api<{ data: CustomerOption[] }>(`/api/v1/customers?q=${encodeURIComponent(phone)}`);
      setCustomer(data[0] ?? null);
      if (!data[0]) setError("لا يوجد عميل بهذا الرقم");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "");
    }
  }

  function reset() {
    setCart({}); setCustomer(null); setPhone(""); setRedeem(false); setCash("");
  }

  async function checkout() {
    if (!canPay) return;
    setBusy(true);
    setError("");
    const key = newId();
    const order = {
      type: "takeaway" as const,
      lines: baseLines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      payments: totals.total === 0 ? [] : [{ method, amount: method === "cash" ? paid : totals.total }],
      ...(customer ? { customerId: customer.id } : {}),
      ...(rewardOn ? { redeemReward: "free_drink" as const } : {})
    };
    const queue = async () => {
      const entry = await queueSale(key, order);
      await outbox.refresh();
      setReceipt({ receiptNumber: entry.localReceipt, total: totals.total, change, offline: true });
      reset();
    };
    try {
      if (!outbox.online) await queue();
      else {
        const response = await api<{ data: OrderRecord; change: number }>("/api/v1/orders", { method: "POST", body: order, headers: { "idempotency-key": key } });
        setReceipt({ receiptNumber: response.data.receiptNumber, total: response.data.totals.total, change: response.change, offline: false, points: response.data.loyalty?.earned });
        reset();
        onSold();
      }
    } catch (reason) {
      // The request may have reached the server; the same key makes the later replay safe.
      if (reason instanceof ApiError && reason.status === 0) await queue();
      else setError(reason instanceof Error ? reason.message : "");
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
    {blocked && <Notice tone="warning" text="لا توجد وردية مفتوحة في هذا الفرع. افتحها من تبويب الوردية." />}
    {(!outbox.online || outbox.pending > 0) && <Notice tone="warning" text={`${outbox.online ? "متصل" : "بلا اتصال — تُحفظ المبيعات على الجهاز"} · بانتظار المزامنة: ${outbox.pending}`} />}
    {outbox.needsReview.map((entry) => <View key={entry.id} style={ui.between}>
      <Text style={[ui.muted, { color: colors.danger }]}>{entry.localReceipt}: {entry.lastError}</Text>
      <Pressable onPress={() => outbox.discard(entry.id)} accessibilityRole="button"><Text style={ui.ghostText}>تجاهل</Text></Pressable>
    </View>)}

    <ScrollView horizontal contentContainerStyle={{ gap: 8, flexDirection: "row-reverse" }} showsHorizontalScrollIndicator={false}>
      {["all", ...categories].map((name) => <Pressable key={name} style={[ui.chip, category === name && ui.chipActive]} onPress={() => setCategory(name)} accessibilityRole="button">
        <Text style={category === name ? ui.chipTextActive : ui.chipText}>{name === "all" ? "الكل" : name}</Text>
      </Pressable>)}
    </ScrollView>

    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }}>
      {visible.map((product) => {
        const soldOut = outbox.online && product.stock <= 0;
        return <Pressable key={product.id} disabled={soldOut} onPress={() => add(product)} accessibilityRole="button" accessibilityLabel={`${product.nameAr} ${formatSar(product.price)}`}
          style={[ui.card, { width: "48%", minHeight: 120 }, soldOut && ui.disabled]}>
          <Text style={[ui.text, { fontWeight: "700", fontSize: 16 }]}>{product.nameAr}</Text>
          <Text style={ui.muted}>{soldOut ? "نفد" : `متوفر ${product.stock}`}</Text>
          <Text style={[ui.text, { color: colors.bronze, fontWeight: "700" }]}>{formatSar(product.price)}</Text>
          {cart[product.id] ? <Text style={{ position: "absolute", left: 10, top: 10, backgroundColor: colors.brand, color: "#fff", borderRadius: 12, paddingHorizontal: 8, overflow: "hidden" }}>{cart[product.id]}</Text> : null}
        </Pressable>;
      })}
    </View>

    <View style={ui.card}>
      <Text style={[ui.title, { fontSize: 18 }]}>الطلب الحالي</Text>
      {baseLines.length === 0 ? <Text style={ui.muted}>اختر منتجًا لبدء الطلب</Text> : baseLines.map((line) => <View key={line.productId} style={ui.between}>
        <Text style={ui.text}>{line.name} × {line.quantity}</Text>
        <View style={ui.row}>
          <Text style={ui.text}>{formatSar(line.unitPrice * line.quantity)}</Text>
          <Pressable style={[ui.ghost, { paddingVertical: 4 }]} onPress={() => remove(line.productId)} accessibilityRole="button" accessibilityLabel={`إنقاص ${line.name}`}><Text>−</Text></Pressable>
        </View>
      </View>)}

      <View style={ui.row}>
        <TextInput style={ui.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="جوال العميل 05XXXXXXXX" accessibilityLabel="جوال العميل" />
        <Pressable style={ui.ghost} onPress={findCustomer} accessibilityRole="button"><Text style={ui.ghostText}>بحث</Text></Pressable>
      </View>
      {customer && <View style={[ui.notice, { backgroundColor: colors.brandSoft }]}>
        <Text style={[ui.text, { fontWeight: "700" }]}>{customer.name}</Text>
        <Text style={ui.muted}>{customer.loyalty.tierLabel} · {customer.loyalty.points} نقطة</Text>
        {customer.loyalty.freeDrinksAvailable > 0 && <View style={ui.between}>
          <Text style={[ui.text, { color: colors.bronze, fontWeight: "700" }]}>استبدال مشروب مجاني (100 نقطة)</Text>
          <Switch value={redeem} onValueChange={setRedeem} accessibilityLabel="استبدال مشروب مجاني" />
        </View>}
      </View>}

      <View style={ui.between}><Text style={ui.muted}>المجموع قبل الضريبة</Text><Text style={ui.text}>{formatSar(totals.taxable)}</Text></View>
      {totals.discount > 0 && <View style={ui.between}><Text style={ui.muted}>مكافأة الولاء</Text><Text style={ui.text}>- {formatSar(totals.discount)}</Text></View>}
      <View style={ui.between}><Text style={ui.muted}>ضريبة القيمة المضافة</Text><Text style={ui.text}>{formatSar(totals.tax)}</Text></View>
      <View style={ui.between}><Text style={[ui.text, { fontSize: 18, fontWeight: "800" }]}>الإجمالي</Text><Text style={[ui.text, { fontSize: 18, fontWeight: "800" }]}>{formatSar(totals.total)}</Text></View>

      {totals.total > 0 && <>
        <View style={[ui.row, { flexWrap: "wrap" }]}>{METHODS.map((option) => <Pressable key={option.id} style={[ui.chip, method === option.id && ui.chipActive]} onPress={() => setMethod(option.id)} accessibilityRole="button">
          <Text style={method === option.id ? ui.chipTextActive : ui.chipText}>{option.label}</Text>
        </Pressable>)}</View>
        {method === "cash" && <TextInput style={ui.input} value={cash} onChangeText={setCash} keyboardType="decimal-pad" placeholder={`المبلغ المستلم (${(totals.total / 100).toFixed(2)})`} accessibilityLabel="المبلغ المستلم" />}
        {change > 0 && <Text style={[ui.text, { color: colors.brandInk }]}>الباقي للعميل: {formatSar(change)}</Text>}
      </>}
      {error ? <Notice tone="error" text={error} /> : null}
      <Pressable style={[ui.primary, !canPay && ui.disabled]} disabled={!canPay} onPress={checkout} accessibilityRole="button">
        <Text style={ui.primaryText}>{busy ? "جارٍ التنفيذ..." : totals.total === 0 && baseLines.length ? "تسجيل الطلب المجاني" : `دفع ${formatSar(totals.total)}`}</Text>
      </Pressable>
    </View>

    <Modal visible={receipt !== null} transparent animationType="fade" onRequestClose={() => setReceipt(null)}>
      <View style={{ flex: 1, backgroundColor: "#0b1a1480", justifyContent: "center", padding: 24 }}>
        {receipt && <View style={ui.card}>
          <Text style={ui.title}>{receipt.offline ? "تم حفظ البيع على الجهاز" : "تم الدفع بنجاح"}</Text>
          <Text style={[ui.text, { fontSize: 28, fontWeight: "800", color: colors.brand }]}>{formatSar(receipt.total)}</Text>
          <Text style={ui.text}>رقم الإيصال: {receipt.receiptNumber}</Text>
          {receipt.change > 0 && <Text style={ui.text}>الباقي للعميل: {formatSar(receipt.change)}</Text>}
          {receipt.points ? <Text style={[ui.text, { color: colors.brandInk }]}>نقاط مكتسبة: {receipt.points}</Text> : null}
          {receipt.offline && <Notice tone="warning" text="سيُرسل البيع تلقائيًا عند عودة الاتصال." />}
          <Pressable style={ui.primary} onPress={() => setReceipt(null)} accessibilityRole="button"><Text style={ui.primaryText}>طلب جديد</Text></Pressable>
        </View>}
      </View>
    </Modal>
  </ScrollView>;
}
