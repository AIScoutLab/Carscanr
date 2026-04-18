export function parseHorsepower(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numericOnly = trimmed.match(/^\d+(?:\.\d+)?$/);
    if (numericOnly) {
      const parsed = Number(numericOnly[0]);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
    }

    if (!/\b(hp|horsepower|bhp|ps)\b/i.test(trimmed)) {
      return null;
    }

    const matched = trimmed.match(/(\d+(?:\.\d+)?)/i);
    if (!matched) {
      return null;
    }

    const parsed = Number(matched[1]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  return null;
}

export function resolveHorsepower(...values: unknown[]) {
  for (const value of values) {
    const parsed = parseHorsepower(value);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
}
