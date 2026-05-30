import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Radius, Shadows } from "@/constants/theme";

type PremiumCardVariant = "default" | "tint" | "hero" | "glass";

const VARIANT_COLORS: Record<PremiumCardVariant, readonly [string, string]> = {
  default: ["rgba(21, 19, 18, 0.98)", "rgba(10, 10, 10, 0.98)"],
  tint: ["rgba(29, 24, 20, 0.98)", "rgba(14, 13, 12, 0.98)"],
  hero: ["rgba(32, 27, 23, 0.98)", "rgba(12, 11, 10, 0.98)"],
  glass: ["rgba(24, 22, 20, 0.84)", "rgba(10, 10, 10, 0.84)"],
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
    borderColor: "rgba(216, 163, 104, 0.16)",
    overflow: "hidden",
    backgroundColor: Colors.card,
    ...Shadows.card,
  },
  heroShell: {
    borderColor: "rgba(216, 163, 104, 0.2)",
    ...Shadows.cardStrong,
  },
  glowShell: {
    shadowColor: "#D8A368",
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
    backgroundColor: "rgba(216, 163, 104, 0.08)",
  },
});
