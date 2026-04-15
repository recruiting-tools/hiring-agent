import assert from "node:assert/strict";
import test from "node:test";
import WsClient from "ws";
import { createHiringAgentApp } from "../../services/hiring-agent/src/app.js";
import { createHiringAgentServer } from "../../services/hiring-agent/src/http-server.js";
import { clearPlaybookRegistryCache } from "../../services/hiring-agent/src/playbooks/registry.js";
import {
  SCENARIO_TEST_MESSAGES,
  UNKNOWN_PLAYBOOK_KEY
} from "../../services/hiring-agent/src/playbooks/playbook-contracts.js";

async function req(server, method, path, body, cookie) {
  const port = server.address().port;
  const options = { method, headers: { "content-type": "application/json" } };
  if (cookie) options.headers.cookie = cookie;
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`http://localhost:${port}${path}`, options);
  const isJson = response.headers.get("content-type")?.includes("json");
  const responseBody = isJson ? await response.json() : await response.text();
  return {
    status: response.status,
    body: responseBody,
    contentType: response.headers.get("content-type")
  };
}

async function login(server) {
  const port = server.address().port;
  const response = await fetch(`http://localhost:${port}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "demo@local",
      password: "demo"
    })
  });

  return response.headers.get("set-cookie");
}

async function loginResponse(server) {
  const port = server.address().port;
  return fetch(`http://localhost:${port}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "demo@local",
      password: "demo"
    })
  });
}

test.beforeEach(() => {
  clearPlaybookRegistryCache();
});

test("hiring-agent: GET /health returns stateless demo status", async () => {
  const server = createHiringAgentServer(createHiringAgentApp({
    demoMode: true,
    appEnv: "local",
    deploySha: "test-sha-demo",
    startedAt: "2026-04-13T00:00:00.000Z",
    port: 0
  })).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.service, "hiring-agent");
    assert.equal(body.mode, "stateless-demo");
    assert.equal(body.app_env, "local");
    assert.equal(body.deploy_sha, "test-sha-demo");
    assert.equal(body.started_at, "2026-04-13T00:00:00.000Z");
    assert.equal(typeof body.port, "number");
  } finally {
    server.close();
  }
});

test("hiring-agent: GET /health exposes configured app env in management mode", async () => {
  const server = createHiringAgentServer(createHiringAgentApp({
    demoMode: false,
    appEnv: "prod",
    deploySha: "test-sha-prod",
    startedAt: "2026-04-13T00:00:00.000Z",
    port: 3101
  })).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.mode, "management-auth");
    assert.equal(body.app_env, "prod");
    assert.equal(body.deploy_sha, "test-sha-prod");
  } finally {
    server.close();
  }
});

test("hiring-agent: GET /health includes playbook registry only when details=1", async () => {
  const server = createHiringAgentServer(createHiringAgentApp({
    demoMode: true,
    appEnv: "local",
    deploySha: "test-sha-health-details",
    startedAt: "2026-04-13T00:00:00.000Z",
    port: 0
  })).listen(0);

  try {
    const base = await req(server, "GET", "/health");
    assert.equal(base.status, 200);
    assert.equal(Object.hasOwn(base.body, "playbooks"), false);
    assert.equal(Object.hasOwn(base.body, "playbook_registry_status"), false);

    const detailed = await req(server, "GET", "/health?details=1");
    assert.equal(detailed.status, 200);
    assert.equal(detailed.body.playbook_registry_status, "ok");
    assert.ok(Array.isArray(detailed.body.playbooks));
    assert.ok(detailed.body.playbooks.length >= 1);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns funnel payload for funnel request", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "render_funnel");
    assert.equal(body.reply.playbook_key, "candidate_funnel");
    assert.equal(typeof body.reply.summary.total, "number");
    assert.ok(Array.isArray(body.reply.rows));
    assert.equal(typeof body.text, "string");
    assert.equal(typeof body.markdown, "string");
    assert.equal(body.markdown, body.text);
    assert.ok(body.text.includes("Воронка кандидатов"));
    assert.ok(!body.text.includes("```json"));
    assert.ok(Array.isArray(body.actions));
    assert.deepEqual(body.actions, [{ label: "Обновить", message: "обнови воронку" }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns funnel payload in demo mode", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const response = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
    }, sessionCookie);
    assert.equal(response.status, 200);
    assert.equal(response.body.reply.kind, "render_funnel");
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns fallback_text for setup_communication in demo mode (no DB)", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "настроить общение с кандидатами"
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "fallback_text");
  } finally {
    server.close();
  }
});

test("hiring-agent: routes via LLM when keyword router misses", async () => {
  let llmCalls = 0;
  const app = createHiringAgentApp({
    llmAdapter: {
      async generate() {
        llmCalls += 1;
        return JSON.stringify({ playbook_key: "candidate_funnel" });
      }
    }
  });

  const result = await app.postChatMessage({
    message: "покажи состояние найма"
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "render_funnel");
  assert.equal(result.body.reply.playbook_key, "candidate_funnel");
  assert.equal(llmCalls, 1);
});

test("hiring-agent: POST /api/chat returns display for assistant_capabilities in demo mode", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: SCENARIO_TEST_MESSAGES.capabilitiesRoute
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "display");
    assert.equal(body.reply.content_type, "text");
    assert.equal(Object.hasOwn(body.reply, "content"), true);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat supports quick_start action without vacancy_id in demo mode", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      action: "start_playbook",
      playbook_key: "quick_start",
      message: SCENARIO_TEST_MESSAGES.quickStartRoute
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "display");
    assert.equal(body.reply.content_type, "text");
    assert.equal(Object.hasOwn(body.reply, "content"), true);
  } finally {
    server.close();
  }
});

test("hiring-agent: account_access returns fallback when management DB is unavailable", async () => {
  const app = createHiringAgentApp();
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "account_access",
    message: "отключить hh"
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "fallback_text");
  assert.match(result.body.reply.text, /management DB/i);
});

test("hiring-agent: account_access revokes hh oauth access and feature flags", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "account_access",
          name: "Управление доступом к hh.ru",
          trigger_description: "revoke hh access",
          status: "available",
          sort_order: 1,
          step_count: 0
        }
      ];
    }

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [];
    }

    if (text.includes("DELETE FROM management.oauth_tokens")) {
      return [{ ok: 1 }, { ok: 1 }];
    }

    if (text.includes("UPDATE management.feature_flags")) {
      return [{ ok: 1 }];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "account_access",
    managementSql
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "display");
  assert.match(result.body.reply.content, /Доступ к hh\.ru отключен|Доступ к hh\.ru отключён/i);
  assert.match(result.body.reply.content, /OAuth-записей: 2/);
  assert.match(result.body.reply.content, /hh_send\/hh_import: 1/);
});

