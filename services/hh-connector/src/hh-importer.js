export class HhImporter {
  constructor({ store, hhClient, collections = ["response", "phone_interview"] }) {
    this.store = store;
    this.hhClient = hhClient;
    this.collections = collections;
  }

  async syncApplicants({ vacancyMappings, windowStart, windowEnd = new Date().toISOString() }) {
    const results = [];
    for (const mapping of vacancyMappings) {
      for (const collection of (mapping.collections ?? this.collections)) {
        try {
          const imported = await this.syncVacancyCollection({
            hh_vacancy_id: mapping.hh_vacancy_id,
            job_id: mapping.job_id,
            collection,
            windowStart,
            windowEnd
          });
          results.push(imported);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`syncApplicants: failed vacancy=${mapping.hh_vacancy_id} job=${mapping.job_id} collection=${collection}: ${msg}`);
          results.push({
            hh_vacancy_id: mapping.hh_vacancy_id,
            job_id: mapping.job_id,
            collection,
            error: msg,
            imported_negotiations: 0,
            imported_messages: 0
          });
        }
      }
    }

    return {
      ok: true,
      imported_collections: results.length,
      imported_negotiations: results.reduce((sum, item) => sum + (item.imported_negotiations ?? 0), 0),
      imported_messages: results.reduce((sum, item) => sum + (item.imported_messages ?? 0), 0),
      results
    };
  }

  async syncVacancyCollection({ hh_vacancy_id, job_id, collection, windowStart, windowEnd }) {
    let page = 0;
    let imported_negotiations = 0;
    let imported_messages = 0;

    while (true) {
      const payload = await this.hhClient.listNegotiations(collection, {
        vacancy_id: hh_vacancy_id,
        page,
        per_page: 50
      });
      const items = payload.items ?? [];

      for (const item of items) {
        if (!isInWindow(item.updated_at, windowStart, windowEnd)) continue;
        const imported = await this.importNegotiation({ item, job_id });
        imported_negotiations += imported.imported_negotiation ? 1 : 0;
        imported_messages += imported.imported_messages;
      }

      page += 1;
      if (page >= Number(payload.pages ?? 1)) break;
    }

    return { hh_vacancy_id, job_id, collection, imported_negotiations, imported_messages };
  }

  async importNegotiation({ item, job_id }) {
    const existing = await this.store.findHhNegotiation(item.id);
    const collection = item.state?.id ?? item.collection ?? "response";
    const resume = await this.getResumeSafe(item);
    const ids = await this.store.ensureImportedHhNegotiation({
      hhNegotiation: item,
      job_id,
      collection,
      resume
    });
    const messages = await this.getMessagesSafe(item.id);
    const sorted = [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let imported_messages = 0;
    for (const message of sorted) {
      const result = await this.store.upsertImportedMessage({
        conversation_id: ids.conversation_id,
        candidate_id: ids.candidate_id,
        direction: mapAuthorToDirection(message.author),
        body: message.text ?? "",
        channel: "hh",
        channel_message_id: message.id,
        occurred_at: message.created_at
      });
      if (result) imported_messages += 1;
    }

    const lastMessage = sorted.at(-1);
    // For new negotiations: set hh_updated_at to the last EMPLOYER message time.
    // This ensures the poll only calls the chatbot for applicant messages that arrived
    // AFTER our last employer reply — avoiding re-processing V1 history on first import.
    // If no employer message exists yet, null means the poll will see all messages as new.
    // For existing negotiations: preserve hh_updated_at from poll state so the poll
    // continues exactly from where it left off (don't overwrite with last import timestamp).
    const existingPollState = existing ? await this.store.getHhPollState(item.id) : null;
    const lastEmployerMessage = sorted.filter((m) => m.author === "employer").at(-1);
    const pollHhUpdatedAt = existingPollState
      ? existingPollState.hh_updated_at
      : (lastEmployerMessage?.created_at ?? null);

    await this.store.upsertHhPollState(item.id, {
      last_polled_at: new Date().toISOString(),
      hh_updated_at: pollHhUpdatedAt,
      last_sender: existingPollState?.last_sender ?? (lastMessage?.author ?? null),
      awaiting_reply: existingPollState?.awaiting_reply ?? (lastMessage ? lastMessage.author === "employer" : false),
      next_poll_at: new Date(Date.now() + 60_000).toISOString()
    });

    return {
      imported_negotiation: !existing,
      imported_messages
    };
  }

  async getResumeSafe(item) {
    if (!item.resume?.id) return null;
    try {
      return await this.hhClient.getResume(item.resume.id);
    } catch (error) {
      console.warn(`Failed to import HH resume ${item.resume.id} for negotiation ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getMessagesSafe(negotiationId) {
    try {
      return await this.hhClient.getMessages(negotiationId);
    } catch (error) {
      console.warn(`Failed to import HH messages for negotiation ${negotiationId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

function isInWindow(updatedAt, windowStart, windowEnd) {
  const value = new Date(updatedAt).getTime();
  if (!Number.isFinite(value)) return false;
  return value >= new Date(windowStart).getTime() && value <= new Date(windowEnd).getTime();
}

function mapAuthorToDirection(author) {
  return author === "employer" ? "outbound" : "inbound";
}
