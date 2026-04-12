import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/hh-api"
);

export async function loadHhFixtureLibrary(fixturesDir = DEFAULT_FIXTURES_DIR) {
  const manifest = JSON.parse(await readFile(path.join(fixturesDir, "manifest.json"), "utf8"));
  const fixtures = new Map();

  await Promise.all(
    manifest.fixtures.map(async (entry) => {
      const body = JSON.parse(await readFile(path.join(fixturesDir, entry.file), "utf8"));
      fixtures.set(entry.id, { ...entry, body });
    })
  );

  return { fixturesDir, manifest, fixtures };
}

export class HhContractMock {
  constructor({ fixtureLibrary = null, now = "2026-04-12T10:00:00Z" } = {}) {
    this.fixtureLibrary = fixtureLibrary;
    this.now = new Date(now);
    this.tokens = { access: "active", refresh: "active" };
    this.vacancies = new Map();
    this.negotiations = new Map();
    this.resumes = new Map();
    this.sentMessages = [];
    this.failures = [];
  }

  static async create(options = {}) {
    const fixtureLibrary = options.fixtureLibrary ?? await loadHhFixtureLibrary(options.fixturesDir);
    return new HhContractMock({ ...options, fixtureLibrary });
  }

  _nowIso() {
    return this.now.toISOString();
  }

  _clone(value) {
    return value == null ? value : structuredClone(value);
  }

  _normalizeParticipant(author) {
    if (typeof author === "string") return author;
    return author?.participant_type ?? null;
  }

  _checkFailure(methodName, details = {}) {
    if (this.tokens.access === "expired") {
      throw this._createErrorFromFixture("errors.401-expired-token", methodName, details);
    }

    const index = this.failures.findIndex((failure) => {
      if (failure.methodName && failure.methodName !== methodName) return false;
      if (failure.negotiationId && failure.negotiationId !== details.negotiationId) return false;
      return true;
    });
    if (index === -1) return;

    const failure = this.failures[index];
    if (failure.once !== false) {
      this.failures.splice(index, 1);
    }
    throw this._createErrorFromFixture(failure.fixtureId, methodName, details);
  }

  _createErrorFromFixture(fixtureId, methodName, details) {
    const fixture = this.fixtureLibrary?.fixtures?.get(fixtureId);
    const body = fixture?.body ?? { status: 500, error: "mock_error", description: "Mock failure" };
    const error = new Error(body.description ?? body.error ?? `HH mock error in ${methodName}`);
    error.status = body.status ?? 500;
    error.code = body.error ?? "mock_error";
    error.details = { methodName, ...details };
    error.body = body;
    return error;
  }

  enqueueFailure(fixtureId, options = {}) {
    this.failures.push({ fixtureId, once: true, ...options });
  }

  seedVacancy(vacancy) {
    this.vacancies.set(vacancy.id, this._clone(vacancy));
  }

  seedResume(resume) {
    this.resumes.set(resume.id, this._clone(resume));
  }

  addNegotiation(hhNegotiationId, messages = [], overrides = {}) {
    const negotiation = {
      id: hhNegotiationId,
      collection: overrides.collection ?? "response",
      updated_at: overrides.updated_at ?? messages.at(-1)?.created_at ?? this._nowIso(),
      resume: overrides.resume ?? { id: overrides.resume_id ?? `resume-${hhNegotiationId}`, url: `https://api.hh.ru/resumes/${overrides.resume_id ?? `resume-${hhNegotiationId}`}` },
      vacancy: overrides.vacancy ?? { id: overrides.hh_vacancy_id ?? `vac-${hhNegotiationId}`, name: overrides.vacancy_name ?? "Synthetic vacancy" },
      state: { id: overrides.collection ?? "response" },
      messageOrder: overrides.messageOrder ?? "stored",
      freezeUpdatedAt: overrides.freezeUpdatedAt ?? false,
      messages: []
    };

    this.seedVacancy(negotiation.vacancy);
    if (negotiation.resume?.id && !this.resumes.has(negotiation.resume.id)) {
      this.seedResume({ id: negotiation.resume.id, title: "Synthetic resume" });
    }

    this.negotiations.set(hhNegotiationId, negotiation);
    for (const message of messages) {
      this.addMessage(hhNegotiationId, message);
    }
  }

