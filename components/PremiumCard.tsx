import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Radius, Shadows } from "@/constants/theme";

type PremiumCardVariant = "default" | "tint" | "hero" | "glass";

const VARIANT_COLORS: Record<PremiumCardVariant, readonly [string, string]> = {
  default: ["rgba(10, 23, 38, 0.98)", "rgba(7, 17, 29, 0.98)"],
  tint: ["rgba(18, 35, 56, 0.98)", "rgba(10, 22, 36, 0.98)"],
  hero: ["rgba(15, 34, 54, 0.98)", "rgba(8, 18, 31, 0.98)"],
  glass: ["rgba(15, 31, 48, 0.82)", "rgba(9, 20, 33, 0.82)"],
};

export function PremiumCard({
  children,
  style,
  contentStyle,
  variant = "default",
  glow = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: PremiumCardVariant;
  glow?: boolean;
}>) {
  return (
    <LinearGradient
      colors={VARIANT_COLORS[variant]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.shell, variant === "hero" && styles.heroShell, glow && styles.glowShell, style]}
    >
      {glow ? <View pointerEvents="none" style={styles.glowOrb} /> : null}
      <View style={contentStyle}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(105, 164, 255, 0.16)",
    overflow: "hidden",
    backgroundColor: Colors.card,
    ...Shadows.card,
  },
  heroShell: {
    borderColor: "rgba(94, 235, 255, 0.18)",
    ...Shadows.cardStrong,
  },
  glowShell: {
    shadowColor: "#5EEBFF",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  glowOrb: {
    position: "absolute",
    top: -40,
    right: -10,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(94, 235, 255, 0.08)",
  },
});
