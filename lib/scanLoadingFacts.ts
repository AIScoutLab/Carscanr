export const SCAN_LOADING_FACTS = [
  "Vehicle proportions often reveal the body style before badges do.",
  "Headlight shapes can help narrow a model generation.",
  "Wheelbase and roofline are useful clues for matching SUVs.",
  "Grille shape is one of the strongest visual identifiers.",
  "Trim details can change faster than the main body design.",
  "Tail lights often reveal model years more clearly than front views.",
  "Badges help, but body shape usually confirms the match.",
  "Some models keep similar designs across several years.",
  "Wheel design can help narrow trims and packages.",
  "Side mirrors and door handles can reveal generation changes.",
  "Front bumper shapes often change during mid-cycle refreshes.",
  "Catalog specs help separate visual guesses from reliable details.",
  "Older vehicles may need generation-level matching.",
  "Market data is only useful after the vehicle match is reliable.",
  "Clear angled photos usually improve identification confidence.",
  "Body lines often stay consistent within the same generation.",
  "Roof shape can distinguish a crossover from a wagon at a glance.",
  "Rear-quarter photos often reveal more model detail than straight front shots.",
  "Wheel arch shape can be a strong clue for trucks and SUVs.",
  "Daytime running lights can help separate nearby model years.",
  "Mirror caps and grille inserts often differ by trim.",
  "Generation matching is often more reliable than a single guessed year.",
] as const;

export function getRandomScanLoadingFactIndex() {
  return Math.floor(Math.random() * SCAN_LOADING_FACTS.length);
}

export function getNextScanLoadingFactIndex(current: number) {
  if (SCAN_LOADING_FACTS.length <= 1) {
    return 0;
  }
  return (current + 1) % SCAN_LOADING_FACTS.length;
}
