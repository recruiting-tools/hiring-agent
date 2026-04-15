import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let cachedSeed = null;
let seedLoadFailed = false;
const FALLBACK_RUNNABLE_PLAYBOOKS = new Set([
  "create_vacancy"
]);

function loadSeed() {
  if (cachedSeed) return cachedSeed;
  if (seedLoadFailed) return null;

  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const seedPath = join(dir, "../../../../data/playbooks-seed.json");
    const raw = readFileSync(seedPath, "utf-8").replace(/\/\/[^\n]*/g, "");
    const parsed = JSON.parse(raw);
    cachedSeed = parsed && typeof parsed === "object" ? parsed : null;
    return cachedSeed;
  } catch {
    seedLoadFailed = true;
    return null;
  }
}

export function hasFallbackSteps(playbookKey) {
  if (!FALLBACK_RUNNABLE_PLAYBOOKS.has(playbookKey)) {
    return false;
  }
  return getFallbackPlaybookSteps(playbookKey).length > 0;
}

export function getFallbackPlaybookSteps(playbookKey) {
  if (!playbookKey) return [];

  const seed = loadSeed();
  const steps = Array.isArray(seed?.steps) ? seed.steps : [];

  return steps
    .filter((step) => step?.playbook_key === playbookKey)
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .map((step) => structuredClone(step));
}
