import assert from "node:assert/strict";
import test from "node:test";
import { dispatch } from "../../services/hiring-agent/src/playbooks/runtime.js";

test("playbook runtime: falls back to bundled steps when DB steps are missing", async () => {
  const sessionUpdates = [];
  const managementStore = {
    async getPlaybookSteps(playbookKey) {
      assert.equal(playbookKey, "create_vacancy");
      return [];
    },
    async getActiveSession() {
      return null;
    },
    async abortActiveSessions() {},
    async createPlaybookSession({ tenantId, recruiterId, playbookKey, currentStepOrder, context }) {
      assert.equal(tenantId, "tenant-alpha-001");
      assert.equal(recruiterId, "rec-alpha-001");
      assert.equal(playbookKey, "create_vacancy");
      assert.equal(currentStepOrder, 1);
      return {
        session_id: "sess-fallback-001",
        tenant_id: tenantId,
        recruiter_id: recruiterId,
        playbook_key: playbookKey,
        current_step_order: currentStepOrder,
        vacancy_id: null,
        context
      };
    },
    async updateSession(sessionId, payload) {
      sessionUpdates.push({ sessionId, payload });
    }
  };

  const result = await dispatch({
    managementStore,
    tenantSql: null,
    tenantId: "tenant-alpha-001",
    recruiterId: "rec-alpha-001",
    playbookKey: "create_vacancy",
    recruiterInput: null,
    llmAdapter: null
  });

  assert.equal(result.sessionId, "sess-fallback-001");
  assert.equal(result.reply.kind, "user_input");
  assert.match(result.reply.message, /Загрузите материалы по вакансии/i);
  assert.equal(sessionUpdates.length, 1);
  assert.equal(sessionUpdates[0].sessionId, "sess-fallback-001");
  assert.equal(sessionUpdates[0].payload.currentStepOrder, 1);
});
