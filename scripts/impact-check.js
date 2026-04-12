#!/usr/bin/env node
// Impact check — maps changed files to risk areas.
// Advisory only: always exits 0. Run before gate:sandbox in CI.

import { execSync } from 'node:child_process';

const RISK_MAP = [
  { pattern: /services\/candidate-chatbot\/src\/http-server/, area: 'HTTP API / auth / routing' },
  { pattern: /services\/candidate-chatbot\/src\/cron-sender/, area: 'message sending / deduplication' },
  { pattern: /services\/candidate-chatbot\/src\/moderation/, area: 'moderation queue / block / approve' },
  { pattern: /services\/candidate-chatbot\/src\/hh|services\/hh-connector/, area: 'HH polling / import' },
  { pattern: /services\/candidate-chatbot\/src\/telegram/, area: 'Telegram notifications' },
  { pattern: /services\/candidate-chatbot\/src\/index/, area: 'app startup / adapter selection' },
  { pattern: /services\/candidate-chatbot\/migrations|\.sql$/, area: '⚠️  DATABASE SCHEMA — run migration on ephemeral Neon branch first' },
  { pattern: /tests\//, area: 'test coverage' },
  { pattern: /^package\.json$/, area: 'dependencies — check for breaking changes' },
  { pattern: /scripts\/deploy/, area: 'deploy scripts — verify prod defaults unchanged' },
];

let changed;
try {
  // In CI: diff against previous commit. Locally: diff against main.
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'HEAD~1';
  changed = execSync(`git diff --name-only ${base}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  console.log('impact-check: could not determine changed files, skipping.');
  process.exit(0);
}

if (changed.length === 0) {
  console.log('impact-check: no changed files detected.');
  process.exit(0);
}

const hits = new Set();
for (const file of changed) {
  for (const { pattern, area } of RISK_MAP) {
    if (pattern.test(file)) hits.add(area);
  }
}

console.log(`\n── Impact check (${changed.length} files changed) ──`);
if (hits.size === 0) {
  console.log('No high-risk areas detected.');
} else {
  console.log('Risk areas affected:');
  for (const area of hits) console.log(`  • ${area}`);
}
console.log('────────────────────────────────────────\n');
