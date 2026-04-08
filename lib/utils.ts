export const formatCurrency = (value: number | null | undefined, fallback = "Unavailable") => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
};

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatConfidence = (confidence: number | null | undefined, fallback = "0% match") => {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return fallback;
  }
  return `${Math.round(confidence * 100)}% match`;
};

export const confidenceTone = (confidence: number | null | undefined) => {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "Possible match";
  if (confidence >= 0.9) return "Very confident";
  if (confidence >= 0.75) return "Strong match";
  if (confidence >= 0.6) return "Likely match";
  return "Possible match";
};
