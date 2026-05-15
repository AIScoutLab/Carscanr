export type OnboardingLayoutMetrics = {
  viewportWidth: number;
  horizontalPadding: number;
  slideWidth: number;
  visualHeight: number;
  ctaMinHeight: number;
  paginationGap: number;
  headlineFontSize: number;
  headlineLineHeight: number;
  headlineMaxWidth: number;
  topHeaderSpacing: number;
};

export function getOnboardingLayoutMetrics(viewportWidth: number): OnboardingLayoutMetrics {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 390;
  const compact = width <= 390;
  const horizontalPadding = compact ? 24 : 28;
  const slideWidth = width;
  const visualHeight = compact ? 250 : 286;
  const headlineFontSize = compact ? 30 : 32;
  const headlineLineHeight = compact ? 35 : 37;
  const headlineMaxWidth = compact ? 300 : 332;

  return {
    viewportWidth: width,
    horizontalPadding,
    slideWidth,
    visualHeight,
    ctaMinHeight: 58,
    paginationGap: 8,
    headlineFontSize,
    headlineLineHeight,
    headlineMaxWidth,
    topHeaderSpacing: compact ? 12 : 16,
  };
}
