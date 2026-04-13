import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import {
  assertSingleRecruiter,
  bootstrapRecruiterAccess,
  buildRecruiterLookupClause,
  createRecruiterAccess,
  generatePassword,
  parseArgs
} from "../../scripts/lib/recruiter-access.js";

test("recruiter access: generatePassword returns readable password of expected length", () => {
  const password = generatePassword(20);
  assert.equal(password.length, 20);
  assert.match(password, /^[A-HJ-NP-Za-km-z2-9]+$/);
});

test("recruiter access: buildRecruiterLookupClause requires at least one identifier", () => {
  assert.throws(
    () => buildRecruiterLookupClause({ recruiterId: null, email: null, token: null }),
    /Provide at least one recruiter identifier/
  );
});

test("recruiter access: buildRecruiterLookupClause builds AND clause in stable order", () => {
  const result = buildRecruiterLookupClause({
    recruiterId: "rec-001",
    email: "rec@example.com",
    token: "tok-001"
  });
  assert.equal(result.whereSql, "r.recruiter_id = $1 AND r.email = $2 AND r.recruiter_token = $3");
  assert.deepEqual(result.values, ["rec-001", "rec@example.com", "tok-001"]);
});

test("recruiter access: assertSingleRecruiter rejects ambiguous lookup", () => {
  assert.throws(
    () => assertSingleRecruiter([{ recruiter_id: "a" }, { recruiter_id: "b" }], { email: "x" }),
    /ambiguous/
  );
});

test("recruiter access: parseArgs supports flags, equals syntax, and positionals", () => {
  const parsed = parseArgs(["set-password", "--email=test@example.com", "--client-id", "client-001", "--dry-run"]);
  assert.deepEqual(parsed, {
    _: ["set-password"],
    email: "test@example.com",
    "client-id": "client-001",
    "dry-run": true
  });
});

