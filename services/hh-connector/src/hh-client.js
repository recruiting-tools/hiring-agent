export class FakeHhClient {
  constructor() {
    this._negotiations = new Map(); // hh_negotiation_id → { messages: [] }
    this._sentMessages = [];        // log of all sendMessage calls
  }

  // Seed: create a negotiation with a set of messages
  addNegotiation(hhNegotiationId, messages = []) {
    this._negotiations.set(hhNegotiationId, { messages: [...messages] });
  }

  // Seed: add a message to an existing negotiation
  addMessage(hhNegotiationId, { id, author, text, created_at }) {
    const neg = this._negotiations.get(hhNegotiationId);
    if (!neg) throw new Error(`Unknown negotiation: ${hhNegotiationId}`);
    neg.messages.push({ id, author, text, created_at });
  }

  // HH API interface (all methods async)
  async getMessages(hhNegotiationId) {
    // Returns a copy of the array — does NOT sort (HH API does not guarantee order)
    const neg = this._negotiations.get(hhNegotiationId);
    if (!neg) return [];
    return neg.messages.map((m) => ({ ...m }));
  }

  async sendMessage(hhNegotiationId, text) {
    const hh_message_id = `hh-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._sentMessages.push({ hhNegotiationId, text, hh_message_id });
    this.addMessage(hhNegotiationId, {
      id: hh_message_id,
      author: "employer",
      text,
      created_at: new Date().toISOString()
    });
    return { hh_message_id };
  }

  // Test helper: how many messages were sent
  sentCount() {
    return this._sentMessages.length;
  }

  // Test helper: last sent message
  lastSent() {
    return this._sentMessages.at(-1) ?? null;
  }
}
