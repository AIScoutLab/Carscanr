import { colors, radius, shadow, spacing } from "./tokens";

export const cardStyles = {
  primary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[6],
    borderWidth: 1,
    borderColor: colors.lineSoft,
    ...shadow.cardStrong,
  },
  standard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.lineSoft,
    ...shadow.card,
  },
  primaryTint: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing[6],
    borderWidth: 1,
    borderColor: colors.primarySoft,
    ...shadow.cardStrong,
  },
  secondary: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.md,
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.lineSoft,
    ...shadow.card,
  },
  tertiary: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.md,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  utility: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.md,
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
};

export const buttonStyles = {
  primary: {
    backgroundColor: colors.primaryDeep,
    borderRadius: radius.pill,
    minHeight: 58,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    minHeight: 52,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chip: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
