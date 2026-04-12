export class HhConnector {
  constructor({ store, hhClient, chatbot }) {
    this.store = store;
    this.hhClient = hhClient;
    this.chatbot = chatbot; // createCandidateChatbot({ store, llmAdapter })
  }

  // Poll all negotiations where next_poll_at <= now
  async pollAll() {
    const due = await this.store.getHhNegotiationsDue();
    for (const neg of due) {
      await this.pollNegotiation(neg.hh_negotiation_id);
    }
  }

  // Poll a single negotiation
  async pollNegotiation(hhNegotiationId) {
    // 1. Get messages from HH (order not guaranteed)
    const messages = await this.hhClient.getMessages(hhNegotiationId);

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
    const lastMsg = sorted.at(-1);
    await this.store.upsertHhPollState(hhNegotiationId, {
      last_polled_at: new Date().toISOString(),
      hh_updated_at: lastMsg?.created_at ?? lastSeenAt,
      last_sender: lastMsg?.author ?? null,
      awaiting_reply: lastMsg?.author === "employer",
      next_poll_at: new Date(Date.now() + 60_000).toISOString()
    });
  }
}
