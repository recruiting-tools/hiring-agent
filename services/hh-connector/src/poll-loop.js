// Standalone poll loop: calls HhConnector.pollAll() on an interval.
// Usage: import { startPollLoop } from './poll-loop.js';
// startPollLoop({ store, hhClient, chatbot, intervalMs? })

import { HhConnector } from './hh-connector.js';

export function startPollLoop({ store, hhClient, chatbot, intervalMs = 60_000 }) {
  const connector = new HhConnector({ store, hhClient, chatbot });

  const tick = async () => {
    try {
      await connector.pollAll();
    } catch (err) {
      console.error('[poll-loop] error during pollAll:', err);
    }
  };

  // Run once immediately, then on interval
  tick();
  return setInterval(tick, intervalMs);
}
