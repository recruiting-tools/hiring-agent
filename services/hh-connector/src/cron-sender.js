import { sendHHWithGuard } from "./send-guard.js";

export class CronSender {
  constructor({ store, hhClient, windowMinutes = 10 }) {
    this.store = store;
    this.hhClient = hhClient;
    this.windowMinutes = windowMinutes;
  }

  // One iteration: find all messages due for sending, send each
  async tick() {
    const due = await this.store.getPlannedMessagesDue(new Date());
    const results = [];
    for (const msg of due) {
      const negotiation = await this.store.findHhNegotiationByChannelThreadId(
        msg.channel_thread_id
      );
      if (!negotiation) {
        // Not an HH conversation or negotiation not yet set up — skip
        results.push({ planned_message_id: msg.planned_message_id, skipped: true, reason: "no_negotiation" });
        continue;
      }
      const result = await sendHHWithGuard({
        store: this.store,
        hhClient: this.hhClient,
        plannedMessage: msg,
        hhNegotiationId: negotiation.hh_negotiation_id
      });
      results.push({ planned_message_id: msg.planned_message_id, ...result });
    }
    return results;
  }
}
