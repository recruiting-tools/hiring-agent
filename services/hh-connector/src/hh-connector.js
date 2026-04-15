import { randomUUID } from "node:crypto";
import { HhImporter } from "./hh-importer.js";

export class HhConnector {
  constructor({ store, hhClient, chatbot, vacancyMappings = [] }) {
    this.store = store;
    this.hhClient = hhClient;
    this.chatbot = chatbot; // createCandidateChatbot({ store, llmAdapter })
    this.importer = new HhImporter({ store, hhClient });
    this.vacancyMappings = vacancyMappings;
  }

  async syncApplicants({ windowStart, windowEnd, vacancyMappings = this.vacancyMappings } = {}) {
    if (!windowStart) throw new Error("syncApplicants requires windowStart");
    if (!vacancyMappings?.length) {
      return { ok: true, imported_collections: 0, imported_negotiations: 0, imported_messages: 0, results: [] };
    }
    return this.importer.syncApplicants({ vacancyMappings, windowStart, windowEnd });
  }

  // Poll all negotiations where next_poll_at <= now
  async pollAll() {
    const due = await this.store.getHhNegotiationsDue();
    const results = [];
    let processed = 0;
    let failed = 0;

    for (const neg of due) {
      try {
        const result = await this.pollNegotiation(neg.hh_negotiation_id);
        processed += 1;
        results.push({ hh_negotiation_id: neg.hh_negotiation_id, ...result });
      } catch (err) {
        failed += 1;
        results.push({
          hh_negotiation_id: neg.hh_negotiation_id,
          processed: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    console.info("[hh-connector] pollAll_summary", {
      imported_collections: 0,
      due_count: due.length,
      processed,
      failed
    });
    return { due_count: due.length, processed, failed, results };
  }

  // Poll a single negotiation
  async pollNegotiation(hhNegotiationId) {
    const traceId = randomUUID();
    // 1. Get messages from HH (order not guaranteed)
    const messages = await this.hhClient.getMessages(hhNegotiationId);
    console.info("[hh-connector] pollNegotiation_start", {
      trace_id: traceId,
      hh_negotiation_id: hhNegotiationId,
      raw_messages: messages.length
    });

    // 2. Sort by created_at before any logic (known HH API quirk)
    const sorted = [...messages].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    // 3. Find out what we've already seen
    const pollState = await this.store.getHhPollState(hhNegotiationId);
    const lastSeenAt = pollState?.hh_updated_at ?? null;

    // 4. Filter: only new messages (after lastSeenAt)
    const newMessages = lastSeenAt
      ? sorted.filter((m) => new Date(m.created_at) > new Date(lastSeenAt))
      : sorted;

    // 5. Process new applicant messages through chatbot
    const negotiation = await this.store.findHhNegotiation(hhNegotiationId);
    for (const msg of newMessages) {
      if (msg.author === "applicant") {
        await this.chatbot.postWebhookMessage({
          conversation_id: negotiation.channel_thread_id,
          text: msg.text,
          channel: "hh",
          channel_message_id: msg.id,
          occurred_at: msg.created_at
        });
      }
    }

    // 6. Update poll_state
    // Preserve awaiting_reply/last_sender if HH returns empty array to avoid
    // incorrectly resetting state when the API returns no messages transiently.
    const lastMsg = sorted.at(-1);
    const isAwaitingReply = lastMsg !== undefined
      ? lastMsg.author === "employer"
      : (pollState?.awaiting_reply ?? false);
    const pollIntervalMs = isAwaitingReply ? 4 * 3600_000 : 60_000;
    await this.store.upsertHhPollState(hhNegotiationId, {
      last_polled_at: new Date().toISOString(),
      hh_updated_at: lastMsg?.created_at ?? lastSeenAt,
      last_sender: lastMsg?.author ?? pollState?.last_sender ?? null,
      awaiting_reply: isAwaitingReply,
      next_poll_at: new Date(Date.now() + pollIntervalMs).toISOString()
    });

    console.info("[hh-connector] pollNegotiation_checkpoint", {
      trace_id: traceId,
      hh_negotiation_id: hhNegotiationId,
      new_messages: newMessages.length,
      awaiting_reply: isAwaitingReply,
      next_poll_in_ms: pollIntervalMs
    });
    return { processed: true, new_messages: newMessages.length, awaiting_reply: isAwaitingReply };
  }
}
