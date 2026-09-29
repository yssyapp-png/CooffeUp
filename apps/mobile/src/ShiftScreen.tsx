import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatSar, parseSar } from "@cooffeup/shared";
import { api } from "./api";
import { Notice } from "./Notice";
import { ui } from "./theme";

interface ShiftView { id: string; openedAt: string; openingFloat: number; summary: { orders: number; cashSales: number; expectedCash: number } }
interface Closed { expectedCash: number; countedCash: number; variance: number }

export function ShiftScreen({ onChange }: { onChange: (open: boolean) => void }) {
  const [shift, setShift] = useState<ShiftView | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [closed, setClosed] = useState<Closed | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: ShiftView | null }>("/api/v1/shifts/current");
      setShift(response.data);
      onChange(Boolean(response.data));
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "" });
    }
  }, [onChange]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    const value = parseSar(amount);
    if (value === null) return setMessage({ tone: "error", text: "مبلغ غير صحيح" });
    setMessage(null);
    try {
      if (!shift) {
        await api("/api/v1/shifts/open", { method: "POST", body: { openingFloat: value } });
        setClosed(null);
        setMessage({ tone: "success", text: "تم فتح الوردية" });
      } else {
        const { data } = await api<{ data: Closed }>(`/api/v1/shifts/${shift.id}/close`, { method: "POST", body: { countedCash: value } });
        setClosed(data);
      }
      setAmount("");
      await load();
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "" });
    }
  }

  return <ScrollView contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
    <Text style={ui.title}>الوردية والصندوق</Text>
    {message && <Notice tone={message.tone} text={message.text} />}
    {closed && <View style={ui.card}>
      <Text style={[ui.text, { fontWeight: "700" }]}>تقرير الإغلاق</Text>
      <View style={ui.between}><Text style={ui.muted}>النقد المتوقع</Text><Text style={ui.text}>{formatSar(closed.expectedCash)}</Text></View>
      <View style={ui.between}><Text style={ui.muted}>النقد المعدود</Text><Text style={ui.text}>{formatSar(closed.countedCash)}</Text></View>
      <View style={ui.between}><Text style={ui.muted}>الفرق</Text><Text style={ui.text}>{formatSar(closed.variance)}</Text></View>
    </View>}
    <View style={ui.card}>
      {shift ? <>
        <Text style={[ui.text, { fontWeight: "700" }]}>الوردية مفتوحة منذ {new Date(shift.openedAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</Text>
        <View style={ui.between}><Text style={ui.muted}>رصيد الافتتاح</Text><Text style={ui.text}>{formatSar(shift.openingFloat)}</Text></View>
        <View style={ui.between}><Text style={ui.muted}>المبيعات النقدية</Text><Text style={ui.text}>{formatSar(shift.summary.cashSales)}</Text></View>
        <View style={ui.between}><Text style={ui.muted}>عدد الطلبات</Text><Text style={ui.text}>{shift.summary.orders}</Text></View>
      </> : <Text style={[ui.text, { fontWeight: "700" }]}>لا توجد وردية مفتوحة</Text>}
      <TextInput style={ui.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel={shift ? "النقد المعدود" : "رصيد الافتتاح"}
        placeholder={shift ? "النقد المعدود في الدرج (ر.س)" : "رصيد الافتتاح (ر.س)"} />
      <Pressable style={ui.primary} onPress={submit} accessibilityRole="button"><Text style={ui.primaryText}>{shift ? "إغلاق الصندوق" : "فتح الوردية"}</Text></Pressable>
    </View>
  </ScrollView>;
}