test("hiring-agent: data_retention asks confirmation before destructive cleanup", async () => {
  let tenantDeleteCalls = 0;
  let managementDeleteCalls = 0;
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "data_retention",
          name: "Очистка данных аккаунта",
          trigger_description: "wipe data",
          status: "available",
          sort_order: 1,
          step_count: 0
        }
      ];
    }

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [];
    }

    if (text.includes("DELETE FROM management.") || text.includes("UPDATE management.feature_flags")) {
      managementDeleteCalls += 1;
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };
  const tenantSql = async (strings) => {
    const text = strings.join("");
    if (text.includes("DELETE FROM chatbot.")) {
      tenantDeleteCalls += 1;
      return [];
    }
    throw new Error(`Unexpected tenant query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "data_retention",
    message: "удали все данные",
    tenantId: "tenant-alpha-001",
    managementSql,
    tenantSql
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "display");
  assert.match(result.body.reply.content, /delete all my data/);
  assert.equal(managementDeleteCalls, 0);
  assert.equal(tenantDeleteCalls, 0);
});

test("hiring-agent: data_retention removes tenant and access data after exact confirmation", async () => {
  const tenantCountByTable = new Map([
    ["chatbot.message_delivery_attempts", 2],
    ["chatbot.planned_messages", 3],
    ["chatbot.messages", 4],
    ["chatbot.pipeline_step_state", 5],
    ["chatbot.pipeline_events", 6],
    ["chatbot.hh_poll_state", 1],
    ["chatbot.hh_negotiations", 2],
    ["chatbot.pipeline_runs", 3],
    ["chatbot.vacancies", 2],
    ["chatbot.conversations", 2],
    ["chatbot.pipeline_templates", 1],
    ["chatbot.sessions", 1],
    ["chatbot.recruiters", 1],
    ["chatbot.candidates", 2],
    ["chatbot.jobs", 1]
  ]);
  const managementCountByQuery = new Map([
    ["DELETE FROM management.oauth_tokens", 1],
    ["UPDATE management.feature_flags", 2],
    ["DELETE FROM management.tenant_playbook_access", 3],
    ["DELETE FROM management.playbook_sessions", 4],
    ["DELETE FROM management.recruiter_subscriptions", 5],
    ["DELETE FROM management.sessions", 6],
    ["DELETE FROM management.recruiters", 7]
  ]);

  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "data_retention",
          name: "Очистка данных аккаунта",
          trigger_description: "wipe data",
          status: "available",
          sort_order: 1,
          step_count: 0
        }
      ];
    }

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [];
    }

    for (const [pattern, count] of managementCountByQuery.entries()) {
      if (text.includes(pattern)) {
        return Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
      }
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const tenantSql = async (strings) => {
    const text = strings.join("");
    for (const [pattern, count] of tenantCountByTable.entries()) {
      if (text.includes(`DELETE FROM ${pattern}`)) {
        return Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
      }
    }

    throw new Error(`Unexpected tenant query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "data_retention",
    message: "delete all my data",
    tenantId: "tenant-alpha-001",
    managementSql,
    tenantSql
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "display");
  assert.match(result.body.reply.content, /Очистка данных выполнена/);
  assert.match(result.body.reply.content, /Management: oauth_tokens=1, feature_flags=2/);
  assert.match(result.body.reply.content, /Tenant DB: pipeline_templates=1/);
  assert.match(result.body.reply.content, /message_delivery_attempts=2/);
  assert.match(result.body.reply.content, /jobs=1/);
});

test("hiring-agent: POST /api/chat start_playbook action without playbook_key routes by message", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      action: "start_playbook",
      message: SCENARIO_TEST_MESSAGES.capabilitiesRoute
    }, sessionCookie);

    assert.equal(status, 200);
    assert.equal(body.reply.kind, "display");
    assert.equal(body.reply.content_type, "text");
    assert.equal(Object.hasOwn(body.reply, "content"), true);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns playbook_not_found for unknown start_playbook key", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      action: "start_playbook",
      playbook_key: UNKNOWN_PLAYBOOK_KEY,
      message: SCENARIO_TEST_MESSAGES.unknownPlaybook
    }, sessionCookie);

    assert.equal(status, 404);
    assert.equal(body.error, "playbook_not_found");
    assert.equal(Object.hasOwn(body, "reply"), false);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed postChatMessage handles utility and requires vacancy for non-utility", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [];
    }

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "quick_start",
          name: "Быстрый старт",
          trigger_description: "quick start",
          status: "available",
          sort_order: 1,
          step_count: 1
        },
        {
          playbook_key: "view_vacancy",
          name: "Посмотреть информацию по вакансии",
          trigger_description: "вакансия",
          status: "available",
          sort_order: 2,
          step_count: 2
        }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false
  });

  const utilityResult = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "quick_start",
    managementSql
  });

  assert.equal(utilityResult.status, 200);
  assert.equal(utilityResult.body.reply.kind, "display");
  assert.equal(utilityResult.body.reply.content_type, "text");
  assert.equal(Object.hasOwn(utilityResult.body.reply, "content"), true);

  const protectedResult = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "view_vacancy",
    message: "покажи вакансию",
    managementSql
  });

  assert.equal(protectedResult.status, 200);
  assert.equal(protectedResult.body.reply.kind, "fallback_text");
  assert.match(protectedResult.body.reply.text, /Сначала выберите вакансию/);
});

test("hiring-agent: postChatMessage returns playbook_locked when tenant access disables playbook", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [{ playbook_key: "quick_start", enabled: false }];
    }

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "quick_start",
          name: "Быстрый старт",
          trigger_description: "quick start",
          status: "available",
          sort_order: 1,
          step_count: 1
        }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: "quick_start",
    tenantId: "tenant-locked-001",
    managementSql
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "playbook_locked");
  assert.equal(result.body.reply.playbook_key, "quick_start");
});

test("hiring-agent: postChatMessage returns playbook_not_found for unknown start_playbook key", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "quick_start",
          name: "Быстрый старт",
          trigger_description: "quick start",
          status: "available",
          sort_order: 1,
          step_count: 1
        }
      ];
    }

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const result = await app.postChatMessage({
    action: "start_playbook",
    playbook_key: UNKNOWN_PLAYBOOK_KEY,
    managementSql
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "playbook_not_found");
});

test("hiring-agent: management-backed routing ignores available playbooks with zero steps", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d") && text.includes("d.keywords")) {
      return [
        {
          playbook_key: "mass_broadcast",
          keywords: ["рассылка"],
          step_count: 0
        },
        {
          playbook_key: "setup_communication",
          keywords: ["общение"],
          step_count: 6
        }
      ];
    }

    if (text.includes("FROM management.playbook_definitions d") && text.includes("d.trigger_description")) {
      return [
        {
          playbook_key: "mass_broadcast",
          name: "Выборочная рассылка кандидатам",
          trigger_description: "broadcast",
          status: "available",
          sort_order: 1,
          step_count: 0
        },
        {
          playbook_key: "setup_communication",
          name: "Настроить общение с кандидатами",
          trigger_description: "communication",
          status: "available",
          sort_order: 2,
          step_count: 6
        }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql
  });

  const result = await app.postChatMessage({
    message: "сделай рассылку",
    managementSql
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.reply.kind, "fallback_text");
  assert.match(result.body.reply.text, /поддерживаю/i);
});

test("hiring-agent: create_vacancy starts from fallback steps when DB step_count is zero", async () => {
  clearPlaybookRegistryCache();
  let sessionSequence = 0;
  const managementSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "create_vacancy",
          name: "Создать новую вакансию",
          trigger_description: "create vacancy",
          status: "available",
          sort_order: 1,
          step_count: 0
        }
      ];
    }

    if (text.includes("FROM management.playbook_steps")) {
      return [];
    }

    if (text.includes("FROM management.playbook_sessions") && text.includes("status = 'active'")) {
      return [];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'aborted'")) {
      return [];
    }

    if (text.includes("INSERT INTO management.playbook_sessions")) {
      sessionSequence += 1;
      return [{
        session_id: `sess-fallback-${sessionSequence}`,
        tenant_id: "tenant-alpha-001",
        recruiter_id: "rec-alpha-001",
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: 1,
        vacancy_id: null,
        context: {},
        call_stack: [],
        status: "active",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: null
      }];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("SET")) {
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql
  });

  try {
    const result = await app.postChatMessage({
      action: "start_playbook",
      playbook_key: "create_vacancy",
      tenantId: "tenant-alpha-001",
      recruiterId: "rec-alpha-001",
      managementSql
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.reply.kind, "user_input");
    assert.match(result.body.reply.message, /Загрузите материалы по вакансии/i);
    assert.equal(typeof result.body.session_id, "string");
  } finally {
    clearPlaybookRegistryCache();
  }
});

