import { randomBytes } from "node:crypto";

export async function tryHandleHhHttpRequest({
  request,
  response,
  requestUrl,
  store,
  hhOAuthClient,
  hhPollRunner,
  hhImportRunner,
  hhSendRunner,
  internalApiToken,
  readJsonBody,
  writeJson,
  isAuthorizedInternalRequest,
  isValidIsoDateTime
}) {
  if (request.method === "GET" && isHhCallbackPath(requestUrl.pathname)) {
    await handleHhCallbackRequest({
      request,
      response,
      requestUrl,
      store,
      hhOAuthClient,
      writeJson
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/hh-authorize/") {
    await handleHhAuthorizeRequest({
      request,
      response,
      store,
      hhOAuthClient,
      writeJson
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/internal/hh-poll") {
    await handleInternalHhPollRequest({
      request,
      response,
      store,
      hhPollRunner,
      internalApiToken,
      writeJson,
      isAuthorizedInternalRequest
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/internal/hh-import") {
    await handleInternalHhImportRequest({
      request,
      response,
      store,
      hhImportRunner,
      internalApiToken,
      readJsonBody,
      writeJson,
      isAuthorizedInternalRequest,
      isValidIsoDateTime
    });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/internal/hh-send") {
    await handleInternalHhSendRequest({
      request,
      response,
      store,
      hhSendRunner,
      internalApiToken,
      writeJson,
      isAuthorizedInternalRequest
    });
    return true;
  }

  return false;
}

function isHhCallbackPath(pathname) {
  return pathname === "/hh-callback" || pathname === "/hh-callback/";
}

async function handleHhCallbackRequest({ requestUrl, response, store, hhOAuthClient, writeJson }) {
  if (!hhOAuthClient) {
    writeJson(response, 503, { error: "hh_oauth_not_configured" });
    return;
  }
  if (!store) {
    writeJson(response, 503, { error: "hh_state_store_not_configured" });
    return;
  }

  const state = requestUrl.searchParams.get("state");
  if (!state) {
    writeJson(response, 400, { error: "missing_state" });
    return;
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) {
    writeJson(response, 400, { error: "missing_code" });
    return;
  }

  const stateKey = stateStorageKey(state);
  const stateRow = await store.getHhOAuthTokens(stateKey);
  if (!stateRow || stateRow.token_type !== "oauth_state") {
    writeJson(response, 400, { error: "invalid_oauth_state" });
    return;
  }
  if (stateRow.metadata?.consumed_at || stateRow.token_type === "oauth_state_consumed") {
    writeJson(response, 400, { error: "oauth_state_consumed" });
    return;
  }
  if (!stateRow.expires_at || new Date(stateRow.expires_at).getTime() <= Date.now()) {
    await store.setHhOAuthTokens(stateKey, {
      ...stateRow,
      token_type: "oauth_state_expired",
      metadata: {
        ...(stateRow.metadata ?? {}),
        expired_at: new Date().toISOString()
      }
    });
    writeJson(response, 400, { error: "oauth_state_expired" });
    return;
  }

  try {
    const tokens = await hhOAuthClient.exchangeCodeForTokens(code);
    const me = await hhOAuthClient.getMe();
    await store.setHhOAuthTokens(stateKey, {
      ...stateRow,
      access_token: state,
      token_type: "oauth_state_consumed",
      metadata: {
        ...(stateRow.metadata ?? {}),
        consumed_at: new Date().toISOString()
      }
    });
    writeJson(response, 200, {
      ok: true,
      provider: "hh",
      employer_id: me.id ?? null,
      manager_id: me.manager?.id ?? null,
      expires_at: tokens.expires_at
    });
  } catch (error) {
    await store.setHhOAuthTokens(stateKey, {
      ...stateRow,
      access_token: state,
      token_type: "oauth_state_error",
      metadata: {
        ...(stateRow.metadata ?? {}),
        error_code: error?.code ?? "error",
        error_message: error?.message ?? "OAuth exchange failed",
        failed_at: new Date().toISOString()
      }
    });
    writeJson(response, error?.status === 401 ? 401 : 400, {
      error: "hh_oauth_exchange_failed",
      message: error.message
    });
  }
}

async function handleHhAuthorizeRequest({ request, response, store, hhOAuthClient, writeJson }) {
  if (!hhOAuthClient) {
    writeJson(response, 503, { error: "hh_oauth_not_configured" });
    return;
  }
  if (!store) {
    writeJson(response, 503, { error: "hh_state_store_not_configured" });
    return;
  }

  const state = randomState();
  const stateKey = stateStorageKey(state);
  const stateExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await store.setHhOAuthTokens(stateKey, {
    access_token: state,
    token_type: "oauth_state",
    expires_at: stateExpiresAt,
    metadata: {
      redirect_uri: hhOAuthClient.redirectUri,
      created_at: new Date().toISOString(),
      user_agent: request.headers["user-agent"] ?? null,
      referer: request.headers["referer"] ?? null
    }
  });
  writeJson(response, 200, {
    ok: true,
    provider: "hh",
    authorize_url: buildHhAuthorizeUrl({
      clientId: hhOAuthClient.clientId,
      redirectUri: hhOAuthClient.redirectUri,
      state
    }),
    state,
    expires_at: stateExpiresAt
  });
}

async function handleInternalHhPollRequest({
  request,
  response,
  store,
  hhPollRunner,
  internalApiToken,
  writeJson,
  isAuthorizedInternalRequest
}) {
  if (!isAuthorizedInternalRequest(request, internalApiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (!hhPollRunner) {
    writeJson(response, 503, { error: "hh_poll_not_configured" });
    return;
  }
  const hhImport = store ? await store.getFeatureFlag("hh_import") : null;
  if (hhImport && hhImport.enabled === false) {
    writeJson(response, 200, { ok: true, skipped: true, reason: "hh_import_disabled" });
    return;
  }
  const result = await hhPollRunner.pollAll();
  writeJson(response, 200, { ok: true, ...(result ?? {}) });
}

async function handleInternalHhImportRequest({
  request,
  response,
  store,
  hhImportRunner,
  internalApiToken,
  readJsonBody,
  writeJson,
  isAuthorizedInternalRequest,
  isValidIsoDateTime
}) {
  if (!isAuthorizedInternalRequest(request, internalApiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (!hhImportRunner) {
    writeJson(response, 503, { error: "hh_import_not_configured" });
    return;
  }
  const hhImport = store ? await store.getFeatureFlag("hh_import") : null;
  if (hhImport && hhImport.enabled === false) {
    writeJson(response, 200, { ok: true, skipped: true, reason: "hh_import_disabled" });
    return;
  }
  const body = await readJsonBody(request).catch(() => ({}));
  if (!isValidIsoDateTime(body.window_start)) {
    writeJson(response, 400, { error: "invalid_window_start" });
    return;
  }
  if (body.window_end != null && !isValidIsoDateTime(body.window_end)) {
    writeJson(response, 400, { error: "invalid_window_end" });
    return;
  }
  const result = await hhImportRunner.syncApplicants({
    windowStart: body.window_start,
    windowEnd: body.window_end
  });
  writeJson(response, 200, result);
}

async function handleInternalHhSendRequest({
  request,
  response,
  store,
  hhSendRunner,
  internalApiToken,
  writeJson,
  isAuthorizedInternalRequest
}) {
  const startedAt = Date.now();
  console.info(JSON.stringify({ event: "hh_send_endpoint_enter" }));
  if (!isAuthorizedInternalRequest(request, internalApiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (!hhSendRunner) {
    writeJson(response, 503, { error: "hh_send_not_configured" });
    return;
  }
  const hhSend = store ? await store.getFeatureFlag("hh_send") : null;
  console.info(JSON.stringify({
    event: "hh_send_endpoint_after_flag",
    hh_send_enabled: hhSend?.enabled ?? null,
    elapsed_ms: Date.now() - startedAt
  }));
  if (hhSend && hhSend.enabled === false) {
    writeJson(response, 200, { ok: true, skipped: true, reason: "hh_send_disabled" });
    return;
  }
  const result = await hhSendRunner.sendDue();
  console.info(JSON.stringify({
    event: "hh_send_endpoint_before_return",
    elapsed_ms: Date.now() - startedAt
  }));
  writeJson(response, 200, { ok: true, ...(result ?? {}) });
}

function randomState() {
  return randomBytes(16).toString("hex");
}

function stateStorageKey(state) {
  return `hh_state:hh:${state}`;
}

function buildHhAuthorizeUrl({ clientId, redirectUri, state }) {
  const authorizeUrl = new URL("https://hh.ru/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl.toString();
}
