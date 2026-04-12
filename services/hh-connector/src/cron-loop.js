// Standalone cron loop: calls CronSender.tick() on an interval.
// Usage: import { startCronLoop } from './cron-loop.js';
// startCronLoop({ store, hhClient, intervalMs? })

import { CronSender } from './cron-sender.js';

export function startCronLoop({ store, hhClient, intervalMs = 30_000 }) {
  const sender = new CronSender({ store, hhClient });

  const tick = async () => {
    try {
      await sender.tick();
    } catch (err) {
      console.error('[cron-loop] error during tick:', err);
    }
  };

  // Run once immediately, then on interval
  tick();
  return setInterval(tick, intervalMs);
}
