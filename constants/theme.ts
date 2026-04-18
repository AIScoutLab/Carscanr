import { Platform } from "react-native";
import { colors, motion, radius, shadow, spacing, type } from "@/design/tokens";

export const Colors = {
  background: colors.page,
  backgroundAlt: colors.pageAlt,
  card: colors.surface,
  cardSoft: colors.surfaceSoft,
  cardTint: colors.surfaceTint,
  cardAlt: colors.surfaceStrong,
  text: colors.text,
  textStrong: colors.textStrong,
  textSoft: colors.textSoft,
  textMuted: colors.textMuted,
  textFaint: colors.textFaint,
  border: colors.line,
  borderSoft: colors.lineSoft,
  primary: colors.primaryDeep,
  accent: colors.primary,
  accentSoft: colors.primarySoft,
  success: colors.success,
  successSoft: colors.successSoft,
  warning: colors.warning,
  warningSoft: colors.warningSoft,
  danger: "#D94B5B",
  premium: colors.premium,
  premiumSoft: colors.premiumSoft,
  overlay: colors.overlay,
  shadow: colors.shadow,
  gold: colors.premium,
  accentGlow: "rgba(29, 140, 255, 0.34)",
  cyanGlow: "rgba(94, 231, 255, 0.22)",
  dangerSoft: "rgba(217, 75, 91, 0.18)",
};

export const Spacing = {
  xxs: spacing[1],
  xs: spacing[2],
  sm: spacing[3],
  md: spacing[4],
  lg: spacing[5],
  xl: spacing[6],
  xxl: spacing[8],
};

export const Radius = {
  xs: radius.xs,
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: radius.xl,
  pill: radius.pill,
};

export const Typography = {
  hero: {
    ...type.hero,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  largeTitle: {
    ...type.hero,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  title: {
    ...type.h2,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  heading: {
    ...type.h3,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  body: {
    ...type.body,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  bodyStrong: {
    ...type.bodyStrong,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  meta: {
    ...type.meta,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  caption: {
    ...type.caption,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
  price: {
    ...type.price,
    fontFamily: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  },
};

export const Shadows = {
  card: shadow.card,
  cardStrong: shadow.cardStrong,
  floating: shadow.floating,
};

export const Motion = motion;
