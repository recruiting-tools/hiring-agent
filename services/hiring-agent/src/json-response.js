export function normalizeJsonResponseText(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return text;
}

export function parseJsonResponse(raw) {
  const normalized = normalizeJsonResponseText(raw);
  return JSON.parse(normalized);
}
