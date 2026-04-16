import { randomUUID } from "node:crypto";
import { HhImporter } from "./hh-importer.js";

const DEFAULT_HH_COLLECTIONS = ["response", "phone_interview"];
const VALID_COLLECTIONS = new Set(DEFAULT_HH_COLLECTIONS);

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

    const mappingsFromStore = await this.resolveVacancyMappings(vacancyMappings);
    const validation = await this.validateVacancyMappings(mappingsFromStore);

    if (!validation.validMappings.length) {
      return {
        ok: false,
        imported_collections: 0,
        imported_negotiations: 0,
        imported_messages: 0,
        results: [],
        validation_errors: validation.validationErrors,
        error:
          validation.validationErrors.length === 0
            ? "no_active_hh_mappings"
            : "invalid_hh_mappings"
      };
    }

    const importerResult = await this.importer.syncApplicants({
      vacancyMappings: validation.validMappings,
      windowStart,
      windowEnd
    });

    return {
      ...importerResult,
      ok: validation.validationErrors.length === 0,
      validation_errors: validation.validationErrors
    };
  }

  async resolveVacancyMappings(vacancyMappings) {
    if (vacancyMappings?.length) {
      return vacancyMappings.map(normalizeMapping);
    }

    if (!this.store?.getHhVacancyJobMappings) {
      return this.vacancyMappings.map(normalizeMapping);
    }

    return (await this.store.getHhVacancyJobMappings({ enabledOnly: true })).map(normalizeMapping);
  }

  async validateVacancyMappings(mappings) {
    const validationErrors = [];
    const validMappings = [];
    const seenVacancies = new Set();

    for (const raw of mappings) {
      const mapping = normalizeMapping(raw);

      if (!mapping.hh_vacancy_id) {
        validationErrors.push({ code: "invalid_hh_vacancy_id", hh_vacancy_id: mapping.hh_vacancy_id, error: "Missing hh_vacancy_id" });
        continue;
      }

      if (!mapping.job_id) {
        validationErrors.push({
          code: "invalid_job_id",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          error: "Missing job_id"
        });
        continue;
      }

      if (!Array.isArray(mapping.collections) || mapping.collections.length === 0) {
        validationErrors.push({
          code: "invalid_collections",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          error: "collections must be a non-empty array"
        });
        continue;
      }

      const invalidCollection = mapping.collections.find((collection) => !VALID_COLLECTIONS.has(collection));
      if (invalidCollection) {
        validationErrors.push({
          code: "invalid_collection",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          collection: invalidCollection,
          error: "Unsupported HH collection"
        });
        continue;
      }

      if (seenVacancies.has(mapping.hh_vacancy_id)) {
        validationErrors.push({
          code: "duplicate_mapping",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          error: "Duplicate hh_vacancy_id in vacancy mappings"
        });
        continue;
      }

      const job = await getMaybeAsync(() => this.store?.getJob(mapping.job_id));
      if (!job) {
        validationErrors.push({
          code: "missing_job",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          error: "Job not found"
        });
        continue;
      }

      if (!mapping.client_id && job.client_id) {
        validationErrors.push({
          code: "tenant_binding_missing",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          client_id: job.client_id,
          error: "Mapping requires explicit client_id for tenant-scoped job"
        });
        continue;
      }

      if (mapping.client_id && job.client_id && mapping.client_id !== job.client_id) {
        validationErrors.push({
          code: "tenant_mismatch",
          hh_vacancy_id: mapping.hh_vacancy_id,
          job_id: mapping.job_id,
          mapping_client_id: mapping.client_id,
          job_client_id: job.client_id,
          error: "Tenant mismatch between mapping and job"
        });
        continue;
      }

      seenVacancies.add(mapping.hh_vacancy_id);
      validMappings.push(mapping);
    }

    return { validMappings, validationErrors };
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

function normalizeMapping(item) {
  if (!item || typeof item !== "object") {
    return {};
  }
  return {
    hh_vacancy_id: String(item.hh_vacancy_id ?? "").trim(),
    job_id: String(item.job_id ?? "").trim(),
    client_id: item.client_id != null ? String(item.client_id).trim() : null,
    collections: (Array.isArray(item.collections) ? Array.from(new Set(item.collections)) : DEFAULT_HH_COLLECTIONS)
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0),
    enabled: item.enabled !== false
  };
}

async function getMaybeAsync(factory) {
  try {
    return await factory();
  } catch {
    return null;
  }
}
