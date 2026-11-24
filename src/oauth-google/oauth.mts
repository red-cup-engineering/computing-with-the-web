// OAuthServer — a small OAuth 2.0 authorization server with Google as the
// upstream identity provider and single-allowed-email confinement.
//
// Lifted verbatim from sites/research.561.group/src/oauth.ts so more than one
// service can sit behind the same login. It is provider-agnostic of what it
// protects: it issues and validates bearer tokens, nothing more. The transport
// (the `/oauth/*` routes) lives in ./oauth-app.mts.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class OAuthError extends Error {
  readonly code: string;
  readonly description: string;
  constructor(code: string, description = "") {
    super(`${code}: ${description}`);
    this.code = code;
    this.description = description;
  }
}

export type OAuthClient = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name: string | undefined;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
};

type PendingAuth = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | undefined;
  expires_at: number;
};

type AuthCode = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  email: string;
  expires_at: number;
};

type TokenRecord = {
  client_id: string;
  email: string;
  expires_at: number;
};

export type OAuthConfig = {
  googleClientId: string;
  googleClientSecret: string;
  publicBaseUrl: string;
  /**
   * Single-tenant confinement: the one Google account this server issues tokens
   * for. Retained for the original single-operator deployments (research, ops,
   * aagaard). Omit it for a multi-user server and govern admission with
   * `admitEmail` instead.
   */
  allowedEmail?: string;
  /**
   * Admission predicate over the verified Google email. When present it OVERRIDES
   * `allowedEmail`, so a server can admit a set of users (an allowlist) or any
   * verified account (`() => true`). When neither is given, every verified Google
   * account is admitted — the open multi-user policy.
   */
  admitEmail?: (email: string) => boolean;
  stateDir: string;
};

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const hash = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  return hash === challenge;
}

/** The identity claims this server cares about from a Google id_token. */
type Identity = { email: string; emailVerified: boolean };

function extractIdentity(idToken: string): Identity | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString("utf-8")) as Record<string, unknown>;
    if (typeof payload["email"] !== "string") return null;
    // Google sends email_verified as a boolean or the string "true"; treat a
    // missing claim as verified (Google only omits it for legacy tokens).
    const raw = payload["email_verified"];
    const emailVerified = raw === undefined || raw === true || raw === "true";
    return { email: payload["email"], emailVerified };
  } catch {
    return null;
  }
}

type PersistedTokens = {
  tokens: [string, TokenRecord][];
  refreshes: [string, TokenRecord][];
};

export class OAuthServer {
  private config: OAuthConfig;
  private clients = new Map<string, OAuthClient>();
  private pending = new Map<string, PendingAuth>();
  private codes = new Map<string, AuthCode>();
  private tokens = new Map<string, TokenRecord>();
  private refreshes = new Map<string, TokenRecord>();
  private clientsFile: string;
  private tokensFile: string;
  /** Resolved admission predicate over the verified email (see OAuthConfig). */
  private admit: (email: string) => boolean;

  constructor(config: OAuthConfig) {
    this.config = config;
    this.clientsFile = path.join(config.stateDir, "clients.json");
    this.tokensFile = path.join(config.stateDir, "tokens.json");
    const allowedEmail = config.allowedEmail;
    this.admit = config.admitEmail
      ? config.admitEmail
      : allowedEmail !== undefined
        ? (email) => email.toLowerCase() === allowedEmail.toLowerCase()
        : () => true;
    void this.loadClients();
    void this.loadTokens();
  }

  private async loadClients(): Promise<void> {
    try {
      const raw = await fs.readFile(this.clientsFile, "utf-8");
      for (const c of JSON.parse(raw) as OAuthClient[]) this.clients.set(c.client_id, c);
    } catch {}
  }

  private saveClients(): void {
    void fs.mkdir(path.dirname(this.clientsFile), { recursive: true })
      .then(() => fs.writeFile(this.clientsFile, JSON.stringify([...this.clients.values()], null, 2)));
  }

  private async loadTokens(): Promise<void> {
    try {
      const raw = await fs.readFile(this.tokensFile, "utf-8");
      const now = Date.now();
      const data = JSON.parse(raw) as PersistedTokens;
      for (const [k, v] of data.tokens) if (v.expires_at > now) this.tokens.set(k, v);
      for (const [k, v] of data.refreshes) if (v.expires_at > now) this.refreshes.set(k, v);
    } catch {}
  }

  private saveTokens(): void {
    const data: PersistedTokens = {
      tokens: [...this.tokens.entries()],
      refreshes: [...this.refreshes.entries()],
    };
    void fs.mkdir(path.dirname(this.tokensFile), { recursive: true })
      .then(() => fs.writeFile(this.tokensFile, JSON.stringify(data)));
  }

