export const colors = {
  page: "#030404",
  pageAlt: "#090A0C",

  surface: "#151312",
  surfaceSoft: "#101010",
  surfaceTint: "#1B1714",
  surfaceStrong: "#211D1A",

  text: "#F5F1EA",
  textStrong: "#FFFFFF",
  textSoft: "#B8B0A5",
  textMuted: "#8F8990",
  textFaint: "#6F6A72",

  line: "rgba(255,255,255,0.06)",
  lineSoft: "rgba(255,255,255,0.04)",

  primary: "#D8A368",
  primarySoft: "rgba(216, 163, 104, 0.16)",
  primaryDeep: "#B9824A",

  success: "#30D18C",
  successSoft: "rgba(48, 209, 140, 0.14)",

  warning: "#E1A949",
  warningSoft: "rgba(225, 169, 73, 0.14)",

  premium: "#E0AD72",
  premiumSoft: "rgba(224, 173, 114, 0.14)",

  overlay: "rgba(3, 4, 4, 0.56)",
  shadow: "#02060D",
} as const;

export const radius = {
  xs: 10,
  sm: 14,
  md: 16,
  lg: 16,
  xl: 18,
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
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardStrong: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
} as const;

export const motion = {
  pressInScale: 0.985,
  pressOutScale: 1,
  quick: 140,
  normal: 220,
} as const;
