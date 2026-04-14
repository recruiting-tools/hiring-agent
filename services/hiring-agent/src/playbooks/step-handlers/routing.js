export function resolveNextStepOrder(step, routeKey = null) {
  if (routeKey == null) {
    return step.next_step_order ?? null;
  }

  const routes = normalizeRouting(step.routing);
  if (routes.size === 0) {
    return step.next_step_order ?? null;
  }

  const normalizedRouteKey = normalizeRouteKey(routeKey);
  return routes.get(normalizedRouteKey) ?? step.next_step_order ?? null;
}

export function findMatchingOption(options, recruiterInput) {
  const normalizedInput = normalizeRouteKey(recruiterInput);
  if (!normalizedInput) return null;

  return options.find((option) => normalizeRouteKey(option) === normalizedInput) ?? null;
}

function normalizeRouting(rawRouting) {
  const routing = parseRouting(rawRouting);
  const entries = Array.isArray(routing)
    ? routing
        .map((route) => [route?.label ?? route?.option ?? route?.key, route?.next])
    : Object.entries(routing ?? {});

  return new Map(
    entries
      .filter(([label, next]) => normalizeRouteKey(label) && Number.isInteger(next))
      .map(([label, next]) => [normalizeRouteKey(label), next])
  );
}

function parseRouting(rawRouting) {
  if (!rawRouting) return null;
  if (typeof rawRouting === "string") {
    try {
      return JSON.parse(rawRouting);
    } catch {
      return null;
    }
  }
  return rawRouting;
}

function normalizeRouteKey(value) {
  return String(value ?? "").trim().toLowerCase();
}