  metadata(): Record<string, unknown> {
    const base = this.config.publicBaseUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      revocation_endpoint: `${base}/oauth/revoke`,
      registration_endpoint: `${base}/oauth/register`,
      scopes_supported: ["openid"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    };
  }

  registerClient(body: Record<string, unknown>): OAuthClient & { client_id_issued_at: number; client_secret_expires_at: number } {
    const clientId = `client_${randomToken(12)}`;
    const now = Math.floor(Date.now() / 1000);
    const client: OAuthClient = {
      client_id: clientId,
      client_secret: randomToken(24),
      redirect_uris: Array.isArray(body["redirect_uris"])
        ? (body["redirect_uris"] as unknown[]).map((u) => String(u))
        : [],
      client_name: typeof body["client_name"] === "string" ? body["client_name"] : undefined,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    this.clients.set(clientId, client);
    this.saveClients();
    return { ...client, client_id_issued_at: now, client_secret_expires_at: 0 };
  }

  startAuthorization(params: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
  }): string {
    if (!this.clients.has(params.client_id)) {
      throw new OAuthError("invalid_client", "unknown client_id");
    }
    const client = this.clients.get(params.client_id)!;
    if (!client.redirect_uris.includes(params.redirect_uri)) {
      throw new OAuthError("invalid_request", "redirect_uri not registered");
    }
    if (params.code_challenge_method !== "S256") {
      throw new OAuthError("invalid_request", "only S256 PKCE is supported");
    }

    const googleState = randomToken(24);
    this.pending.set(googleState, {
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      state: params.state,
      expires_at: Date.now() + 600_000,
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.config.googleClientId);
    url.searchParams.set("redirect_uri", `${this.config.publicBaseUrl}/oauth/google/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", googleState);
    url.searchParams.set("access_type", "online");
    return url.toString();
  }

  async completeAuthorization(googleState: string, googleCode: string): Promise<string> {
    const pending = this.pending.get(googleState);
    if (!pending || pending.expires_at < Date.now()) {
      throw new OAuthError("invalid_request", "invalid or expired state");
    }
    this.pending.delete(googleState);

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: googleCode,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: `${this.config.publicBaseUrl}/oauth/google/callback`,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!tokenResp.ok) throw new OAuthError("server_error", "Google token exchange failed");

    const data = await tokenResp.json() as { id_token?: string };
    const identity = data.id_token ? extractIdentity(data.id_token) : null;
    if (!identity) throw new OAuthError("server_error", "no email in Google response");
    if (!identity.emailVerified) throw new OAuthError("access_denied", "email not verified");
    if (!this.admit(identity.email)) throw new OAuthError("access_denied", "account not authorized");
    const email = identity.email;

    const code = randomToken(24);
    this.codes.set(code, {
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      email,
      expires_at: Date.now() + 300_000,
    });

    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set("code", code);
    if (pending.state) redirect.searchParams.set("state", pending.state);
    return redirect.toString();
  }

  exchangeCode(params: {
    client_id: string;
    code: string;
    code_verifier: string;
    redirect_uri: string;
  }): TokenResponse {
    const record = this.codes.get(params.code);
    if (!record || record.expires_at < Date.now()) {
      throw new OAuthError("invalid_grant", "code invalid or expired");
    }
    if (record.client_id !== params.client_id) throw new OAuthError("invalid_grant", "client_id mismatch");
    if (record.redirect_uri !== params.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkce(params.code_verifier, record.code_challenge)) {
      throw new OAuthError("invalid_grant", "PKCE verification failed");
    }
    this.codes.delete(params.code);
    return this.mintTokens(record.client_id, record.email);
  }

  rotateRefreshToken(params: { client_id: string; refresh_token: string }): TokenResponse {
    const record = this.refreshes.get(params.refresh_token);
    if (!record || record.expires_at < Date.now()) {
      throw new OAuthError("invalid_grant", "refresh token invalid or expired");
    }
    if (record.client_id !== params.client_id) throw new OAuthError("invalid_grant", "client_id mismatch");
    this.refreshes.delete(params.refresh_token);
    return this.mintTokens(record.client_id, record.email);
  }

  private mintTokens(clientId: string, email: string): TokenResponse {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const now = Date.now();
    this.tokens.set(accessToken, { client_id: clientId, email, expires_at: now + 3_600_000 });
    this.refreshes.set(refreshToken, { client_id: clientId, email, expires_at: now + 2_592_000_000 });
    this.saveTokens();
    return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 3600 };
  }

  validateToken(token: string): { client_id: string; email: string } | null {
    const record = this.tokens.get(token);
    if (!record || record.expires_at < Date.now()) return null;
    return { client_id: record.client_id, email: record.email };
  }

  revoke(token: string): void {
    this.tokens.delete(token);
    this.refreshes.delete(token);
    this.saveTokens();
  }
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};
