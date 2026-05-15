import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Tone = "brand" | "accent" | "neutral" | "success" | "subtle";

const warnedLegacyTones = new Set<string>();

function warnDeprecatedLegacyTone(tone: Tone) {
  if (!__DEV__) {
    return;
  }
  if (tone !== "accent" && tone !== "success") {
    return;
  }
  if (warnedLegacyTones.has(tone)) {
    return;
  }
  warnedLegacyTones.add(tone);
  console.warn(
    `[ui-regression] PillBadge tone "${tone}" is mapped to the canonical premium badge palette. Do not reintroduce bright aqua/green variants.`,
  );
}

// Centralized premium badge palette. Older aqua/green pills kept leaking back in
// when screens imported or recreated legacy variants, so all badge surfaces map
// through this restrained navy-first system now.
const TONE_STYLES: Record<Tone, { backgroundColor: string; borderColor: string; color: string }> = {
  brand: {
    backgroundColor: "rgba(10, 20, 34, 0.92)",
    borderColor: "rgba(71, 123, 255, 0.26)",
    color: Colors.premium,
  },
  accent: {
    backgroundColor: "rgba(10, 20, 34, 0.92)",
    borderColor: "rgba(71, 123, 255, 0.26)",
    color: Colors.premium,
  },
  neutral: {
    backgroundColor: "rgba(18, 30, 46, 0.88)",
    borderColor: Colors.borderSoft,
    color: Colors.textSoft,
  },
  success: {
    backgroundColor: "rgba(14, 24, 40, 0.92)",
    borderColor: "rgba(52, 96, 207, 0.26)",
    color: Colors.textStrong,
  },
  subtle: {
    backgroundColor: "rgba(255,255,255,0.03)",
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
  warnDeprecatedLegacyTone(tone);
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
