#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const baseUrl = stripTrailingSlash(args.baseUrl ?? "https://hiring-chat.recruiter-assistant.com");
const expectedMode = args.expectedMode ?? "management-auth";
const expectedEnv = args.expectedEnv ?? "prod";
const expectedPort = Number(args.expectedPort ?? 3101);
const timeoutMs = Number(args.timeoutMs ?? 15_000);
const requireAuthWs = Boolean(args.requireAuthWs);

const checks = [];
const warnings = [];

try {
  const health = await withSingleRetry(() => fetchJson(`${baseUrl}/health`, timeoutMs));
  const ok =
    health.statusCode === 200
    && health.json?.status === "ok"
    && health.json?.mode === expectedMode
    && String(health.json?.app_env ?? "") === String(expectedEnv)
    && Number(health.json?.port) === expectedPort;

  checks.push({
    name: "public_health",
    ok,
    detail: ok
      ? `ok mode=${health.json.mode} env=${health.json.app_env} port=${health.json.port} sha=${health.json.deploy_sha ?? "unknown"}`
      : `unexpected /health payload: http=${health.statusCode} body=${safeJsonStringify(health.json ?? health.text)}`,
    data: health.json ?? null
  });
} catch (error) {
  checks.push({
    name: "public_health",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
    data: null
  });
}

try {
  const login = await fetchText(`${baseUrl}/login`, timeoutMs);
  const ok = login.statusCode === 200 && /<html/i.test(login.text);
  checks.push({
    name: "public_login",
    ok,
    detail: ok
      ? "login page returns HTML 200"
      : `unexpected /login response: http=${login.statusCode} sample=${JSON.stringify(login.text.slice(0, 120))}`,
    data: null
  });
} catch (error) {
  checks.push({
    name: "public_login",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
    data: null
  });
}

let sessionCookie = null;
const monitorEmail = process.env.MONITOR_EMAIL?.trim();
const monitorPassword = process.env.MONITOR_PASSWORD;

if (monitorEmail && monitorPassword) {
  try {
    sessionCookie = await loginAndGetSessionCookie({ baseUrl, email: monitorEmail, password: monitorPassword, timeoutMs });
    checks.push({
      name: "auth_login",
      ok: true,
      detail: `session created for ${monitorEmail}`,
      data: null
    });
  } catch (error) {
    checks.push({
      name: "auth_login",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      data: null
    });
  }
} else if (requireAuthWs) {
  checks.push({
    name: "auth_login",
    ok: false,
    detail: "--require-auth-ws set, but MONITOR_EMAIL/MONITOR_PASSWORD are missing",
    data: null
  });
}

const wsProbe = await withSingleRetry(() => probeWebsocket({
  wsUrl: `${toWsBase(baseUrl)}/ws`,
  timeoutMs,
  cookie: sessionCookie
}));

checks.push({
  name: sessionCookie ? "ws_probe_authenticated" : "ws_probe_anonymous",
  ok: wsProbe.ok,
  detail: wsProbe.detail,
  data: wsProbe.data ?? null
});

if (args.sshTarget) {
  try {
    const vm = await probeVm({
      sshTarget: args.sshTarget,
      expectedPort,
      timeoutMs
    });

    const vmOk =
      vm.health?.status === "ok"
      && Number(vm.health?.port) === expectedPort
      && vm.pm2?.pm2_status === "online"
      && Number(vm.pm2?.port) === expectedPort;

    checks.push({
      name: "vm_runtime",
      ok: vmOk,
      detail: vmOk
        ? `pm2=${vm.pm2.pm2_status} pid=${vm.pm2.pid} restarts=${vm.pm2.restarts} local_health=ok`
        : `unexpected VM state: health=${safeJsonStringify(vm.health)} pm2=${safeJsonStringify(vm.pm2)}`,
      data: vm
    });

    if ((vm.nginxUpstreamRefusedCount ?? 0) > 0) {
      warnings.push(
        `nginx error.log contains ${vm.nginxUpstreamRefusedCount} upstream refused entries in last 300 lines`
      );
    }

    if (Number(vm.pm2?.restarts ?? 0) > 0) {
      warnings.push(`pm2 restart counter is ${vm.pm2.restarts} (process had restarts since start)`);
    }
  } catch (error) {
    checks.push({
      name: "vm_runtime",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      data: null
    });
  }
}

