export const colors = {
  page: "#F3F5F8",
  pageAlt: "#EEF2F6",

  surface: "#FFFFFF",
  surfaceSoft: "#FAFBFC",
  surfaceTint: "#F7F9FC",
  surfaceStrong: "#F1F5F9",

  text: "#111827",
  textStrong: "#0F172A",
  textSoft: "#475569",
  textMuted: "#6B7280",
  textFaint: "#94A3B8",

  line: "#E5E7EB",
  lineSoft: "#EDF1F5",

  primary: "#2563EB",
  primarySoft: "#DBEAFE",
  primaryDeep: "#0F172A",

  success: "#16A34A",
  successSoft: "#DCFCE7",

  warning: "#B7791F",
  warningSoft: "#FEF3C7",

  premium: "#C9972B",
  premiumSoft: "#FFF7E8",

  overlay: "rgba(15, 23, 42, 0.04)",
  shadow: "#0F172A",
} as const;

export const radius = {
  xs: 10,
  sm: 14,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
} as const;

export const type = {
  hero: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  price: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
} as const;

export const shadow = {
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardStrong: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

export const motion = {
  pressInScale: 0.985,
  pressOutScale: 1,
  quick: 140,
  normal: 220,
} as const;
