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

export const PremiumGradients = {
  page: [colors.pageAlt, colors.page, colors.page] as const,
  primaryCard: ["#0F2236", "#0A1A2A"] as const,
  imageFrame: ["#0F2236", "#0A1A2A"] as const,
};

export const PremiumCard = {
  primaryBackground: colors.surface,
  secondaryBackground: colors.surfaceSoft,
  supportBackground: colors.surfaceTint,
  inputBackground: colors.surfaceStrong,
  imageFrameInner: "rgba(5, 11, 20, 0.92)",
  border: colors.line,
  accentBorder: "rgba(59,130,246,0.35)",
  softAccentBorder: "rgba(59,130,246,0.25)",
};

export const Spacing = {
  xxs: spacing[1],
  xs: spacing[2],
  sm: spacing[3],
  md: spacing[4],
  lg: spacing[5],
  xl: spacing[6],
  xxl: spacing[8],
  screenHorizontal: spacing[4],
  screenBottom: spacing[7],
  cardGap: 18,
  ctaGap: 16,
};

export const Radius = {
  xs: radius.xs,
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: radius.xl,
  pill: radius.pill,
  card: 16,
  imageFrameInner: 12,
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
