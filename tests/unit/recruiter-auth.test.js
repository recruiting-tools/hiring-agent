import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeychainServiceName,
  generatePassword,
  resolveBootstrapPassword
} from "../../scripts/lib/recruiter-auth.js";

test("generatePassword returns requested length", () => {
  const password = generatePassword(24);
  assert.equal(password.length, 24);
});

test("generatePassword rejects too-short length", () => {
  assert.throws(() => generatePassword(8), /password_length_must_be_at_least_16/);
});

test("resolveBootstrapPassword prefers explicit password", () => {
  const result = resolveBootstrapPassword({ password: "provided-secret" });
  assert.deepEqual(result, {
    password: "provided-secret",
    source: "environment"
  });
});

test("resolveBootstrapPassword uses fallback when provided", () => {
  const result = resolveBootstrapPassword({ fallbackPassword: "demo1234" });
  assert.deepEqual(result, {
    password: "demo1234",
    source: "fallback"
  });
});

test("resolveBootstrapPassword generates when missing", () => {
  const result = resolveBootstrapPassword({});
  assert.equal(result.source, "generated");
  assert.equal(result.password.length, 24);
});

test("buildKeychainServiceName is stable", () => {
  assert.equal(
    buildKeychainServiceName({
      app: "hiring-agent",
      environment: "sandbox",
      recruiterId: "recruiter-demo-001"
    }),
    "hiring-agent-sandbox-recruiter-login:recruiter-demo-001"
  );
});
