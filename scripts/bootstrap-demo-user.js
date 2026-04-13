#!/usr/bin/env node

process.env.RECRUITER_ID ??= process.env.DEMO_RECRUITER_ID ?? process.env.SANDBOX_DEMO_RECRUITER_ID ?? "recruiter-demo-001";
process.env.CLIENT_ID ??= process.env.DEMO_CLIENT_ID ?? process.env.SANDBOX_DEMO_CLIENT_ID ?? "";
process.env.RECRUITER_EMAIL ??= process.env.DEMO_EMAIL ?? process.env.SANDBOX_DEMO_EMAIL ?? "demo@hiring-agent.app";
process.env.RECRUITER_TOKEN ??= process.env.DEMO_RECRUITER_TOKEN ?? process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
process.env.RECRUITER_PASSWORD ??= process.env.DEMO_PASSWORD ?? process.env.SANDBOX_DEMO_PASSWORD ?? "";
process.env.BOOTSTRAP_ENV ??= process.env.SANDBOX_DATABASE_URL ? "sandbox" : "prod";

await import("./bootstrap-recruiter-login.js");
