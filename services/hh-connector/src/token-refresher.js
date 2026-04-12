export class TokenRefresher {
  constructor({
    store,
    hhApiClient,
    provider = "hh",
    now = () => new Date(),
    refreshBufferMs = 60 * 60 * 1000
  }) {
    this.store = store;
    this.hhApiClient = hhApiClient;
    this.provider = provider;
    this.now = now;
    this.refreshBufferMs = refreshBufferMs;
  }

  async refreshIfNeeded() {
    const tokens = await this.store.getHhOAuthTokens(this.provider);
    if (!tokens?.refresh_token) {
      return { refreshed: false, reason: "no_tokens" };
    }

    if (!this._shouldRefresh(tokens)) {
      return { refreshed: false, reason: "not_due" };
    }

    try {
      const refreshed = await this.hhApiClient.refreshAccessToken();
      return {
        refreshed: true,
        provider: this.provider,
        expires_at: refreshed.expires_at ?? null
      };
    } catch (error) {
      await this.store.setFeatureFlag("hh_send", false);
      await this.store.setFeatureFlag("hh_import", false);
      return {
        refreshed: false,
        disabled: true,
        provider: this.provider,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  _shouldRefresh(tokens) {
    if (!tokens.expires_at) return true;
    const expiresAt = new Date(tokens.expires_at).getTime();
    return expiresAt - this.now().getTime() <= this.refreshBufferMs;
  }
}
