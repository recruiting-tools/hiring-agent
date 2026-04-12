import { createServer } from "node:http";

export function createHttpServer(app) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/webhook/message") {
        const body = await readJsonBody(request);
        const result = await app.postWebhookMessage(body);
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && request.url === "/queue/pending") {
        const result = await app.getPendingQueue();
        writeJson(response, result.status, result.body);
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
