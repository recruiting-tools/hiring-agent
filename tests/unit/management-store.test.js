import assert from "node:assert/strict";
import test from "node:test";
import { createManagementStore } from "../../packages/access-context/src/management-store.js";

test("management store: createPlaybookSession persists job_id and derived job_setup_id", async () => {
  const queries = [];
  const store = createManagementStore(createMockSql(({ text, values }) => {
    queries.push({ text, values });
    assert.match(text, /INSERT INTO management\.playbook_sessions/);
    assert.match(text, /job_id/);
    assert.match(text, /job_setup_id/);
    return [{
      session_id: "sess-1",
      tenant_id: "tenant-1",
      recruiter_id: "rec-1",
      playbook_key: "setup_communication",
      current_step_order: 0,
      job_id: "job-1",
      job_setup_id: "vac-1",
      vacancy_id: "vac-1",
      context: { job_id: "job-1", job_setup_id: "vac-1" },
      call_stack: [],
      status: "active"
    }];
  }));

  const session = await store.createPlaybookSession({
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    playbookKey: "setup_communication",
    currentStepOrder: 0,
    vacancyId: "vac-1",
    jobId: "job-1",
    jobSetupId: "vac-1",
    context: { job_id: "job-1", job_setup_id: "vac-1" }
  });

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values.slice(0, 7), [
    "tenant-1",
    "rec-1",
    null,
    "setup_communication",
    0,
    "job-1",
    "vac-1"
  ]);
  assert.equal(session.job_id, "job-1");
  assert.equal(session.job_setup_id, "vac-1");
});

test("management store: getActiveSession resolves by job_id and job_setup_id without vacancy fallback", async () => {
  const store = createManagementStore(createMockSql(({ text, values }) => {
    assert.doesNotMatch(text, /COALESCE\(job_setup_id, vacancy_id\)/);
    assert.match(text, /job_setup_id IS NOT DISTINCT FROM/);
    assert.match(text, /job_id IS NOT DISTINCT FROM/);
    assert.deepEqual(values, [
      "tenant-1",
      "rec-1",
      "setup_communication",
      "job-1",
      "job-1",
      "vac-1",
      "vac-1",
      "job-1",
      "vac-1"
    ]);
    return [{
      session_id: "sess-existing",
      tenant_id: "tenant-1",
      recruiter_id: "rec-1",
      playbook_key: "setup_communication",
      current_step_order: 1,
      job_id: "job-1",
      job_setup_id: "vac-1",
      vacancy_id: null,
      context: { job_id: "job-1" },
      call_stack: [],
      status: "active"
    }];
  }));

  const session = await store.getActiveSession({
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    vacancyId: "vac-1",
    jobId: "job-1",
    jobSetupId: "vac-1",
    playbookKey: "setup_communication"
  });

  assert.equal(session.job_id, "job-1");
  assert.equal(session.job_setup_id, "vac-1");
  assert.equal(session.vacancy_id, null);
});

test("management store: abortActiveSessions filters by job_setup_id without vacancy fallback", async () => {
  const store = createManagementStore(createMockSql(({ text, values }) => {
    assert.doesNotMatch(text, /COALESCE\(job_setup_id, vacancy_id\)/);
    assert.match(text, /job_setup_id IS NOT DISTINCT FROM/);
    assert.deepEqual(values, [
      "tenant-1",
      "rec-1",
      null,
      null,
      "job-1",
      "job-1",
      "vac-1",
      "vac-1",
      "job-1",
      "vac-1"
    ]);
    return [];
  }));

  await store.abortActiveSessions({
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    jobId: "job-1",
    jobSetupId: "vac-1"
  });
});

function createMockSql(handler) {
  return async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    return handler({ text, values });
  };
}