test("hiring-agent: create_vacancy remains available when tenant override is disabled", async () => {
  clearPlaybookRegistryCache();
  let sessionSequence = 0;
  const managementSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [
        {
          playbook_key: "create_vacancy",
          name: "Создать новую вакансию",
          trigger_description: "create vacancy",
          status: "available",
          sort_order: 1,
          step_count: 0
        }
      ];
    }

    if (text.includes("FROM management.tenant_playbook_access")) {
      return [
        {
          playbook_key: "create_vacancy",
          enabled: false
        }
      ];
    }

    if (text.includes("FROM management.playbook_steps")) {
      return [];
    }

    if (text.includes("FROM management.playbook_sessions") && text.includes("status = 'active'")) {
      return [];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'aborted'")) {
      return [];
    }

    if (text.includes("INSERT INTO management.playbook_sessions")) {
      sessionSequence += 1;
      return [{
        session_id: `sess-override-${sessionSequence}`,
        tenant_id: "tenant-alpha-001",
        recruiter_id: "rec-alpha-001",
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: 1,
        vacancy_id: null,
        context: {},
        call_stack: [],
        status: "active",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: null
      }];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("SET")) {
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql
  });

  try {
    const result = await app.postChatMessage({
      action: "start_playbook",
      playbook_key: "create_vacancy",
      tenantId: "tenant-alpha-001",
      recruiterId: "rec-alpha-001",
      managementSql
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.reply.kind, "user_input");
    assert.match(result.body.reply.message, /Загрузите материалы по вакансии/i);
  } finally {
    clearPlaybookRegistryCache();
  }
});

test("hiring-agent: create_vacancy follow-up runs setup_communication when recruiter selected planning action", async () => {
  clearPlaybookRegistryCache();
  let sessionSequence = 0;
  const managementSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [{
        playbook_key: "create_vacancy",
        name: "Создать новую вакансию",
        trigger_description: "create vacancy",
        status: "available",
        sort_order: 1,
        step_count: 1
      }];
    }

    if (text.includes("FROM management.playbook_steps")) {
      return [{
        step_key: "create_vacancy.14",
        playbook_key: "create_vacancy",
        step_order: 1,
        name: "Что делаем дальше?",
        step_type: "buttons",
        user_message: "Что хотите сделать?",
        prompt_template: null,
        context_key: "next_action",
        db_save_column: null,
        next_step_order: null,
        options: "Распланировать общение с кандидатами;Сравнить с другими вакансиями;Готово",
        routing: null,
        notes: null,
        created_at: new Date()
      }];
    }

    if (text.includes("FROM management.playbook_sessions") && text.includes("status = 'active'")) {
      return [];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'aborted'")) {
      return [];
    }

    if (text.includes("INSERT INTO management.playbook_sessions")) {
      sessionSequence += 1;
      return [{
        session_id: `sess-followup-${sessionSequence}`,
        tenant_id: null,
        recruiter_id: null,
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: 1,
        vacancy_id: "vac-plan-1",
        context: { vacancy_id: "vac-plan-1" },
        call_stack: [],
        status: "active",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: null
      }];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'completed'")) {
      return [{
        session_id: "sess-followup-1",
        tenant_id: null,
        recruiter_id: null,
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: null,
        vacancy_id: "vac-plan-1",
        context: {
          vacancy_id: "vac-plan-1",
          next_action: "Распланировать общение с кандидатами"
        },
        call_stack: [],
        status: "completed",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: new Date()
      }];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.vacancies/.test(text) && /must_haves/.test(text) && /WHERE vacancy_id = \$1/.test(text)) {
      assert.deepEqual(values, ["vac-plan-1"]);
      return [{
        vacancy_id: "vac-plan-1",
        title: "Менеджер по продажам",
        must_haves: ["B2B продажи", "CRM"],
        nice_haves: [],
        work_conditions: { salary_range: { min: 150000, max: 220000 } },
        application_steps: [
          { name: "Приветствие", in_our_scope: true, is_target: false },
          { name: "Созвон", in_our_scope: true, is_target: true }
        ],
        communication_plan: null,
        communication_plan_draft: null,
        communication_examples: [],
        communication_examples_plan_hash: null
      }];
    }

    if (/FROM chatbot\.vacancies/.test(text) && /WHERE vacancy_id = \$1/.test(text)) {
      assert.deepEqual(values, ["vac-plan-1"]);
      return [{
        vacancy_id: "vac-plan-1",
        job_id: "job-plan-1",
        title: "Менеджер по продажам",
        status: "draft",
        extraction_status: "done"
      }];
    }

    if (/UPDATE chatbot\.vacancies/.test(text) && /communication_plan_draft/.test(text)) {
      assert.equal(values.at(-1), "vac-plan-1");
      return [];
    }

    throw new Error(`Unexpected tenant query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql,
    llmAdapter: {
      async generate() {
        return JSON.stringify({
          scenario_title: "План для менеджера по продажам",
          goal: "Договоренность о собеседовании",
          steps: [
            { step: "Приветствие и вопрос мотивации?", reminders_count: 1, comment: "Открываем диалог" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Скрининг по опыту" },
            { step: "Сверка условий", reminders_count: 1, comment: "Снимаем риски" },
            { step: "Короткий рассказ о роли", reminders_count: 0, comment: "Контекст вакансии" },
            { step: "Приглашение на собеседование", reminders_count: 2, comment: "Фиксируем следующий шаг" }
          ]
        });
      }
    }
  });

  try {
    const result = await app.postChatMessage({
      action: "start_playbook",
      playbook_key: "create_vacancy",
      message: "Распланировать общение с кандидатами",
      vacancy_id: "vac-plan-1",
      tenantSql,
      managementSql
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.reply.kind, "communication_plan");
    assert.equal(result.body.reply.scenario_title, "План для менеджера по продажам");
    assert.equal(result.body.reply.steps.length, 5);
  } finally {
    clearPlaybookRegistryCache();
  }
});

test("hiring-agent: create_vacancy follow-up compares current vacancy with others", async () => {
  clearPlaybookRegistryCache();
  let sessionSequence = 0;
  const managementSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (text.includes("FROM management.playbook_definitions d")) {
      return [{
        playbook_key: "create_vacancy",
        name: "Создать новую вакансию",
        trigger_description: "create vacancy",
        status: "available",
        sort_order: 1,
        step_count: 1
      }];
    }

    if (text.includes("FROM management.playbook_steps")) {
      return [{
        step_key: "create_vacancy.14",
        playbook_key: "create_vacancy",
        step_order: 1,
        name: "Что делаем дальше?",
        step_type: "buttons",
        user_message: "Что хотите сделать?",
        prompt_template: null,
        context_key: "next_action",
        db_save_column: null,
        next_step_order: null,
        options: "Распланировать общение с кандидатами;Сравнить с другими вакансиями;Готово",
        routing: null,
        notes: null,
        created_at: new Date()
      }];
    }

    if (text.includes("FROM management.playbook_sessions") && text.includes("status = 'active'")) {
      return [];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'aborted'")) {
      return [];
    }

    if (text.includes("INSERT INTO management.playbook_sessions")) {
      sessionSequence += 1;
      return [{
        session_id: `sess-compare-${sessionSequence}`,
        tenant_id: null,
        recruiter_id: null,
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: 1,
        vacancy_id: "vac-current",
        context: { vacancy_id: "vac-current" },
        call_stack: [],
        status: "active",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: null
      }];
    }

    if (text.includes("UPDATE management.playbook_sessions") && text.includes("status = 'completed'")) {
      return [{
        session_id: "sess-compare-1",
        tenant_id: null,
        recruiter_id: null,
        conversation_id: null,
        playbook_key: "create_vacancy",
        current_step_order: null,
        vacancy_id: "vac-current",
        context: {
          vacancy_id: "vac-current",
          next_action: "Сравнить с другими вакансиями"
        },
        call_stack: [],
        status: "completed",
        started_at: new Date(),
        updated_at: new Date(),
        completed_at: new Date()
      }];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/SELECT\s+vacancy_id,\s*job_id,\s*title,\s*status,\s*extraction_status/i.test(text)) {
      assert.deepEqual(values, ["vac-current"]);
      return [{
        vacancy_id: "vac-current",
        job_id: "job-current",
        title: "Менеджер по продажам",
        status: "draft",
        extraction_status: "done"
      }];
    }

    if (/SELECT\s+vacancy_id,\s*title,\s*status,\s*extraction_status,\s*must_haves/i.test(text) && /WHERE vacancy_id = \$1/i.test(text)) {
      assert.deepEqual(values, ["vac-current"]);
      return [{
        vacancy_id: "vac-current",
        title: "Менеджер по продажам",
        status: "draft",
        extraction_status: "done",
        must_haves: ["B2B продажи", "CRM"],
        application_steps: [{ name: "Скрининг" }, { name: "Созвон" }],
        communication_plan: { scenario_title: "Базовый" }
      }];
    }

    if (/SELECT\s+vacancy_id,\s*title,\s*status,\s*extraction_status,\s*must_haves/i.test(text) && /WHERE vacancy_id <> \$1/i.test(text)) {
      assert.deepEqual(values, ["vac-current"]);
      return [{
        vacancy_id: "vac-other-1",
        title: "Менеджер по работе с ключевыми клиентами",
        status: "active",
        extraction_status: "done",
        must_haves: ["B2B", "переговоры", "CRM"],
        application_steps: [{ name: "Скрининг" }],
        communication_plan: null
      }];
    }

    throw new Error(`Unexpected tenant query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql
  });

  try {
    const result = await app.postChatMessage({
      action: "start_playbook",
      playbook_key: "create_vacancy",
      message: "Сравнить с другими вакансиями",
      vacancy_id: "vac-current",
      tenantSql,
      managementSql
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.reply.kind, "fallback_text");
    assert.match(result.body.reply.text, /Сравнение с другими вакансиями/);
    assert.match(result.body.reply.text, /\| Вакансия \| Статус \| Маст-хэвы \| Шагов найма \| Коммуникация \|/);
    assert.match(result.body.reply.text, /Менеджер по продажам \(текущая\)/);
  } finally {
    clearPlaybookRegistryCache();
  }
});

