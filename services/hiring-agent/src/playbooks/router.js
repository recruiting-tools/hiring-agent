const ROUTES = [
  {
    playbook_key: "candidate_funnel",
    patterns: [
      /воронк/i,
      /статус[аы] кандидат/i,
      /кандидат.*статус/i,
      /funnel/i,
      /pipeline/i
    ]
  },
  {
    playbook_key: "communication_plan",
    patterns: [
      /план коммуникац/i,
      /скрининг/i,
      /pipeline общения/i,
      /communication plan/i
    ]
  },
  {
    playbook_key: "candidate_broadcast",
    patterns: [
      /всем кандидат/i,
      /бродкаст/i,
      /массов.*сообщ/i,
      /broadcast/i,
      /календар/i
    ]
  }
];

export function routePlaybook(message) {
  const normalized = String(message ?? "").trim();
  for (const route of ROUTES) {
    if (route.patterns.some((pattern) => pattern.test(normalized))) {
      return route.playbook_key;
    }
  }
  return null;
}
