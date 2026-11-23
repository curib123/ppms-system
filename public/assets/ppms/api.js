export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.error = data?.error || "REQUEST_FAILED";
    this.details = data?.details || {};
  }
}
export class ApiClient {
  constructor(base = "") {
    this.base = base + "/api/v1";
    this.token = null;
    this.onUnauthorized = null;
  }
  async request(path, { method = "GET", body, deviceToken, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (deviceToken) headers["X-PPMS-Device-Token"] = deviceToken;
    const response = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
      credentials: "omit",
    });
    let data;
    try {
      data = await response.json();
    } catch {
      const error = new ApiError(response.status, {
        error: "INVALID_SERVER_RESPONSE",
      });
      error.ambiguous = response.ok || response.status >= 500;
      throw error;
    }
    if (!response.ok) {
      if (response.status === 401 && this.token) this.onUnauthorized?.();
      const error = new ApiError(response.status, data);
      error.ambiguous = data?.error === "MUTATION_BUSY";
      throw error;
    }
    return data;
  }
  async login(username, password) {
    const result = await this.request("/auth/login", {
      method: "POST",
      body: { username, password },
    });
    this.token = result.token;
    return result.user;
  }
  async logout() {
    try {
      if (this.token)
        await this.request("/auth/logout", { method: "POST", body: {} });
    } finally {
      this.token = null;
    }
  }
}