test("hiring-agent: GET / serves HTML shell after auth", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body, contentType } = await req(server, "GET", "/", undefined, sessionCookie);
    assert.equal(status, 200);
    assert.ok(contentType?.includes("text/html"));
    assert.ok(body.includes("Hiring Agent"));
    assert.ok(body.includes("vacancy-select"));
  } finally {
    server.close();
  }
});

test("hiring-agent: base path mode isolates auth/app routes under /sandbox-001", async () => {
  const server = createHiringAgentServer(createHiringAgentApp(), {
    appBasePath: "/sandbox-001",
    sessionCookieName: "session_sandbox_001"
  }).listen(0);

  try {
    const port = server.address().port;
    const loginResponse = await fetch(`http://localhost:${port}/sandbox-001/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@local",
        password: "demo"
      })
    });
    const setCookie = loginResponse.headers.get("set-cookie") ?? "";
    assert.equal(loginResponse.status, 200);
    assert.match(setCookie, /^session_sandbox_001=/);
    assert.match(setCookie, /Path=\/sandbox-001/);

    const shellResponse = await fetch(`http://localhost:${port}/sandbox-001/`, {
      headers: { cookie: setCookie }
    });
    const shellHtml = await shellResponse.text();
    assert.equal(shellResponse.status, 200);
    assert.match(shellHtml, /const APP_BASE_PATH = '\/sandbox-001';/);
    assert.match(shellHtml, /href="\/sandbox-001\/logout"/);

    const wsUrl = `ws://localhost:${port}/sandbox-001/ws`;
    await new Promise((resolve, reject) => {
      const ws = new WsClient(wsUrl, { headers: { cookie: setCookie } });
      const timeout = setTimeout(() => reject(new Error("ws timeout")), 2_000);
      ws.on("open", () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      });
      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    const noPrefixResponse = await fetch(`http://localhost:${port}/`, {
      headers: { cookie: setCookie },
      redirect: "manual"
    });
    assert.equal(noPrefixResponse.status, 404);
  } finally {
    server.close();
  }
});

test("hiring-agent: GET /chat/:artifactId returns 404 on this API surface", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status } = await req(server, "GET", "/chat/art-123", undefined, sessionCookie);
    assert.equal(status, 404);
  } finally {
    server.close();
  }
});

