import { sendHHWithGuard } from "./send-guard.js";

export class CronSender {
  constructor({ store, hhClient, windowMinutes = 10, batchSize = 25, now = () => new Date() }) {
    this.store = store;
    this.hhClient = hhClient;
    this.windowMinutes = windowMinutes;
    this.batchSize = batchSize;
    this.now = now;
  }

  // One iteration: find all messages due for sending, send each
  async tick() {
    const startedAt = Date.now();
    console.info(JSON.stringify({ event: "hh_send_tick_start" }));
    const due = await this.store.getPlannedMessagesDue(this.now(), this.batchSize);
    console.info(JSON.stringify({
      event: "hh_send_tick_due_loaded",
      due_count: due.length,
      elapsed_ms: Date.now() - startedAt
    }));
    const results = [];
    for (const msg of due) {
      console.info(JSON.stringify({
        event: "hh_send_tick_message_start",
        planned_message_id: msg.planned_message_id
      }));
      const negotiation = await this.store.findHhNegotiationByChannelThreadId(
        msg.channel_thread_id
      );
      if (!negotiation) {
        // Not an HH conversation or negotiation not yet set up — skip
        results.push({ planned_message_id: msg.planned_message_id, skipped: true, reason: "no_negotiation" });
        console.info(JSON.stringify({
          event: "hh_send_tick_message_skipped",
          planned_message_id: msg.planned_message_id,
          reason: "no_negotiation"
        }));
        continue;
      }
      const result = await sendHHWithGuard({
        store: this.store,
        hhClient: this.hhClient,
        plannedMessage: msg,
        hhNegotiationId: negotiation.hh_negotiation_id
      });
      results.push({ planned_message_id: msg.planned_message_id, ...result });
      console.info(JSON.stringify({
        event: "hh_send_tick_message_done",
        planned_message_id: msg.planned_message_id,
        sent: result.sent ?? false,
        duplicate: result.duplicate ?? false,
        retryable: result.retryable ?? false,
        dlq: result.dlq ?? false
      }));
    }
    console.info(JSON.stringify({
      event: "hh_send_tick_done",
      due_count: due.length,
      batch_size: this.batchSize,
      result_count: results.length,
      elapsed_ms: Date.now() - startedAt
    }));
    return results;
  }
}
