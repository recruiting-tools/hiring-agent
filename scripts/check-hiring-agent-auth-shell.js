import vm from "node:vm";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv("HIRING_AGENT_BASE_URL"));
  const email = requireEnv("HIRING_AGENT_SMOKE_EMAIL");
  const password = requireEnv("HIRING_AGENT_SMOKE_PASSWORD");

  console.log(`auth_shell_smoke: base_url=${baseUrl}`);

  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!loginResponse.ok) {
    throw new Error(`auth_shell_smoke: login failed with ${loginResponse.status}`);
  }

  const cookies = getSetCookies(loginResponse).map((value) => value.split(";", 1)[0]).filter(Boolean);
  if (cookies.length === 0) {
    throw new Error("auth_shell_smoke: login succeeded without session cookie");
  }

  const shellResponse = await fetch(`${baseUrl}/`, {
    headers: { cookie: cookies.join("; ") }
  });

  if (!shellResponse.ok) {
    throw new Error(`auth_shell_smoke: shell fetch failed with ${shellResponse.status}`);
  }

  const html = await shellResponse.text();
  if (!html.includes("connection-copy") || !html.includes("vacancy-select")) {
    throw new Error("auth_shell_smoke: authenticated shell markers missing");
  }

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).filter(Boolean);
  if (scripts.length === 0) {
    throw new Error("auth_shell_smoke: no inline scripts found");
  }

  scripts.forEach((script, index) => {
    new vm.Script(script, { filename: `hiring-agent-inline-script-${index + 1}.js` });
  });

  console.log(`auth_shell_smoke: inline_scripts=${scripts.length}`);
  console.log("auth_shell_smoke: ok");
}

await main();