test("hiring-agent: GET /chat/communication-examples returns HTML report for vacancy", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((acc, chunk, index) => (
      acc + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (text.includes("FROM chatbot.vacancies") && text.includes("WHERE vacancy_id = $1")) {
      return [{
        vacancy_id: "vac-test-1",
        title: "Менеджер по продажам",
        updated_at: "2026-04-15T08:00:00.000Z",
        communication_plan: {
          scenario_title: "Базовый сценарий",
          goal: "Назначить интервью",
          steps: [
            { step: "Приветствие и вопрос", reminders_count: 1, comment: "Открыть контакт" },
            { step: "Проверка опыта", reminders_count: 1, comment: "Квалификация" },
            { step: "Сверка условий", reminders_count: 1, comment: "Снять риски" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Назначить слот" }
          ]
        },
        communication_plan_draft: null,
        communication_examples: [
          {
            title: "Сильный кандидат",
            summary: "B2B опыт 5 лет, готов к интервью",
            turns: [
              { speaker: "recruiter", message: "Здравствуйте! Готовы обсудить роль?" },
              { speaker: "candidate", message: "Да, интересно." },
              { speaker: "recruiter", message: "Когда удобно выйти на интервью?" },
              { speaker: "candidate", message: "Завтра после 14:00." }
            ]
          }
        ]
      }];
    }

    return [];
  };

  const server = createHiringAgentServer(createHiringAgentApp(), {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body, contentType } = await req(
      server,
      "GET",
      "/chat/communication-examples?vacancy_id=vac-test-1",
      undefined,
      "session=sess-alpha"
    );
    assert.equal(status, 200);
    assert.match(contentType ?? "", /text\/html/);
    assert.match(body, /Примеры общения/);
    assert.match(body, /Сильный кандидат/);
    assert.match(body, /Завтра после 14:00/);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /auth/login sets 30 day cookie without secure outside production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const response = await loginResponse(server);
    const setCookie = response.headers.get("set-cookie");

    assert.match(setCookie, /Max-Age=2592000/);
    assert.doesNotMatch(setCookie, /;\s*Secure/i);
  } finally {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("hiring-agent: auth cookies include secure in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const loginSetCookie = (await loginResponse(server)).headers.get("set-cookie");
    assert.match(loginSetCookie, /;\s*Secure/i);

    const port = server.address().port;
    const logoutResponse = await fetch(`http://localhost:${port}/logout`, {
      method: "GET",
      redirect: "manual"
    });
    const logoutSetCookie = logoutResponse.headers.get("set-cookie");
    assert.match(logoutSetCookie, /;\s*Secure/i);
  } finally {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("hiring-agent: invalid JSON request body returns 400", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://localhost:${port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid"
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "invalid_json");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/vacancies resolves tenant sql via access context", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.vacancies/.test(text)) {
      assert.deepEqual(values, []);
      return [{ vacancy_id: "vac-1", job_id: "job-1", title: "Alpha role", status: "active", extraction_status: "complete" }];
    }

    if (/FROM chatbot\.jobs/.test(text)) {
      assert.match(text, /WHERE client_id = \$1/);
      assert.deepEqual(values, ["tenant-alpha-001"]);
      return [{ job_id: "job-1", title: "Alpha role" }];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 200);
    assert.deepEqual(body.vacancies, [{ vacancy_id: "vac-1", job_id: "job-1", title: "Alpha role", status: "active", extraction_status: "complete" }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/vacancies falls back to chatbot.jobs when vacancies table is empty", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.vacancies/.test(text)) {
      assert.deepEqual(values, []);
      return [];
    }

    if (/FROM chatbot\.jobs/.test(text)) {
      assert.match(text, /WHERE client_id = \$1/);
      assert.deepEqual(values, ["tenant-alpha-001"]);
      return [{ job_id: "job-1", title: "Alpha role" }];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 200);
    assert.deepEqual(body.vacancies, [{
      vacancy_id: "job-1",
      job_id: "job-1",
      title: "Alpha role",
      status: "active",
      extraction_status: "pending"
    }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/vacancies merges jobs without vacancy rows", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.vacancies/.test(text)) {
      assert.deepEqual(values, []);
      return [{
        vacancy_id: "vac-1",
        job_id: "job-1",
        title: "Alpha role",
        status: "active",
        extraction_status: "complete"
      }];
    }

    if (/FROM chatbot\.jobs/.test(text)) {
      assert.match(text, /WHERE client_id = \$1/);
      assert.deepEqual(values, ["tenant-alpha-001"]);
      return [
        { job_id: "job-1", title: "Alpha role" },
        { job_id: "job-2", title: "Beta role" }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 200);
    assert.deepEqual(body.vacancies, [
      { vacancy_id: "vac-1", job_id: "job-1", title: "Alpha role", status: "active", extraction_status: "complete" },
      { vacancy_id: "job-2", job_id: "job-2", title: "Beta role", status: "active", extraction_status: "pending" }
    ]);
    assert.deepEqual(body.jobs, body.vacancies);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/vacancies keeps two recruiter sessions isolated", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "sandbox",
    managementStore: {
      async getRecruiterSession(sessionToken) {
        if (sessionToken === "sess-alpha") {
          return {
            recruiter_id: "rec-alpha-001",
            email: "alpha@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-alpha-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        if (sessionToken === "sess-beta") {
          return {
            recruiter_id: "rec-beta-001",
            email: "beta@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-beta-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        return null;
      },
      async getPrimaryBinding({ tenantId }) {
        return {
          binding_id: `bind-${tenantId}`,
          db_alias: `db-${tenantId}`,
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection(dbAlias) {
        return {
          db_alias: dbAlias,
          connection_string: `postgres://${dbAlias}`
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate({ dbAlias }) {
        return async (strings, ...values) => {
          const text = strings.reduce((result, chunk, index) => (
            result + chunk + (index < values.length ? `$${index + 1}` : "")
          ), "");

          if (/FROM chatbot\.vacancies/.test(text)) {
            assert.deepEqual(values, []);
            if (dbAlias === "db-tenant-alpha-001") {
              return [{ vacancy_id: "vac-alpha-1", job_id: "job-alpha-1", title: "Alpha role", status: "active", extraction_status: "complete" }];
            }

            return [{ vacancy_id: "vac-beta-1", job_id: "job-beta-1", title: "Beta role", status: "active", extraction_status: "complete" }];
          }

          if (/FROM chatbot\.jobs/.test(text)) {
            assert.match(text, /WHERE client_id = \$1/);
            if (dbAlias === "db-tenant-alpha-001") {
              assert.deepEqual(values, ["tenant-alpha-001"]);
              return [{ job_id: "job-alpha-1", title: "Alpha role" }];
            }

            assert.deepEqual(values, ["tenant-beta-001"]);
            return [{ job_id: "job-beta-1", title: "Beta role" }];
          }

          throw new Error(`Unexpected query: ${text}`);
        };
      }
    }
  }).listen(0);

  try {
    const alpha = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    const beta = await req(server, "GET", "/api/vacancies", undefined, "session=sess-beta");

    assert.equal(alpha.status, 200);
    assert.deepEqual(alpha.body.vacancies, [{ vacancy_id: "vac-alpha-1", job_id: "job-alpha-1", title: "Alpha role", status: "active", extraction_status: "complete" }]);
    assert.equal(beta.status, 200);
    assert.deepEqual(beta.body.vacancies, [{ vacancy_id: "vac-beta-1", job_id: "job-beta-1", title: "Beta role", status: "active", extraction_status: "complete" }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/vacancies returns explicit timeout error for stuck tenant db", async () => {
  const app = createHiringAgentApp({ demoMode: false, tenantDbTimeoutMs: 20 });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => new Promise(() => {});
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 503);
    assert.equal(body.error, "tenant_db_timeout");
    assert.equal(body.operation, "getVacancies");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed access denies suspended recruiter", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "suspended",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      }
    },
    poolRegistry: {
      getOrCreate() {
        throw new Error("should not be called");
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 403);
    assert.equal(body.error, "ERROR_RECRUITER_SUSPENDED");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed access denies archived tenant", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "archived",
          expires_at: new Date()
        };
      }
    },
    poolRegistry: {
      getOrCreate() {
        throw new Error("should not be called");
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies", undefined, "session=sess-alpha");
    assert.equal(status, 403);
    assert.equal(body.error, "ERROR_TENANT_SUSPENDED");
  } finally {
    server.close();
  }
});

test("hiring-agent: demo mode missing session returns 401 explicitly", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/vacancies");
    assert.equal(status, 401);
    assert.equal(body.error, "unauthorized");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat returns guidance when no job_id provided", async () => {
  const tenantSql = async () => {
    throw new Error("tenantSql must not be called when job_id is missing");
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return { binding_id: "bind-1", db_alias: "db-alpha", binding_kind: "shared_db", schema_name: null };
      },
      async getDatabaseConnection() {
        return { db_alias: "db-alpha", connection_string: "postgres://alpha" };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: { getOrCreate() { return tenantSql; } }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
      // no job_id
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "fallback_text");
    assert.ok(body.reply.text.includes("Выберите вакансию"));
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat rejects foreign job_id before funnel query", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    assert.match(text, /WHERE job_id = \$1/);
    assert.deepEqual(values, ["job-foreign", "tenant-alpha-001"]);
    return [];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-foreign"
    }, "session=sess-alpha");
    assert.equal(status, 404);
    assert.equal(body.error, "job_not_found");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat isolates foreign job_id between two recruiters", async () => {
  const tenantSqlByToken = {
    "sess-alpha": async (strings, ...values) => {
      const text = strings.reduce((result, chunk, index) => (
        result + chunk + (index < values.length ? `$${index + 1}` : "")
      ), "");

      if (text.includes("WHERE job_id =")) {
        if (values[0] === "job-beta-1") return [];
        return [{ job_id: "job-alpha-1", title: "Alpha role" }];
      }

      return [{
        step_name: "intro",
        total: 3,
        completed: 2,
        in_progress: 1,
        stuck: 0,
        rejected: 0
      }];
    },
    "sess-beta": async (strings, ...values) => {
      const text = strings.reduce((result, chunk, index) => (
        result + chunk + (index < values.length ? `$${index + 1}` : "")
      ), "");

      if (text.includes("WHERE job_id =")) {
        if (values[0] === "job-alpha-1") return [];
        return [{ job_id: "job-beta-1", title: "Beta role" }];
      }

      return [{
        step_name: "intro",
        total: 2,
        completed: 1,
        in_progress: 1,
        stuck: 0,
        rejected: 0
      }];
    }
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "sandbox",
    managementStore: {
      async getRecruiterSession(sessionToken) {
        if (sessionToken === "sess-alpha") {
          return {
            recruiter_id: "rec-alpha-001",
            email: "alpha@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-alpha-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        if (sessionToken === "sess-beta") {
          return {
            recruiter_id: "rec-beta-001",
            email: "beta@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-beta-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        return null;
      },
      async getPrimaryBinding({ tenantId }) {
        return {
          binding_id: `bind-${tenantId}`,
          db_alias: `db-${tenantId}`,
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection(dbAlias) {
        return {
          db_alias: dbAlias,
          connection_string: `postgres://${dbAlias}`
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate({ dbAlias }) {
        if (dbAlias === "db-tenant-alpha-001") return tenantSqlByToken["sess-alpha"];
        return tenantSqlByToken["sess-beta"];
      }
    }
  }).listen(0);

  try {
    const alphaForeign = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-beta-1"
    }, "session=sess-alpha");
    const betaForeign = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-alpha-1"
    }, "session=sess-beta");
    const betaOwn = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-beta-1"
    }, "session=sess-beta");

    assert.equal(alphaForeign.status, 404);
    assert.equal(alphaForeign.body.error, "job_not_found");
    assert.equal(betaForeign.status, 404);
    assert.equal(betaForeign.body.error, "job_not_found");
    assert.equal(betaOwn.status, 200);
    assert.equal(betaOwn.body.reply.kind, "render_funnel");
    assert.equal(betaOwn.body.reply.summary.total, 2);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat accepts owned job_id and returns funnel", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-owned", title: "Owned role" }];
    }

    if (callIndex === 2) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-owned"]);
      return [];
    }

    if (text === "and pipeline_runs.job_id = $1") {
      assert.deepEqual(values, ["job-owned"]);
      return { fragment: true };
    }

    assert.match(text, /with scoped_runs as/);
    return [{
      step_name: "Screening",
      step_id: "screening",
      step_index: 0,
      total: 3,
      in_progress: 1,
      completed: 1,
      stuck: 0,
      rejected: 1
    }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-owned"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "render_funnel");
    assert.equal(body.reply.summary.total, 3);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat resolves job_id from vacancy_id for funnel", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["vac-123"]);
      return [{
        vacancy_id: "vac-123",
        job_id: "job-owned",
        title: "Owned role",
        status: "active",
        extraction_status: "complete"
      }];
    }

    if (callIndex === 2) {
      assert.match(text, /FROM chatbot\.jobs/);
      assert.match(text, /WHERE job_id = \$1\s+AND client_id = \$2/);
      assert.deepEqual(values, ["job-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-owned", title: "Owned role" }];
    }

    if (text === "and pipeline_runs.job_id = $1") {
      assert.deepEqual(values, ["job-owned"]);
      return { fragment: true };
    }

    assert.match(text, /with scoped_runs as/);
    return [{
      step_name: "Screening",
      step_id: "screening",
      step_index: 0,
      total: 4,
      in_progress: 1,
      completed: 2,
      stuck: 0,
      rejected: 1
    }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      vacancy_id: "vac-123"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "render_funnel");
    assert.equal(body.reply.summary.total, 4);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed setup_communication returns structured communication_plan reply", async () => {
  const llmCalls = [];
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d") && text.includes("d.trigger_description")) {
      return [{
        playbook_key: "setup_communication",
        name: "Настроить общение с кандидатами",
        trigger_description: "communication",
        status: "available",
        sort_order: 1,
        step_count: 1
      }];
    }

    throw new Error(`Unexpected management query: ${text}`);
  };

  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.jobs/.test(text) && /WHERE job_id = \$1\s+AND client_id = \$2/.test(text)) {
      assert.match(text, /FROM chatbot\.jobs/);
      assert.deepEqual(values, ["job-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-owned", title: "Owned role" }];
    }

    if (/FROM chatbot\.vacancies/.test(text) && /WHERE vacancy_id = \$1/.test(text)) {
      assert.deepEqual(values, ["job-owned"]);
      return [{
        vacancy_id: "job-owned",
        title: "Менеджер по продажам",
        must_haves: ["B2B продажи", "CRM"],
        nice_haves: ["Английский B2+"],
        work_conditions: {
          salary_range: { min: 180000, max: 250000 },
          location: "Удаленно"
        },
        application_steps: [
          { id: "intro", label: "Приветствие", owner: "agent" },
          { id: "screen", label: "Скрининг", owner: "agent" },
          { id: "sync", label: "Созвон", owner: "recruiter" }
        ],
        communication_plan: null,
        communication_plan_draft: null,
        communication_examples: [],
        communication_examples_plan_hash: null
      }];
    }

    if (/UPDATE chatbot\.vacancies/.test(text) && /communication_plan_draft/.test(text)) {
      assert.equal(values.at(-1), "job-owned");
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql,
    llmAdapter: {
      async generate(prompt) {
        llmCalls.push(prompt);
        return JSON.stringify({
          scenario_title: "Базовый скрининг менеджера по продажам",
          goal: "Договоренность о созвоне",
          steps: [
            { step: "Здравствуйте! Подскажите, что для вас важно в новой роли?", reminders_count: 1, comment: "Открываем диалог" },
            { step: "Уточнить релевантный опыт B2B-продаж", reminders_count: 1, comment: "Проверяем базовый fit" },
            { step: "Сверить ожидания по доходу и формату работы", reminders_count: 1, comment: "Снимаем риск по условиям" },
            { step: "Кратко рассказать про роль и этапы отбора", reminders_count: 0, comment: "Формируем интерес" },
            { step: "Предложить слот на собеседование/созвон", reminders_count: 2, comment: "Фиксируем следующий этап" }
          ]
        });
      }
    }
  });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementSql,
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "настроить общение с кандидатами",
      action: "start_playbook",
      playbook_key: "setup_communication",
      job_id: "job-owned",
      vacancy_id: "job-owned"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "communication_plan");
    assert.equal(body.reply.scenario_title, "Базовый скрининг менеджера по продажам");
    assert.equal(body.reply.goal, "Договоренность о созвоне");
    assert.equal(body.reply.steps.length, 5);
    assert.equal(body.reply.is_configured, false);
    assert.equal(llmCalls.length, 1);
    assert.match(llmCalls[0], /ДАННЫЕ ВАКАНСИИ/);
    assert.match(llmCalls[0], /Менеджер по продажам/);
    assert.match(llmCalls[0], /B2B продажи/);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed setup_communication supports vacancy_id distinct from job_id", async () => {
  const llmCalls = [];
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("FROM management.playbook_definitions d") && text.includes("d.trigger_description")) {
      return [{
        playbook_key: "setup_communication",
        name: "Настроить общение с кандидатами",
        trigger_description: "communication",
        status: "available",
        sort_order: 1,
        step_count: 1
      }];
    }

    throw new Error(`Unexpected management query: ${text}`);
  };

  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    if (/FROM chatbot\.vacancies/.test(text) && /WHERE vacancy_id = \$1/.test(text)) {
      assert.deepEqual(values, ["vac-123"]);
      return [{
        vacancy_id: "vac-123",
        job_id: "job-owned",
        title: "Менеджер по продажам",
        must_haves: ["B2B продажи", "CRM"],
        nice_haves: ["Английский B2+"],
        work_conditions: {
          salary_range: { min: 180000, max: 250000 },
          location: "Удаленно"
        },
        application_steps: [
          { id: "intro", label: "Приветствие", owner: "agent" },
          { id: "screen", label: "Скрининг", owner: "agent" },
          { id: "sync", label: "Созвон", owner: "recruiter" }
        ],
        communication_plan: null,
        communication_plan_draft: null,
        communication_examples: [],
        communication_examples_plan_hash: null
      }];
    }

    if (/FROM chatbot\.jobs/.test(text) && /WHERE job_id = \$1\s+AND client_id = \$2/.test(text)) {
      if (values[0] === "vac-123") {
        throw new Error("setup_communication must not validate vacancy_id as job_id");
      }
      assert.deepEqual(values, ["job-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-owned", title: "Owned role" }];
    }

    if (/UPDATE chatbot\.vacancies/.test(text) && /communication_plan_draft/.test(text)) {
      assert.equal(values.at(-1), "vac-123");
      return [];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    managementSql,
    llmAdapter: {
      async generate(prompt) {
        llmCalls.push(prompt);
        return JSON.stringify({
          scenario_title: "Вакансия с отдельным vacancy_id",
          goal: "Договоренность о созвоне",
          steps: [
            { step: "Приветствие и первый вопрос", reminders_count: 1, comment: "Открыть диалог" },
            { step: "Уточнить релевантный опыт", reminders_count: 1, comment: "Скрининг" },
            { step: "Сверить ожидания по условиям", reminders_count: 1, comment: "Проверка условий" },
            { step: "Коротко описать роль", reminders_count: 0, comment: "Контекст вакансии" },
            { step: "Предложить слот на интервью", reminders_count: 2, comment: "Целевое действие" }
          ]
        });
      }
    }
  });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementSql,
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "настроить общение с кандидатами",
      action: "start_playbook",
      playbook_key: "setup_communication",
      vacancy_id: "vac-123"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "communication_plan");
    assert.equal(body.reply.scenario_title, "Вакансия с отдельным vacancy_id");
    assert.equal(llmCalls.length, 1);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed setup_communication tolerates legacy echoed job_id when vacancy exists", async () => {
  let callIndex = 0;
  const llmCalls = [];

  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["vac-only-001"]);
      return [{
        vacancy_id: "vac-only-001",
        job_id: null,
        title: "Менеджер по продажам",
        must_haves: ["B2B продажи"],
        communication_plan: null,
        communication_plan_draft: null,
        communication_examples: [],
        communication_examples_plan_hash: null
      }];
    }

    if (callIndex === 2) {
      assert.match(text, /FROM chatbot\.jobs/);
      assert.match(text, /WHERE job_id = \$1\s+AND client_id = \$2/);
      assert.deepEqual(values, ["vac-only-001", "tenant-alpha-001"]);
      return [];
    }

    if (callIndex === 3) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["vac-only-001"]);
      return [{
        vacancy_id: "vac-only-001",
        job_id: null,
        title: "Менеджер по продажам",
        must_haves: ["B2B продажи"],
        nice_haves: [],
        work_conditions: {},
        application_steps: [
          { id: "intro", label: "Приветствие", owner: "agent" },
          { id: "screen", label: "Скрининг", owner: "agent" },
          { id: "sync", label: "Созвон", owner: "recruiter" }
        ],
        communication_plan: null,
        communication_plan_draft: null,
        communication_examples: [],
        communication_examples_plan_hash: null
      }];
    }

    if (callIndex === 4) {
      assert.match(text, /UPDATE chatbot\.vacancies/);
      assert.match(text, /communication_plan_draft/);
      assert.equal(values.at(-1), "vac-only-001");
      return [];
    }

    throw new Error(`Unexpected query #${callIndex}: ${text}`);
  };

  const app = createHiringAgentApp({
    demoMode: false,
    llmAdapter: {
      async generate(prompt) {
        llmCalls.push(prompt);
        return JSON.stringify({
          scenario_title: "Черновик для вакансии без job_id",
          goal: "Договоренность о созвоне",
          steps: [
            { step: "Привет! Что заинтересовало в вакансии?", reminders_count: 1, comment: "Открыть диалог" },
            { step: "Уточнить опыт в продажах", reminders_count: 1, comment: "Скрининг опыта" },
            { step: "Сверить ожидания по условиям", reminders_count: 1, comment: "Проверка условий" },
            { step: "Коротко описать роль", reminders_count: 0, comment: "Контекст вакансии" },
            { step: "Предложить интервью", reminders_count: 2, comment: "Следующий шаг" }
          ]
        });
      }
    }
  });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "настроить общение с кандидатами",
      action: "start_playbook",
      playbook_key: "setup_communication",
      vacancy_id: "vac-only-001",
      job_id: "vac-only-001"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "communication_plan");
    assert.equal(body.reply.scenario_title, "Черновик для вакансии без job_id");
    assert.equal(llmCalls.length, 1);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed setup_communication rejects foreign job_id before llm call", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    callIndex += 1;
    if (callIndex === 1) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["job-foreign"]);
      return [];
    }

    if (callIndex === 2) {
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-foreign", "tenant-alpha-001"]);
      return [];
    }

    assert.match(text, /FROM chatbot\.vacancies/);
    assert.match(text, /WHERE job_id = \$1/);
    assert.deepEqual(values, ["job-foreign"]);
    return [];
  };

  const app = createHiringAgentApp({
    demoMode: false,
    llmAdapter: {
      async generate() {
        throw new Error("llm must not be called");
      }
    }
  });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "настроить общение с кандидатами",
      job_id: "job-foreign",
      vacancy_id: "job-foreign"
    }, "session=sess-alpha");
    assert.equal(status, 404);
    assert.equal(body.error, "job_not_found");
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket returns funnel chunks for authenticated session", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  const port = server.address().port;
  try {
    const sessionCookie = await login(server);

    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, { headers: { cookie: sessionCookie } });
      const received = [];
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(err); else resolve(received);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", text: "Визуализируй воронку по кандидатам" }));
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          received.push(msg);
          if (msg.type === "done") finish();
        } catch (err) {
          finish(err);
        }
      });
      ws.on("error", finish);
      setTimeout(() => finish(new Error("timeout")), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(typeof chunk.text === "string" && chunk.text.length > 0, "chunk text should be non-empty");
    assert.ok(done, "should receive done message");
    assert.ok(Array.isArray(done.actions), "done.actions should be an array");
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket renders communication_plan as markdown table and returns actions", async () => {
  const app = {
    getHealth() {
      return { status: 200, body: { status: "ok" } };
    },
    async postChatMessage() {
      return {
        status: 200,
        body: {
          reply: {
            kind: "communication_plan",
            scenario_title: "Первичный скрининг",
            goal: "Договориться о звонке",
            steps: [
              {
                step: "Приветствие и вопрос мотивации",
                reminders_count: 1,
                comment: "Открываем диалог"
              },
              {
                step: "Проверка релевантного опыта",
                reminders_count: 1,
                comment: "Короткий скрининг"
              },
              {
                step: "Приглашение на звонок",
                reminders_count: 2,
                comment: "Фиксируем слот"
              }
            ],
            examples: [],
            note: "Сценарий сформирован.",
            actions: [
              { label: "Сохранить", message: "настроить общение: сохранить настройку коммуникаций" },
              { label: "Запустить", message: "настроить общение: запустить сценарий коммуникаций" },
              { label: "Сгенерировать примеры общения", message: "настроить общение: сгенерировать примеры общения" },
              { label: "Поправить", message: "настроить общение: поправить сценарий коммуникаций" }
            ]
          }
        }
      };
    }
  };

  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => [];
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      const received = [];
      let settled = false;

      const settle = (val, isErr) => {
        if (settled) return;
        settled = true;
        ws.close();
        isErr ? reject(val) : resolve(val);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "настроить общение с кандидатами",
          vacancyId: "vac-test-1"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        received.push(msg);
        if (msg.type === "done") settle(received, false);
      });
      ws.on("error", (err) => settle(err, true));
      ws.on("close", (code) => {
        if (code === 4001) settle(new Error("Unauthorized 4001"), true);
      });
      setTimeout(() => settle(new Error("timeout"), true), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(done, "should receive done message");
    assert.match(chunk.text, /## План коммуникации/);
    assert.match(chunk.text, /\| Шаг \| Кол-во напоминалок \| Комментарий \|/);
    assert.ok(!chunk.text.includes("```json"), "should not dump raw JSON");
    assert.deepEqual(
      done.actions.map((item) => item.label),
      ["Сохранить", "Запустить", "Сгенерировать примеры общения", "Поправить"]
    );
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket parses stringified communication_plan reply and renders actions", async () => {
  const app = {
    getHealth() {
      return { status: 200, body: { status: "ok" } };
    },
    async postChatMessage() {
      return {
        status: 200,
        body: {
          reply: JSON.stringify({
            kind: "communication_plan",
            scenario_title: "Первичный контакт",
            goal: "Назначить интервью",
            steps: [
              { step: "Приветствие и первый вопрос", reminders_count: 1, comment: "Открыть диалог" },
              { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Сверить fit" },
              { step: "Сверка ожиданий по условиям", reminders_count: 1, comment: "Снять риски" },
              { step: "Приглашение на интервью", reminders_count: 2, comment: "Договориться о слоте" }
            ],
            examples: [],
            note: "Черновик сценария готов.",
            actions: [
              { label: "Сохранить", message: "настроить общение: сохранить настройку коммуникаций" },
              { label: "Запустить", message: "настроить общение: запустить сценарий коммуникаций" },
              { label: "Сгенерировать примеры общения", message: "настроить общение: сгенерировать примеры общения" },
              { label: "Поправить", message: "настроить общение: поправить сценарий коммуникаций" }
            ]
          })
        }
      };
    }
  };

  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => [];
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      const received = [];
      let settled = false;

      const settle = (val, isErr) => {
        if (settled) return;
        settled = true;
        ws.close();
        isErr ? reject(val) : resolve(val);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "настроить общение с кандидатами",
          vacancyId: "vac-test-1"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        received.push(msg);
        if (msg.type === "done") settle(received, false);
      });
      ws.on("error", (err) => settle(err, true));
      ws.on("close", (code) => {
        if (code === 4001) settle(new Error("Unauthorized 4001"), true);
      });
      setTimeout(() => settle(new Error("timeout"), true), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(done, "should receive done message");
    assert.match(chunk.text, /## План коммуникации/);
    assert.ok(!chunk.text.includes("```json"), "should not dump raw JSON");
    assert.deepEqual(
      done.actions.map((item) => item.label),
      ["Сохранить", "Запустить", "Сгенерировать примеры общения", "Поправить"]
    );
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket renders playbook buttons reply as action chips", async () => {
  const app = {
    getHealth() {
      return { status: 200, body: { status: "ok" } };
    },
    async postChatMessage() {
      return {
        status: 200,
        body: {
          reply: {
            kind: "buttons",
            message: "Вакансия готова. Что дальше?",
            options: ["Распланировать общение с кандидатами", "Сравнить с другими вакансиями", "Готово"]
          }
        }
      };
    }
  };

  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => [];
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      const received = [];
      let settled = false;

      const settle = (val, isErr) => {
        if (settled) return;
        settled = true;
        ws.close();
        isErr ? reject(val) : resolve(val);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "создать вакансию"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        received.push(msg);
        if (msg.type === "done") settle(received, false);
      });
      ws.on("error", (err) => settle(err, true));
      ws.on("close", (code) => {
        if (code === 4001) settle(new Error("Unauthorized 4001"), true);
      });
      setTimeout(() => settle(new Error("timeout"), true), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(done, "should receive done message");
    assert.match(chunk.text, /Вакансия готова\. Что дальше\?/);
    assert.deepEqual(
      done.actions.map((item) => item.label),
      ["Распланировать общение с кандидатами", "Сравнить с другими вакансиями", "Готово"]
    );
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket closes with 4001 when session cookie is missing", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  const port = server.address().port;
  try {
    const closeCode = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`);
      ws.on("close", (code) => resolve(code));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });

    assert.equal(closeCode, 4001);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed WebSocket uses tenant sql resolved at connection time", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["job-ws-owned"]);
      return [];
    }

    if (callIndex === 2) {
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-ws-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-ws-owned", title: "WS test role" }];
    }

    if (callIndex === 3) {
      assert.match(text, /FROM chatbot\.vacancies/);
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-ws-owned"]);
      return [];
    }

    if (text === "and pipeline_runs.job_id = $1") {
      assert.deepEqual(values, ["job-ws-owned"]);
      return { fragment: true };
    }

    assert.match(text, /with scoped_runs as/);
    return [{
      step_name: "Interview",
      step_id: "interview",
      step_index: 0,
      total: 5,
      in_progress: 2,
      completed: 2,
      stuck: 0,
      rejected: 1
    }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      const received = [];
      let settled = false;

      const settle = (val, isErr) => {
        if (settled) return;
        settled = true;
        ws.close();
        isErr ? reject(val) : resolve(val);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "Визуализируй воронку по кандидатам",
          vacancyId: "job-ws-owned"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        received.push(msg);
        if (msg.type === "done") settle(received, false);
      });
      ws.on("error", (err) => settle(err, true));
      ws.on("close", (code) => {
        if (code === 4001) settle(new Error("Unauthorized 4001"), true);
        else settle(received, false);
      });
      setTimeout(() => settle(new Error("timeout"), true), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(typeof chunk.text === "string" && chunk.text.length > 0, "chunk text should be non-empty");
    assert.ok(done, "should receive done message");
    assert.ok(Array.isArray(done.actions), "done.actions should be an array");
    // Verify tenant sql was actually called (callIndex > 0 means tenantSql was used, not demo data)
    assert.ok(callIndex > 0, "tenant sql should have been called at least once");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed WebSocket forwards recruiterId to app", async () => {
  const app = {
    getHealth() {
      return { status: 200, body: { status: "ok" } };
    },
    async postChatMessage(input) {
      assert.equal(input.recruiterId, "rec-alpha-001");
      assert.equal(input.tenantId, "tenant-alpha-001");
      assert.equal(input.vacancy_id, "job-ws-owned");
      assert.equal(input.job_id, null);
      return {
        status: 200,
        body: {
          reply: {
            kind: "fallback_text",
            text: "ok"
          }
        }
      };
    }
  };

  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => [];
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(err);
        else resolve();
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "ping",
          vacancyId: "job-ws-owned"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        if (msg.type === "done") finish();
      });
      ws.on("error", finish);
      setTimeout(() => finish(new Error("timeout")), 5000);
    });
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed WebSocket forwards distinct job_id for synthetic vacancy selections", async () => {
  const app = {
    getHealth() {
      return { status: 200, body: { status: "ok" } };
    },
    async postChatMessage(input) {
      assert.equal(input.recruiterId, "rec-alpha-001");
      assert.equal(input.tenantId, "tenant-alpha-001");
      assert.equal(input.vacancy_id, "job-designer");
      assert.equal(input.job_id, "job-designer");
      return {
        status: 200,
        body: {
          reply: {
            kind: "fallback_text",
            text: "ok"
          }
        }
      };
    }
  };

  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return async () => [];
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(err);
        else resolve();
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "настроить общение с кандидатами",
          vacancyId: "job-designer",
          jobId: "job-designer"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        if (msg.type === "done") finish();
      });
      ws.on("error", finish);
      setTimeout(() => finish(new Error("timeout")), 5000);
    });
  } finally {
    server.close();
  }
});