test("recruiter access: createRecruiterAccess inserts recruiter with hashed password", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_id = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM management.clients")) {
        return { rows: [{ client_id: "client-001", name: "Client One" }] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE email = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_token = $1")) {
        return { rows: [] };
      }
      if (text.includes("INSERT INTO chatbot.recruiters")) {
        return {
          rows: [{
            recruiter_id: "rec-001",
            client_id: "client-001",
            email: "new@example.com",
            recruiter_token: "tok-001"
          }]
        };
      }
      if (text.includes("SELECT COUNT(*)::int AS visible_jobs")) {
        return { rows: [{ visible_jobs: 4 }] };
      }
      if (text.includes("SELECT current_database() AS database_name")) {
        return { rows: [{ database_name: "neondb" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  const result = await createRecruiterAccess(client, {
    recruiterId: "rec-001",
    clientId: "client-001",
    email: "new@example.com",
    token: "tok-001",
    password: "ReadablePass234"
  });

  assert.equal(result.database_name, "neondb");
  assert.equal(result.client_name, "Client One");
  assert.equal(result.visible_jobs, 4);
  assert.equal(result.password, "ReadablePass234");

  const insertCall = calls.find((call) => String(call.sql).includes("INSERT INTO chatbot.recruiters"));
  assert.ok(insertCall, "expected insert query");
  assert.equal(insertCall.values[0], "rec-001");
  assert.equal(insertCall.values[1], "client-001");
  assert.equal(insertCall.values[2], "new@example.com");
  assert.equal(insertCall.values[3], "tok-001");
  assert.equal(await bcrypt.compare("ReadablePass234", insertCall.values[4]), true);
});

test("recruiter access: createRecruiterAccess rejects duplicate email", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_id = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM management.clients")) {
        return { rows: [{ client_id: "client-001", name: "Client One" }] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE email = $1")) {
        return { rows: [{ recruiter_id: "rec-existing" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  await assert.rejects(
    createRecruiterAccess(client, {
      recruiterId: "rec-001",
      clientId: "client-001",
      email: "used@example.com",
      token: "tok-001"
    }),
    /Email is already used by recruiter rec-existing/
  );
});

test("recruiter access: createRecruiterAccess rejects duplicate recruiter token", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_id = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM management.clients")) {
        return { rows: [{ client_id: "client-001", name: "Client One" }] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE email = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_token = $1")) {
        return { rows: [{ recruiter_id: "rec-existing" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  await assert.rejects(
    createRecruiterAccess(client, {
      recruiterId: "rec-001",
      clientId: "client-001",
      email: "new@example.com",
      token: "tok-used"
    }),
    /Recruiter token is already used by recruiter rec-existing/
  );
});

test("recruiter access: createRecruiterAccess rejects unknown client", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_id = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM management.clients")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  await assert.rejects(
    createRecruiterAccess(client, {
      recruiterId: "rec-001",
      clientId: "client-missing",
      email: "new@example.com",
      token: "tok-001"
    }),
    /Client not found: client-missing/
  );
});

test("recruiter access: bootstrapRecruiterAccess updates existing recruiter and returns generated password", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE email = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE recruiter_token = $1")) {
        return { rows: [] };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("GROUP BY")) {
        return {
          rows: [{
            database_name: "neondb",
            recruiter_id: "rec-001",
            client_id: "client-001",
            client_name: "Client One",
            email: "old@example.com",
            recruiter_token: "tok-old",
            has_password: false,
            visible_jobs: 3
          }]
        };
      }
      if (text.includes("UPDATE chatbot.recruiters")) {
        return {
          rows: [{
            recruiter_id: "rec-001",
            client_id: "client-001",
            email: "new@example.com",
            recruiter_token: "tok-new"
          }]
        };
      }
      throw new Error("Unexpected query");
    }
  };

  const result = await bootstrapRecruiterAccess(client, {
    lookup: { email: "old@example.com" },
    nextEmail: "new@example.com",
    nextToken: "tok-new",
    password: "ReadablePass234",
    clientId: "client-001"
  });

  assert.equal(result.database_name, "neondb");
  assert.equal(result.email, "new@example.com");
  assert.equal(result.recruiter_token, "tok-new");
  assert.equal(result.password, "ReadablePass234");
  assert.equal(result.visible_jobs, 3);

  const updateCall = calls.find((call) => String(call.sql).includes("UPDATE chatbot.recruiters"));
  assert.ok(updateCall, "expected update query");
  assert.equal(updateCall.values[0], "rec-001");
  assert.equal(updateCall.values[1], "new@example.com");
  assert.equal(updateCall.values[2], "tok-new");
  assert.equal(await bcrypt.compare("ReadablePass234", updateCall.values[3]), true);
  assert.equal(updateCall.values[4], "client-001");
});

test("recruiter access: bootstrapRecruiterAccess rejects client mismatch", async () => {
  const client = {
    async query() {
      return {
        rows: [{
          database_name: "neondb",
          recruiter_id: "rec-001",
          client_id: "client-actual",
          client_name: "Client Actual",
          email: "rec@example.com",
          recruiter_token: "tok-001",
          has_password: true,
          visible_jobs: 2
        }]
      };
    }
  };

  await assert.rejects(
    bootstrapRecruiterAccess(client, {
      lookup: { recruiterId: "rec-001" },
      clientId: "client-expected"
    }),
    /belongs to client client-actual, expected client-expected/
  );
});

test("recruiter access: bootstrapRecruiterAccess rejects email collision on update", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("GROUP BY")) {
        return {
          rows: [{
            database_name: "neondb",
            recruiter_id: "rec-001",
            client_id: "client-001",
            client_name: "Client One",
            email: "rec@example.com",
            recruiter_token: "tok-001",
            has_password: true,
            visible_jobs: 2
          }]
        };
      }
      if (text.includes("FROM chatbot.recruiters") && text.includes("WHERE email = $1")) {
        return { rows: [{ recruiter_id: "rec-002" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  await assert.rejects(
    bootstrapRecruiterAccess(client, {
      lookup: { recruiterId: "rec-001" },
      nextEmail: "used@example.com"
    }),
    /Email is already used by recruiter rec-002/
  );
});

test("recruiter access: bootstrapRecruiterAccess updates without tenant guard when clientId omitted", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      const text = String(sql);
      if (text.includes("WHERE email = $1")) {
        return { rows: [] };
      }
      if (text.includes("WHERE recruiter_token = $1")) {
        return { rows: [] };
      }
      if (text.includes("GROUP BY")) {
        return {
          rows: [{
            database_name: "neondb",
            recruiter_id: "rec-001",
            client_id: "client-001",
            client_name: "Client One",
            email: "rec@example.com",
            recruiter_token: "tok-001",
            has_password: true,
            visible_jobs: 2
          }]
        };
      }
      if (text.includes("UPDATE chatbot.recruiters")) {
        return {
          rows: [{
            recruiter_id: "rec-001",
            client_id: "client-001",
            email: "rec@example.com",
            recruiter_token: "tok-001"
          }]
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  const result = await bootstrapRecruiterAccess(client, {
    lookup: { recruiterId: "rec-001" },
    password: "ReadablePass234"
  });

  assert.equal(result.recruiter_id, "rec-001");
  const updateCall = calls.find((call) => String(call.sql).includes("UPDATE chatbot.recruiters"));
  assert.ok(updateCall, "expected update query");
  assert.equal(updateCall.values.length, 4);
  assert.ok(!String(updateCall.sql).includes("AND client_id = $5"));
});

test("recruiter access: bootstrapRecruiterAccess rejects token collision on update", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM chatbot.recruiters") && text.includes("GROUP BY")) {
        return {
          rows: [{
            database_name: "neondb",
            recruiter_id: "rec-001",
            client_id: "client-001",
            client_name: "Client One",
            email: "rec@example.com",
            recruiter_token: "tok-001",
            has_password: true,
            visible_jobs: 2
          }]
        };
      }
      if (text.includes("WHERE recruiter_token = $1")) {
        return { rows: [{ recruiter_id: "rec-002" }] };
      }
      if (text.includes("WHERE email = $1")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };

  await assert.rejects(
    bootstrapRecruiterAccess(client, {
      lookup: { recruiterId: "rec-001" },
      nextToken: "tok-used"
    }),
    /Recruiter token is already used by recruiter rec-002/
  );
});
