export const colors = {
  page: "#040812",
  pageAlt: "#07101D",

  surface: "#0C1524",
  surfaceSoft: "#101C2E",
  surfaceTint: "#112039",
  surfaceStrong: "#16253C",

  text: "#E6EEF9",
  textStrong: "#F6FAFF",
  textSoft: "#A8B8CE",
  textMuted: "#8090A7",
  textFaint: "#5F7088",

  line: "rgba(120, 152, 196, 0.24)",
  lineSoft: "rgba(120, 152, 196, 0.14)",

  primary: "#1D8CFF",
  primarySoft: "rgba(29, 140, 255, 0.18)",
  primaryDeep: "#0A72E8",

  success: "#30D18C",
  successSoft: "rgba(48, 209, 140, 0.14)",

  warning: "#E1A949",
  warningSoft: "rgba(225, 169, 73, 0.14)",

  premium: "#5EE7FF",
  premiumSoft: "rgba(94, 231, 255, 0.14)",

  overlay: "rgba(4, 8, 18, 0.42)",
  shadow: "#02060D",
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
    shadowOpacity: 0.26,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
  cardStrong: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.34,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.42,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 18 },
    elevation: 14,
  },
} as const;

export const motion = {
  pressInScale: 0.985,
  pressOutScale: 1,
  quick: 140,
  normal: 220,
} as const;
