import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { api, loadApiUrl, setSession } from "./src/api";
import { LoginScreen, type SessionStaff } from "./src/LoginScreen";
import { useOutbox } from "./src/outbox";
import { PosScreen } from "./src/PosScreen";
import { ShiftScreen } from "./src/ShiftScreen";
import { readSession, writeSession } from "./src/storage";
import { colors, ui } from "./src/theme";

interface Session { token: string; staff: SessionStaff }
interface BranchOption { id: string; name: string; active: boolean }

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);
  const [tab, setTab] = useState<"pos" | "shift">("pos");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState("main");
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const outbox = useOutbox(Boolean(session));

  const logout = useCallback(async () => {
    await writeSession(null);
    setSession(null, null);
    setSessionState(null);
  }, []);

  useEffect(() => {
    void (async () => {
      await loadApiUrl();
      const saved = await readSession<Session & { branchId?: string }>();
      if (saved) {
        const branch = saved.staff.branchId ?? saved.branchId ?? "main";
        setSession(saved.token, branch, () => void logout());
        setBranchId(branch);
        setSessionState(saved);
      }
      setReady(true);
    })();
  }, [logout]);

  // Staff tied to a branch always work there; others can switch between active branches.
  const refreshContext = useCallback(async () => {
    if (!session) return;
    try {
      setBranches((await api<{ data: BranchOption[] }>("/api/v1/branches")).data.filter((branch) => branch.active));
      const current = await api<{ data: unknown; requireOpenShift: boolean }>("/api/v1/shifts/current");
      setShiftOpen(current.requireOpenShift ? Boolean(current.data) : true);
    } catch {
      setShiftOpen(null);
    }
  }, [session]);
  useEffect(() => { void refreshContext(); }, [refreshContext, branchId]);

  async function switchBranch(id: string) {
    if (!session || session.staff.branchId) return;
    setSession(session.token, id, () => void logout());
    setBranchId(id);
    await writeSession({ ...session, branchId: id });
  }

  if (!ready) return <SafeAreaProvider><View style={[ui.safe, { justifyContent: "center" }]}><ActivityIndicator color={colors.brand} /></View></SafeAreaProvider>;

  return <SafeAreaProvider><SafeAreaView style={ui.safe} edges={["top", "bottom"]}>
    <StatusBar style="light" />
    <View style={ui.header}>
      <View>
        <Text style={ui.brand}>CooffeUp</Text>
        <Text style={ui.headerNote}>{session ? `${session.staff.name} · ${branches.find((branch) => branch.id === branchId)?.name ?? ""}` : "نقطة البيع"}</Text>
      </View>
      <Text style={ui.headerNote}>{outbox.online ? "● متصل" : "○ بلا اتصال"}{outbox.pending ? ` · ${outbox.pending} بانتظار المزامنة` : ""}</Text>
    </View>

    {!session ? <LoginScreen onLogin={async (token, staff) => {
      const branch = staff.branchId ?? branchId;
      setSession(token, branch, () => void logout());
      setBranchId(branch);
      await writeSession({ token, staff, branchId: branch });
      setSessionState({ token, staff });
    }} /> : <>
      {!session.staff.branchId && branches.length > 1 && <View style={[ui.row, { paddingHorizontal: 16, paddingTop: 10, flexWrap: "wrap" }]}>
        {branches.map((branch) => <Pressable key={branch.id} style={[ui.chip, branchId === branch.id && ui.chipActive]} onPress={() => switchBranch(branch.id)} accessibilityRole="button">
          <Text style={branchId === branch.id ? ui.chipTextActive : ui.chipText}>{branch.name}</Text>
        </Pressable>)}
      </View>}
      <View style={{ flex: 1 }}>
        {tab === "pos" ? <PosScreen key={branchId} outbox={outbox} shiftOpen={shiftOpen} onSold={() => void refreshContext()} />
          : <ShiftScreen key={branchId} onChange={(open) => setShiftOpen(open)} />}
      </View>
      <View style={{ flexDirection: "row-reverse", borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: "#fff" }}>
        {([["pos", "البيع"], ["shift", "الوردية"]] as const).map(([id, label]) => <Pressable key={id} style={{ flex: 1, paddingVertical: 14, alignItems: "center" }} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
          <Text style={{ fontWeight: tab === id ? "800" : "500", color: tab === id ? colors.brand : colors.muted }}>{label}</Text>
        </Pressable>)}
        <Pressable style={{ flex: 1, paddingVertical: 14, alignItems: "center" }} onPress={logout} accessibilityRole="button"><Text style={{ color: colors.danger }}>خروج</Text></Pressable>
      </View>
    </>}
  </SafeAreaView></SafeAreaProvider>;
}
