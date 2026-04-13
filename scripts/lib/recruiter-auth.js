import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const DEFAULT_PASSWORD_LENGTH = 24;

export function generatePassword(length = DEFAULT_PASSWORD_LENGTH) {
  if (!Number.isInteger(length) || length < 16) {
    throw new Error("password_length_must_be_at_least_16");
  }

  let password = "";
  while (password.length < length) {
    password += randomBytes(length).toString("base64url");
  }
  return password.slice(0, length);
}

export function resolveBootstrapPassword({
  password,
  fallbackPassword = null,
  generate = true,
  passwordLength = DEFAULT_PASSWORD_LENGTH
} = {}) {
  if (password) {
    return { password, source: "environment" };
  }
  if (fallbackPassword) {
    return { password: fallbackPassword, source: "fallback" };
  }
  if (!generate) {
    throw new Error("password_required");
  }
  return {
    password: generatePassword(passwordLength),
    source: "generated"
  };
}

export function buildKeychainServiceName({ app = "hiring-agent", environment = "default", recruiterId }) {
  if (!recruiterId) {
    throw new Error("recruiterId_required");
  }
  return `${app}-${environment}-recruiter-login:${recruiterId}`;
}

export function storePasswordInKeychain({
  password,
  account,
  serviceName
}) {
  if (process.platform !== "darwin") {
    return { stored: false, reason: "unsupported_platform" };
  }
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-a",
    account,
    "-s",
    serviceName,
    "-w",
    password
  ], { stdio: "ignore" });
  return { stored: true, serviceName, account };
}

export function printCredentialSummary({
  label = "Recruiter login",
  loginUrl = null,
  email,
  recruiterToken,
  password,
  passwordSource,
  keychain = null
}) {
  console.log(`${label}:`);
  if (loginUrl) {
    console.log(`  login: ${loginUrl}`);
  }
  console.log(`  email: ${email}`);
  console.log(`  recruiter token: ${recruiterToken}`);
  console.log(`  password source: ${passwordSource}`);
  console.log(`  password: ${password}`);
  if (keychain?.stored) {
    console.log(`  keychain service: ${keychain.serviceName}`);
    console.log(`  keychain account: ${keychain.account}`);
  }
}
