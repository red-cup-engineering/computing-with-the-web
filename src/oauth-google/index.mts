// @red-cup-engineering/web-oauth-google — an OAuth 2.0 authorization server for
// @red-cup-engineering/web-server, with Google as the upstream IdP and single-allowed-email
// confinement. Pairs with @red-cup-engineering/web-mcp: the OAuthServer's validateToken
// is the McpAuth.verify a host injects into each MCP endpoint.

import process from "node:process";

import type { OAuthConfig, OAuthServer } from "./oauth.mjs";

export { OAuthServer, OAuthError } from "./oauth.mjs";
export type { OAuthConfig, OAuthClient, TokenResponse } from "./oauth.mjs";
export { oauthApp } from "./oauth-app.mjs";

/**
 * Build an OAuthConfig, reading the Google credentials from the environment
 * (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). The caller supplies the
 * resource-specific parts: the public base URL, the state directory for
 * persisted clients/tokens, and an admission policy.
 *
 * Admission resolves, in order: an explicit `admitEmail` predicate; else a
 * single `allowedEmail` (the original single-tenant confinement); else an
 * `allowedEmails` allowlist; else — when the caller passes none — any verified
 * Google account (the open multi-user policy). Either single shape may also be
 * supplied from the environment so a deployment can be confined without code.
 */
export function oauthConfigFromEnv(parts: {
  publicBaseUrl: string;
  /** Single-tenant confinement (legacy). Omit for multi-user. */
  allowedEmail?: string;
  /** Allowlist of emails admitted (multi-user, bounded). */
  allowedEmails?: readonly string[];
  /** Arbitrary admission predicate; overrides the email shapes above. */
  admitEmail?: (email: string) => boolean;
  stateDir: string;
  env?: Record<string, string | undefined>;
}): OAuthConfig {
  const env = parts.env ?? process.env;
  const envAllowlist = (env["OAUTH_ALLOWED_EMAILS"] ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
  const allowlist = [
    ...(parts.allowedEmails ?? []).map((e) => e.toLowerCase()),
    ...envAllowlist,
  ];
  const admitEmail = parts.admitEmail
    ?? (allowlist.length > 0 ? (email: string) => allowlist.includes(email.toLowerCase()) : undefined);
  const allowedEmail = parts.allowedEmail ?? env["OAUTH_ALLOWED_EMAIL"];
  return {
    googleClientId: env["GOOGLE_CLIENT_ID"] ?? "",
    googleClientSecret: env["GOOGLE_CLIENT_SECRET"] ?? "",
    publicBaseUrl: parts.publicBaseUrl.replace(/\/$/, ""),
    ...(admitEmail !== undefined ? { admitEmail } : allowedEmail !== undefined ? { allowedEmail } : {}),
    stateDir: parts.stateDir,
  };
}

/** The OAuth 2.0 Authorization Server Metadata (RFC 8414) — serve at
 *  `/.well-known/oauth-authorization-server`. */
export function authorizationServerMetadata(oauth: OAuthServer): Record<string, unknown> {
  return oauth.metadata();
}

/**
 * The OAuth 2.0 Protected Resource Metadata (RFC 9728) for one MCP resource.
 * `resourceUrl` is the absolute URL of the protected resource (e.g.
 * `https://ops.561.group/jsnode/mcp`); `authorizationServer` is the issuer
 * base URL hosting `/.well-known/oauth-authorization-server`.
 *
 * Serve at the path-aware location `/.well-known/oauth-protected-resource/<the
 * resource's path>` so a client probing the resource's metadata (per the
 * `resource_metadata` pointer in the 401 challenge) finds it regardless of
 * whether the resource lives at a path or a subdomain root.
 */
export function protectedResourceMetadata(resourceUrl: string, authorizationServer: string): Record<string, unknown> {
  return {
    resource: resourceUrl,
    authorization_servers: [authorizationServer.replace(/\/$/, "")],
  };
}
