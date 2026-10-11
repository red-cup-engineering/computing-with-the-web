// oauthApp — the HTTP transport for an OAuthServer.
//
// Lifted from sites/research.561.group/src/index.ts. The five resources map
// 1:1 onto OAuthServer methods: dynamic client registration, the authorization
// redirect to Google, the Google callback, the token endpoint (code exchange +
// refresh rotation), and revocation. Body reading uses @red-cup-engineering/web-server's
// helpers; OAuthError instances are rendered as RFC 6749 error responses.

import { jsonRepr, readFormBody, readJsonBody, type App, type Context, type Repr } from "@red-cup-engineering/computing-with-http/app";

import { OAuthError, OAuthServer } from "./oauth.mjs";

function oauthError(code: string, description: string, status = 400): Repr {
  const body = description ? { error: code, error_description: description } : { error: code };
  return jsonRepr(body, { status });
}

function statusForError(err: OAuthError): number {
  return err.code === "invalid_client" ? 401 : 400;
}

/** The `/oauth/*` resources backed by `oauth`: register, authorize,
 *  google/callback, token, revoke. */
export function oauthApp(oauth: OAuthServer): App {
  return {
    resources: [
      {
        id: "oauth.register",
        match: "/oauth/register",
        methods: ["POST"],
        handler: async (ctx: Context) => {
          let body: Record<string, unknown> | null;
          try {
            body = await readJsonBody<Record<string, unknown> | null>(ctx.req, { empty: null });
          } catch {
            body = null;
          }
          if (!body) return oauthError("invalid_request", "missing or invalid JSON body");
          try {
            const client = oauth.registerClient(body);
            return jsonRepr(client, { status: 201, cacheControl: { noStore: true } });
          } catch (err) {
            const e = err instanceof OAuthError ? err : new OAuthError("server_error", String(err));
            return oauthError(e.code, e.description, statusForError(e));
          }
        },
      },
      {
        id: "oauth.authorize",
        match: "/oauth/authorize",
        methods: ["GET"],
        handler: (ctx: Context) => {
          const p = ctx.url.searchParams;
          const clientId = p.get("client_id") ?? "";
          const redirectUri = p.get("redirect_uri") ?? "";
          const codeChallenge = p.get("code_challenge") ?? "";
          const codeChallengeMethod = p.get("code_challenge_method") ?? "S256";
          const state = p.get("state") ?? "";
          const responseType = p.get("response_type") ?? "code";
          if (responseType !== "code") return oauthError("unsupported_response_type", "only code is supported");
          if (!codeChallenge) return oauthError("invalid_request", "code_challenge is required");
          try {
            const googleUrl = oauth.startAuthorization({
              client_id: clientId,
              redirect_uri: redirectUri,
              code_challenge: codeChallenge,
              code_challenge_method: codeChallengeMethod,
              state,
            });
            return { status: 302, headers: { location: googleUrl } };
          } catch (err) {
            const e = err instanceof OAuthError ? err : new OAuthError("server_error", String(err));
            return oauthError(e.code, e.description, statusForError(e));
          }
        },
      },
      {
        id: "oauth.google-callback",
        match: "/oauth/google/callback",
        methods: ["GET"],
        handler: async (ctx: Context) => {
          const p = ctx.url.searchParams;
          const error = p.get("error");
          if (error) return oauthError(error, p.get("error_description") ?? "");
          const state = p.get("state") ?? "";
          const code = p.get("code") ?? "";
          if (!state || !code) return oauthError("invalid_request", "missing state or code");
          try {
            const redirect = await oauth.completeAuthorization(state, code);
            return { status: 302, headers: { location: redirect } };
          } catch (err) {
            const e = err instanceof OAuthError ? err : new OAuthError("server_error", String(err));
            return oauthError(e.code, e.description, 400);
          }
        },
      },
      {
        id: "oauth.token",
        match: "/oauth/token",
        methods: ["POST"],
        handler: async (ctx: Context) => {
          let form: URLSearchParams | null;
          try {
            form = await readFormBody(ctx.req);
          } catch {
            form = null;
          }
          if (!form) return oauthError("invalid_request", "missing or invalid form body");
          const grantType = form.get("grant_type");
          const clientId = form.get("client_id") ?? "";
          try {
            let resp;
            if (grantType === "authorization_code") {
              resp = oauth.exchangeCode({
                client_id: clientId,
                code: form.get("code") ?? "",
                code_verifier: form.get("code_verifier") ?? "",
                redirect_uri: form.get("redirect_uri") ?? "",
              });
            } else if (grantType === "refresh_token") {
              resp = oauth.rotateRefreshToken({
                client_id: clientId,
                refresh_token: form.get("refresh_token") ?? "",
              });
            } else {
              return oauthError("unsupported_grant_type", `unsupported grant_type: ${grantType ?? "(none)"}`);
            }
            return jsonRepr(resp, { status: 200, cacheControl: { noStore: true } });
          } catch (err) {
            const e = err instanceof OAuthError ? err : new OAuthError("server_error", String(err));
            return oauthError(e.code, e.description, statusForError(e));
          }
        },
      },
      {
        id: "oauth.revoke",
        match: "/oauth/revoke",
        methods: ["POST"],
        handler: async (ctx: Context) => {
          let form: URLSearchParams | null;
          try {
            form = await readFormBody(ctx.req);
          } catch {
            form = null;
          }
          const token = form?.get("token");
          if (token) oauth.revoke(token);
          return jsonRepr({ revoked: true }, { status: 200, cacheControl: { noStore: true } });
        },
      },
    ],
  };
}