const failed = checks.filter((check) => !check.ok);
const summary = {
  timestamp: new Date().toISOString(),
  base_url: baseUrl,
  checks,
  warnings,
  ok: failed.length === 0
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`hiring-agent monitor ${summary.timestamp}\n`);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? "[OK]" : "[FAIL]"} ${check.name}: ${check.detail}\n`);
  }
  for (const warning of warnings) {
    process.stdout.write(`[WARN] ${warning}\n`);
  }
}

if (failed.length > 0) {
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);

    if (["json", "help", "require-auth-ws"].includes(key)) {
      result[toCamelCase(key)] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      result[toCamelCase(key)] = "";
      continue;
    }
    result[toCamelCase(key)] = next;
    i += 1;
  }
  return result;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/monitor-hiring-agent.js [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --base-url <url>          Public URL (default: https://hiring-chat.recruiter-assistant.com)\n`);
  process.stdout.write(`  --expected-mode <mode>    Expected /health mode (default: management-auth)\n`);
  process.stdout.write(`  --expected-env <env>      Expected /health app_env (default: prod)\n`);
  process.stdout.write(`  --expected-port <port>    Expected service port from /health (default: 3101)\n`);
  process.stdout.write(`  --timeout-ms <ms>         Network/SSH timeout in ms (default: 15000)\n`);
  process.stdout.write(`  --ssh-target <user@host>  Optional VM probe via SSH (pm2 + local health + nginx error count)\n`);
  process.stdout.write(`  --require-auth-ws         Fail when MONITOR_EMAIL / MONITOR_PASSWORD are missing\n`);
  process.stdout.write(`  --json                    JSON output\n`);
  process.stdout.write(`  --help                    Show help\n\n`);
  process.stdout.write(`Optional env vars:\n`);
  process.stdout.write(`  MONITOR_EMAIL / MONITOR_PASSWORD  Use real login before ws probe (authenticated websocket check)\n`);
}

function stripTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function toWsBase(url) {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  throw new Error(`Unsupported URL protocol: ${url}`);
}

async function fetchJson(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      statusCode: response.status,
      text,
      json
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const text = await response.text();
    return {
      statusCode: response.status,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loginAndGetSessionCookie({ baseUrl, email, password, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
      redirect: "manual"
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`auth/login failed: http=${response.status} body=${bodyText.slice(0, 180)}`);
    }

    const rawSetCookie = getSetCookie(response.headers);
    if (!rawSetCookie) {
      throw new Error("auth/login succeeded but Set-Cookie header is missing");
    }

    const match = /^([^;]+)/.exec(rawSetCookie);
    if (!match) {
      throw new Error("auth/login returned malformed Set-Cookie header");
    }

    return match[1];
  } finally {
    clearTimeout(timer);
  }
}

function getSetCookie(headers) {
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    if (values.length > 0) return values[0];
  }

  const single = headers.get("set-cookie");
  if (single) return single;
  return null;
}

