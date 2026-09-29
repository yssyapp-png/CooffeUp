import { StyleSheet } from "react-native";

export const colors = {
  ink: "#16231d", muted: "#737a73", line: "#e2ddd1", paper: "#f4f1e9", card: "#ffffff",
  brand: "#18392d", brandInk: "#2e6b50", brandSoft: "#edf6f0", gold: "#e9c77d", bronze: "#7f5b28",
  danger: "#a74335", dangerSoft: "#fbecea", warn: "#8a5a00", warnSoft: "#fff5de"
};

/** Arabic-first layout: rows run right-to-left and text is right-aligned explicitly. */
export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { backgroundColor: colors.brand, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "#fff", fontWeight: "800", fontSize: 20 },
  headerNote: { color: "#b9ddc9", fontSize: 12, textAlign: "right" },
  body: { padding: 16, gap: 12 },
  title: { textAlign: "right", fontWeight: "800", fontSize: 22, color: colors.ink },
  text: { textAlign: "right", color: colors.ink },
  muted: { textAlign: "right", color: colors.muted, fontSize: 12 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.line, gap: 8 },
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  between: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", textAlign: "right", color: colors.ink, flexGrow: 1 },
  primary: { backgroundColor: colors.brand, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  ghost: { borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, alignItems: "center" },
  ghostText: { color: colors.ink, fontWeight: "600" },
  chip: { borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: "#e9e5db" },
  chipActive: { backgroundColor: colors.brand },
  chipText: { color: "#625f58" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.4 },
  notice: { borderRadius: 10, padding: 10 },
  noticeText: { textAlign: "right", fontSize: 13 }
});
