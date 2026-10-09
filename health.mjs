// health.mjs - Source Health Classification and State Definitions

export const HEALTH = Object.freeze({
  HEALTHY: "HEALTHY",                 // fetched/extracted as expected
  DEGRADED: "DEGRADED",               // partial: some boards failed or fewer cards than expected
  EMPTY: "EMPTY",                     // page fine, query genuinely has no results
  SELECTOR_BROKEN: "SELECTOR_BROKEN", // many job-like anchors, zero cards
  BLOCKED: "BLOCKED",                 // 403/429/challenge/empty shell
  THROTTLED_TIMEOUT: "THROTTLED_TIMEOUT",
  ERROR: "ERROR",                     // timeout/exception/all slugs dead
  SKIPPED: "SKIPPED",                 // not configured / disabled
});

export const FAILING = new Set([
  HEALTH.BLOCKED,
  HEALTH.SELECTOR_BROKEN,
  HEALTH.THROTTLED_TIMEOUT,
  HEALTH.ERROR,
]);

export function classifyApiSource({
  total = 0,
  success = 0,
  noBoard = 0,
  blocked = 0,
  rateLimited = 0,
  errors = 0,
} = {}) {
  if (!total) return HEALTH.SKIPPED;
  if (success === 0) {
    return (blocked + rateLimited) > 0 ? HEALTH.BLOCKED : HEALTH.ERROR;
  }
  if (success / total < 0.8) {
    return HEALTH.DEGRADED;
  }
  return HEALTH.HEALTHY;
}

export function classifyBrowserPage({
  httpStatus,
  title = "",
  bodyText = "",
  rawAnchors = 0,
  cards = 0,
  splashStill = false,
  minAnchors = 20,
  expectedMinCards = 1,
} = {}) {
  const t = (title || "").toLowerCase();
  const b = (bodyText || "").slice(0, 3000).toLowerCase();

  if (
    [403, 429].includes(httpStatus) ||
    /access denied|attention required|just a moment/.test(t) ||
    /verify you are human|unusual traffic/.test(b)
  ) {
    return HEALTH.BLOCKED;
  }

  if (cards >= expectedMinCards) return HEALTH.HEALTHY;
  if (cards > 0) return HEALTH.DEGRADED;
  if (splashStill) return HEALTH.THROTTLED_TIMEOUT;
  if (rawAnchors > minAnchors) return HEALTH.SELECTOR_BROKEN;
  if (!t) return HEALTH.BLOCKED;
  return HEALTH.EMPTY;
}

export function aggregateHealthStates(states = []) {
  if (!states.length) return HEALTH.SKIPPED;
  // If any state is failing, return the worst/failing state
  for (const f of FAILING) {
    if (states.includes(f)) return f;
  }
  if (states.includes(HEALTH.DEGRADED)) return HEALTH.DEGRADED;
  if (states.some((s) => s === HEALTH.HEALTHY)) return HEALTH.HEALTHY;
  if (states.every((s) => s === HEALTH.EMPTY)) return HEALTH.EMPTY;
  return states[0] || HEALTH.HEALTHY;
}

