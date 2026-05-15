import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Tone = "accent" | "neutral" | "success" | "subtle";

const TONE_STYLES: Record<Tone, { backgroundColor: string; borderColor: string; color: string }> = {
  accent: {
    backgroundColor: "rgba(94, 235, 255, 0.12)",
    borderColor: "rgba(94, 235, 255, 0.18)",
    color: Colors.premium,
  },
  neutral: {
    backgroundColor: "rgba(18, 30, 46, 0.88)",
    borderColor: Colors.borderSoft,
    color: Colors.textSoft,
  },
  success: {
    backgroundColor: "rgba(122, 240, 168, 0.12)",
    borderColor: "rgba(122, 240, 168, 0.20)",
    color: "#7AF0A8",
  },
  subtle: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: Colors.borderSoft,
    color: Colors.textMuted,
  },
};

export function PillBadge({
  children,
  label,
  tone = "accent",
  style,
}: PropsWithChildren<{
  label?: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}>) {
  const toneStyle = TONE_STYLES[tone];

  return (
    <View style={[styles.badge, toneStyle, style]}>
      {children}
      {label ? <Text style={[styles.label, { color: toneStyle.color }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  label: {
    ...Typography.caption,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