  addMessage(hhNegotiationId, { id, author, text, created_at }) {
    const negotiation = this.negotiations.get(hhNegotiationId);
    if (!negotiation) throw new Error(`Unknown negotiation: ${hhNegotiationId}`);

    negotiation.messages.push({
      id,
      author: this._normalizeParticipant(author),
      text,
      created_at
    });
    if (!negotiation.freezeUpdatedAt) {
      negotiation.updated_at = created_at;
    }
  }

  async listNegotiations(collection, { vacancy_id, page = 0, per_page = 20 } = {}) {
    this._checkFailure("listNegotiations", { collection, vacancy_id });

    const filtered = [...this.negotiations.values()]
      .filter((negotiation) => negotiation.collection === collection)
      .filter((negotiation) => (vacancy_id ? negotiation.vacancy?.id === vacancy_id : true))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

    const offset = page * per_page;
    const items = filtered.slice(offset, offset + per_page).map((negotiation) => this._clone({
      id: negotiation.id,
      updated_at: negotiation.updated_at,
      state: { id: negotiation.collection },
      resume: negotiation.resume,
      vacancy: negotiation.vacancy
    }));

    return {
      found: filtered.length,
      page,
      pages: Math.max(1, Math.ceil(filtered.length / per_page)),
      per_page,
      items
    };
  }

  async getNegotiation(hhNegotiationId) {
    this._checkFailure("getNegotiation", { negotiationId: hhNegotiationId });
    const negotiation = this.negotiations.get(hhNegotiationId);
    if (!negotiation) {
      throw this._createErrorFromFixture("errors.404-negotiation-not-found", "getNegotiation", { negotiationId: hhNegotiationId });
    }
    return this._clone({
      id: negotiation.id,
      updated_at: negotiation.updated_at,
      state: { id: negotiation.collection },
      resume: negotiation.resume,
      vacancy: negotiation.vacancy
    });
  }

  async getResume(resumeIdOrUrl) {
    this._checkFailure("getResume", { resumeIdOrUrl });
    const resumeId = String(resumeIdOrUrl).split("/").at(-1);
    const resume = this.resumes.get(resumeId);
    if (!resume) {
      throw this._createErrorFromFixture("errors.404-negotiation-not-found", "getResume", { resumeIdOrUrl });
    }
    return this._clone(resume);
  }

  async getMessages(hhNegotiationId) {
    this._checkFailure("getMessages", { negotiationId: hhNegotiationId });
    const negotiation = this.negotiations.get(hhNegotiationId);
    if (!negotiation) return [];

    const items = negotiation.messages.map((message) => ({
      id: message.id,
      author: message.author,
      text: message.text,
      created_at: message.created_at
    }));

    if (negotiation.messageOrder === "reversed") {
      return [...items].reverse();
    }
    return this._clone(items);
  }

  async sendMessage(hhNegotiationId, text) {
    this._checkFailure("sendMessage", { negotiationId: hhNegotiationId });
    const negotiation = this.negotiations.get(hhNegotiationId);
    if (!negotiation) {
      throw this._createErrorFromFixture("errors.404-negotiation-not-found", "sendMessage", { negotiationId: hhNegotiationId });
    }

    const fixtureBody = this.fixtureLibrary?.fixtures?.get("negotiations.send-message.success")?.body;
    const hh_message_id = `${fixtureBody?.id ?? "hh-msg-sent-001"}-${this.sentMessages.length + 1}`;
    const created_at = this._nowIso();

    this.sentMessages.push({ hhNegotiationId, text, hh_message_id, created_at });
    this.addMessage(hhNegotiationId, {
      id: hh_message_id,
      author: "employer",
      text,
      created_at
    });

    return { hh_message_id };
  }

  async changeState(action, hhNegotiationId) {
    this._checkFailure("changeState", { negotiationId: hhNegotiationId, action });
    const negotiation = this.negotiations.get(hhNegotiationId);
    if (!negotiation) {
      throw this._createErrorFromFixture("errors.404-negotiation-not-found", "changeState", { negotiationId: hhNegotiationId, action });
    }

    negotiation.collection = action;
    negotiation.state = { id: action };
    if (!negotiation.freezeUpdatedAt) {
      negotiation.updated_at = this._nowIso();
    }

    return {
      collection: negotiation.collection,
      updated_at: negotiation.updated_at
    };
  }

  expireAccessToken() {
    this.tokens.access = "expired";
  }

  refreshAccessToken() {
    this.tokens.access = "active";
  }

  advanceClock(ms) {
    this.now = new Date(this.now.getTime() + ms);
  }

  sentCount() {
    return this.sentMessages.length;
  }

  lastSent() {
    return this.sentMessages.at(-1) ?? null;
  }
}
