import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import {
  bootstrapRecruiterAccess,
  createRecruiterAccess,
  listRecruiters
} from "../../scripts/lib/recruiter-access.js";
import { PostgresHiringStore } from "../../services/candidate-chatbot/src/postgres-store.js";

const DB_URL = process.env.V2_DEV_NEON_URL;

if (!DB_URL) {
  console.log("Skipping recruiter access postgres tests: V2_DEV_NEON_URL not set");
  process.exit(0);
}

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-5-seed.json", import.meta.url), "utf8"));

async function seedDb() {
  const store = new PostgresHiringStore({ connectionString: DB_URL });
  await store.reset();
  await store.seed(seed);
  await store.close();
}

test("recruiter access postgres: list, create, and rotate remain tenant-safe", async () => {
  await seedDb();
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const before = await listRecruiters(client, { clientId: "client-alpha-001" });
    assert.equal(before.length, 2);
    assert.ok(before.every((row) => row.client_id === "client-alpha-001"));

    const created = await createRecruiterAccess(client, {
      recruiterId: "rec-alpha-003",
      clientId: "client-alpha-001",
      email: "new-alpha@example.test",
      token: "rec-tok-alpha-003",
      password: "ReadablePass234"
    });
    assert.equal(created.client_id, "client-alpha-001");
    assert.equal(created.email, "new-alpha@example.test");
    assert.equal(created.visible_jobs, 2);

    const rotated = await bootstrapRecruiterAccess(client, {
      lookup: { recruiterId: "rec-alpha-003" },
      clientId: "client-alpha-001",
      nextEmail: "rotated-alpha@example.test",
      password: "RotatedPass345"
    });
    assert.equal(rotated.email, "rotated-alpha@example.test");
    assert.equal(rotated.password, "RotatedPass345");

    await assert.rejects(
      bootstrapRecruiterAccess(client, {
        lookup: { recruiterId: "rec-alpha-003" },
        clientId: "client-beta-001"
      }),
      /belongs to client client-alpha-001, expected client-beta-001/
    );
  } finally {
    await client.end();
  }
});
