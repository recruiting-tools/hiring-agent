import { randomUUID } from "node:crypto";

export class HhApiClient {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    tokenStore,
    fetchImpl = globalThis.fetch,
    apiBaseUrl = "https://api.hh.ru",
    now = () => new Date()
  }) {
    if (!clientId) throw new Error("HhApiClient requires clientId");
    if (!clientSecret) throw new Error("HhApiClient requires clientSecret");
    if (!redirectUri) throw new Error("HhApiClient requires redirectUri");
    if (!tokenStore?.getTokens || !tokenStore?.setTokens) {
      throw new Error("HhApiClient requires tokenStore with getTokens/setTokens");
    }
    if (typeof fetchImpl !== "function") throw new Error("HhApiClient requires fetchImpl");

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.now = now;
  }

  async exchangeCodeForTokens(code) {
    if (!code) throw new Error("exchangeCodeForTokens requires code");
    const payload = await this._oauthTokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri
    });
    const normalized = this._normalizeTokens(payload);
    await this.tokenStore.setTokens(normalized);
    return normalized;
  }

  async refreshAccessToken() {
    const current = await this.tokenStore.getTokens();
    if (!current?.refresh_token) {
      throw new Error("Cannot refresh HH token without refresh_token");
    }
    const payload = await this._oauthTokenRequest({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token
    });
    const normalized = this._normalizeTokens(payload, current);
    await this.tokenStore.setTokens(normalized);
    return normalized;
  }

  async getMe() {
    return this._requestJson("GET", "/me");
  }

  async listNegotiations(collection, params = {}) {
    return this._requestJson("GET", `/negotiations/${collection}`, { query: params });
  }

  async getNegotiation(hhNegotiationId) {
    return this._requestJson("GET", `/negotiations/${hhNegotiationId}`);
  }

  async getResume(resumeIdOrUrl) {
    const raw = String(resumeIdOrUrl);
    const path = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw).pathname
      : `/resumes/${raw}`;
    return this._requestJson("GET", path);
  }

  async getMessages(hhNegotiationId) {
    const payload = await this._requestJson("GET", `/negotiations/${hhNegotiationId}/messages`);
    return (payload.items ?? []).map((item) => ({
      id: item.id,
      created_at: item.created_at,
      text: item.text ?? "",
      author: item.author?.participant_type ?? item.author ?? null
    }));
  }

  async sendMessage(hhNegotiationId, text) {
    const payload = await this._requestJson("POST", `/negotiations/${hhNegotiationId}/messages`, {
      body: { message: text },
      bodyType: "form"
    });
    return { hh_message_id: payload.id ?? payload.hh_message_id ?? null };
  }

  async changeState(action, hhNegotiationId) {
    return this._requestJson("PUT", `/negotiations/${hhNegotiationId}/state`, {
      body: { collection: action }
    });
  }

  async _requestJson(method, path, { query, body, bodyType = "json", retryOn401 = true } = {}) {
    const traceId = randomUUID();
    const tokens = await this._getUsableTokens();
    const response = await this._fetchJson(method, path, {
      query,
      body,
      bodyType,
      accessToken: tokens.access_token,
      traceId,
      method,
      path
    });
    console.info("[hh-api-client] request", {
      trace_id: traceId,
      method,
      path,
      has_body: Boolean(body)
    });

    if (response.status === 401 && retryOn401) {
      const refreshed = await this.refreshAccessToken();
      const retried = await this._fetchJson(method, path, {
        query,
        body,
        bodyType,
        accessToken: refreshed.access_token,
        traceId,
        method,
        path
      });
      const payload = await this._parseOrThrow(retried);
      console.info("[hh-api-client] request_success", { trace_id: traceId, method, path });
      return payload;
    }

    const payload = await this._parseOrThrow(response);
    console.info("[hh-api-client] request_success", { trace_id: traceId, method, path });
    return payload;
  }

  async _getUsableTokens() {
    const tokens = await this.tokenStore.getTokens();
    if (!tokens?.access_token) {
      throw new Error("HH access token is not configured");
    }
    if (this._shouldRefresh(tokens)) {
      return this.refreshAccessToken();
    }
    return tokens;
  }

  _shouldRefresh(tokens) {
    if (!tokens.expires_at) return false;
    const expiresAt = new Date(tokens.expires_at);
    return expiresAt.getTime() - this.now().getTime() <= 60 * 60 * 1000;
  }

  async _oauthTokenRequest(params) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      ...params
    });
    const response = await this.fetchImpl(`${this.apiBaseUrl}/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    return this._parseOrThrow(response);
  }

  async _fetchJson(method, path, { query, body, bodyType = "json", accessToken, traceId }) {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const serializedBody = !body
      ? undefined
      : bodyType === "form"
        ? new URLSearchParams(
            Object.entries(body).flatMap(([key, value]) => (
              value === undefined || value === null ? [] : [[key, String(value)]]
            ))
          ).toString()
        : JSON.stringify(body);

    const response = await this.fetchImpl(String(url), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(serializedBody
          ? {
              "content-type": bodyType === "form"
                ? "application/x-www-form-urlencoded"
                : "application/json"
            }
          : {})
      },
      ...(serializedBody ? { body: serializedBody } : {})
    });
    if (!response.ok) {
      console.warn("[hh-api-client] request_error", {
        trace_id: traceId,
        method,
        path,
        status: response.status
      });
    }
    return response;
  }

  async _parseOrThrow(response) {
    const body = await this._readResponseBody(response);
    if (response.ok) return body;

    const error = new Error(body?.description ?? body?.error ?? `HH API request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.code = body?.error ?? null;
    throw error;
  }

  async _readResponseBody(response) {
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  _normalizeTokens(payload, previous = null) {
    const expiresIn = Number(payload.expires_in ?? 0);
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? previous?.refresh_token ?? null,
      token_type: payload.token_type ?? "bearer",
      expires_in: expiresIn,
      expires_at: new Date(this.now().getTime() + expiresIn * 1000).toISOString()
    };
  }
}