async function probeWebsocket({ wsUrl, timeoutMs, cookie = null }) {
  return await new Promise((resolve) => {
    let done = false;
    let opened = false;

    const headers = {};
    if (cookie) headers.Cookie = cookie;

    const ws = new WebSocket(wsUrl, {
      headers,
      handshakeTimeout: timeoutMs
    });

    const timeout = setTimeout(() => {
      finish({ ok: false, detail: `ws timeout after ${timeoutMs}ms`, data: { wsUrl } });
    }, timeoutMs + 300);

    ws.on("open", () => {
      opened = true;

      if (cookie) {
        setTimeout(() => {
          finish({ ok: true, detail: "authenticated websocket opened", data: { wsUrl } });
        }, 200);
        return;
      }

      finish({
        ok: true,
        detail: "anonymous websocket upgrade ok (open)",
        data: { wsUrl }
      });
    });

    ws.on("close", (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer)
        ? reasonBuffer.toString("utf8")
        : String(reasonBuffer ?? "");

      if (done) return;

      if (!cookie) {
        if (opened) {
          finish({
            ok: true,
            detail: `anonymous websocket upgrade ok (close_code=${code})`,
            data: { wsUrl, closeCode: code, closeReason: reason }
          });
          return;
        }

        if (code === 4001) {
          finish({
            ok: true,
            detail: "anonymous websocket reached app auth layer (close_code=4001 unauthorized)",
            data: { wsUrl, closeCode: code, closeReason: reason }
          });
          return;
        }

        finish({
          ok: false,
          detail: `anonymous websocket closed before upgrade (close_code=${code} reason=${reason || "n/a"})`,
          data: { wsUrl, closeCode: code, closeReason: reason }
        });
        return;
      }

      finish({
        ok: code !== 4001,
        detail: code !== 4001
          ? `authenticated websocket opened and closed (code=${code})`
          : `authenticated websocket unauthorized (close_code=${code})`,
        data: { wsUrl, closeCode: code, closeReason: reason }
      });
    });

    ws.on("error", (error) => {
      if (done) return;
      finish({
        ok: false,
        detail: `ws error: ${error?.message ?? String(error)}`,
        data: { wsUrl }
      });
    });

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }
      resolve(result);
    }
  });
}

async function probeVm({ sshTarget, expectedPort, timeoutMs }) {
  const healthRaw = await sshExec({
    sshTarget,
    timeoutMs,
    command: `curl -sf --max-time 8 http://127.0.0.1:${expectedPort}/health`
  });
  const health = parseJsonSafe(healthRaw.trim());

  const pm2Raw = await sshExec({
    sshTarget,
    timeoutMs,
    command: "pm2 jlist"
  });
  const pm2List = parseJsonSafe(pm2Raw);
  const pm2Record = Array.isArray(pm2List)
    ? pm2List.find((item) => item?.name === "hiring-agent")
    : null;

  const pm2 = pm2Record
    ? {
      pid: pm2Record.pid ?? null,
      pm2_status: pm2Record.pm2_env?.status ?? null,
      restarts: pm2Record.pm2_env?.restart_time ?? null,
      app_env: pm2Record.pm2_env?.APP_ENV ?? pm2Record.pm2_env?.env?.APP_ENV ?? "",
      port: pm2Record.pm2_env?.PORT ?? pm2Record.pm2_env?.env?.PORT ?? "",
      deploy_sha: pm2Record.pm2_env?.DEPLOY_SHA ?? pm2Record.pm2_env?.env?.DEPLOY_SHA ?? ""
    }
    : null;

  const nginxErrorTail = await sshExec({
    sshTarget,
    timeoutMs,
    command: "tail -n 300 /var/log/nginx/error.log 2>/dev/null || true"
  });
  const nginxUpstreamRefusedCount =
    (nginxErrorTail.match(/connect\(\) failed \(111: Connection refused\)/g) ?? []).length;

  return {
    health,
    pm2,
    nginxUpstreamRefusedCount
  };
}

async function sshExec({ sshTarget, timeoutMs, command }) {
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${Math.max(3, Math.floor(timeoutMs / 1000))}`,
    sshTarget,
    command
  ];
  const { stdout } = await execFileAsync("ssh", sshArgs, {
    timeout: timeoutMs + 2_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return stdout;
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function withSingleRetry(run) {
  try {
    return await run();
  } catch {
    return await run();
  }
}
