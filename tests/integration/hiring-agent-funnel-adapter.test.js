import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { getFunnelData } from "../../services/hiring-agent/src/data/funnel-adapter.js";

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  test.skip("funnel adapter integration: DATABASE_URL not set", () => {});
} else {
  test("funnel adapter integration: aggregates seeded pipeline state from Postgres", async () => {
    const sql = postgres(DB_URL, { max: 1 });
    const suffix = randomUUID();
    const jobId = `test-fa-job-${suffix}`;
    const templateId = `test-fa-template-${suffix}`;
    const runIds = [
      `test-fa-run-1-${suffix}`,
      `test-fa-run-2-${suffix}`,
      `test-fa-run-3-${suffix}`
    ];

    try {
      await sql`
        insert into chatbot.jobs (job_id, title)
        values (${jobId}, ${'test-funnel-adapter'})
      `;

      await sql`
        insert into chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
        values (
          ${templateId},
          1,
          ${jobId},
          ${'test-funnel-adapter'},
          ${sql.json([
            { id: "screening", goal: "Screening" },
            { id: "qualification", goal: "Qualification" }
          ])}
        )
      `;

      await sql`
        insert into chatbot.pipeline_runs (pipeline_run_id, job_id, template_version, status)
        values
          (${runIds[0]}, ${jobId}, 1, 'active'),
          (${runIds[1]}, ${jobId}, 1, 'active'),
          (${runIds[2]}, ${jobId}, 1, 'rejected')
      `;

      await sql`
        insert into chatbot.pipeline_step_state (
          pipeline_run_id,
          step_id,
          step_index,
          state,
          awaiting_reply
        )
        values
          (${runIds[0]}, 'screening', 0, 'completed', false),
          (${runIds[0]}, 'qualification', 1, 'active', false),
          (${runIds[1]}, 'screening', 0, 'active', true),
          (${runIds[1]}, 'qualification', 1, 'pending', false),
          (${runIds[2]}, 'screening', 0, 'rejected', false),
          (${runIds[2]}, 'qualification', 1, 'pending', false)
      `;

      const rows = await getFunnelData(sql, jobId);
      assert.ok(rows.length > 0);

      const screening = rows.find((row) => row.step_id === "screening");
      const qualification = rows.find((row) => row.step_id === "qualification");

      assert.deepEqual(screening, {
        step_name: "Screening",
        step_id: "screening",
        step_index: 0,
        total: 3,
        in_progress: 0,
        completed: 1,
        stuck: 1,
        rejected: 1
      });

      assert.deepEqual(qualification, {
        step_name: "Qualification",
        step_id: "qualification",
        step_index: 1,
        total: 3,
        in_progress: 1,
        completed: 0,
        stuck: 0,
        rejected: 0
      });

      for (const row of rows) {
        assert.equal(typeof row.step_name, "string");
        assert.equal(typeof row.step_id, "string");
        assert.equal(typeof row.step_index, "number");
        assert.equal(typeof row.total, "number");
        assert.equal(typeof row.in_progress, "number");
        assert.equal(typeof row.completed, "number");
        assert.equal(typeof row.stuck, "number");
        assert.equal(typeof row.rejected, "number");
      }
    } finally {
      await sql`
        delete from chatbot.pipeline_step_state
        where pipeline_run_id in ${sql(runIds)}
      `;
      await sql`
        delete from chatbot.pipeline_runs
        where pipeline_run_id in ${sql(runIds)}
      `;
      await sql`
        delete from chatbot.pipeline_templates
        where template_id = ${templateId}
      `;
      await sql`
        delete from chatbot.jobs
        where job_id = ${jobId}
      `;
      await sql.end();
    }
  });
}
