import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api, apiUrl, saveApiUrl } from "./api";
import { Notice } from "./Notice";
import { colors, ui } from "./theme";

export interface SessionStaff { id: string; name: string; roleLabel: string; permissions: string[]; maxDiscountBps: number; branchId: string | null }
interface DirectoryEntry { id: string; name: string; roleLabel: string }

export function LoginScreen({ onLogin }: { onLogin: (token: string, staff: SessionStaff) => void }) {
  const [staff, setStaff] = useState<DirectoryEntry[]>([]);
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(apiUrl());
  const [editingServer, setEditingServer] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setStaff((await api<{ data: DirectoryEntry[] }>("/api/v1/auth/staff-directory")).data);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : ""} — ${apiUrl()}`);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(value: string) {
    if (!selected || value.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<{ token: string; staff: SessionStaff }>("/api/v1/auth/login", { method: "POST", body: { staffId: selected.id, pin: value } });
      onLogin(response.token, response.staff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const press = (digit: string) => {
    const next = (pin + digit).slice(0, 8);
    setPin(next);
  };

  return <ScrollView contentContainerStyle={[ui.body, { flexGrow: 1, justifyContent: "center" }]}>
    <View style={ui.card}>
      <Text style={ui.title}>CooffeUp</Text>
      <Text style={ui.muted}>نظام نقاط البيع — الجوال واللوحي</Text>
      {!selected ? <>
        <Text style={[ui.text, { fontWeight: "700", marginTop: 8 }]}>من يستخدم الجهاز؟</Text>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 }}>
          {staff.map((member) => <Pressable key={member.id} style={[ui.ghost, { width: "48%", alignItems: "flex-end" }]} onPress={() => setSelected(member)} accessibilityRole="button">
            <Text style={[ui.text, { fontWeight: "700" }]}>{member.name}</Text><Text style={ui.muted}>{member.roleLabel}</Text>
          </Pressable>)}
        </View>
      </> : <>
        <Pressable onPress={() => { setSelected(null); setPin(""); }} accessibilityRole="button"><Text style={[ui.text, { color: colors.brandInk }]}>← تغيير المستخدم</Text></Pressable>
        <Text style={[ui.title, { fontSize: 18 }]}>{selected.name}</Text>
        <Text style={{ textAlign: "center", fontSize: 28, letterSpacing: 10, color: colors.ink }} accessibilityLabel="الرمز السري">{"•".repeat(pin.length) || "····"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map((key) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={key === "⌫" ? "حذف" : key === "✓" ? "دخول" : key}
            style={[ui.ghost, { width: "30%", paddingVertical: 16 }, key === "✓" && { backgroundColor: colors.brand }]}
            onPress={() => (key === "⌫" ? setPin(pin.slice(0, -1)) : key === "✓" ? void submit(pin) : press(key))}>
            <Text style={[{ fontSize: 20, fontWeight: "700", color: colors.ink }, key === "✓" && { color: "#fff" }]}>{key}</Text>
          </Pressable>)}
        </View>
      </>}
      {error ? <Notice tone="error" text={error} /> : null}
    </View>

    <View style={ui.card}>
      <Pressable onPress={() => setEditingServer(!editingServer)} accessibilityRole="button"><Text style={ui.muted}>عنوان الخادم: {apiUrl()}</Text></Pressable>
      {editingServer && <View style={ui.row}>
        <TextInput style={ui.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:4000" />
        <Pressable style={ui.ghost} accessibilityRole="button" onPress={async () => { await saveApiUrl(server); setEditingServer(false); await load(); }}><Text style={ui.ghostText}>حفظ</Text></Pressable>
      </View>}
    </View>
  </ScrollView>;
}
