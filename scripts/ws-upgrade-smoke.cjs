#!/usr/bin/env node

const https = require("node:https");
const http = require("node:http");

const target = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 5000);

if (!target) {
  console.error("usage: node scripts/ws-upgrade-smoke.cjs <ws-url> [timeout-ms]");
  process.exit(2);
}

let url;
try {
  url = new URL(target);
} catch (error) {
  console.error(`invalid url: ${error.message}`);
  process.exit(2);
}

const isSecure = url.protocol === "wss:";
if (!isSecure && url.protocol !== "ws:") {
  console.error(`unsupported protocol: ${url.protocol}`);
  process.exit(2);
}

const requestImpl = isSecure ? https.request : http.request;
const key = "dGhlIHNhbXBsZSBub25jZQ==";
const options = {
  protocol: isSecure ? "https:" : "http:",
  hostname: url.hostname,
  port: url.port || (isSecure ? 443 : 80),
  path: `${url.pathname || "/"}${url.search || ""}`,
  method: "GET",
  headers: {
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": key,
    Host: url.host
  }
};

const request = requestImpl(options);
const timeout = setTimeout(() => {
  request.destroy(new Error(`timeout waiting for websocket upgrade after ${timeoutMs}ms`));
}, timeoutMs);

request.on("upgrade", (response, socket) => {
  clearTimeout(timeout);
  console.log(`websocket upgrade ok: status=${response.statusCode} url=${target}`);
  socket.destroy();
  process.exit(0);
});

request.on("response", (response) => {
  clearTimeout(timeout);
  console.error(`unexpected http response: status=${response.statusCode} url=${target}`);
  response.resume();
  process.exit(1);
});

request.on("error", (error) => {
  clearTimeout(timeout);
  console.error(`websocket upgrade failed: ${error.message}`);
  process.exit(1);
});

request.end();
