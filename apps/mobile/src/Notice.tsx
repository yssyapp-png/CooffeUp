import { Text, View } from "react-native";
import { colors, ui } from "./theme";

const TONES = {
  info: { backgroundColor: colors.brandSoft, color: colors.brandInk },
  success: { backgroundColor: colors.brandSoft, color: colors.brandInk },
  warning: { backgroundColor: colors.warnSoft, color: colors.warn },
  error: { backgroundColor: colors.dangerSoft, color: colors.danger }
};

export function Notice({ tone = "info", text }: { tone?: keyof typeof TONES; text: string }) {
  return <View style={[ui.notice, { backgroundColor: TONES[tone].backgroundColor }]} accessibilityRole={tone === "error" ? "alert" : "text"}>
    <Text style={[ui.noticeText, { color: TONES[tone].color }]}>{text}</Text>
  </View>;
}
