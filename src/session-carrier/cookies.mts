import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";

const owner: unknown = createRequire(import.meta.url)("@red-cup-engineering/http-services-section/cookies");
if (typeof owner !== "object" || owner === null || !("getSignedCookie" in owner)
  || typeof owner.getSignedCookie !== "function") {
  throw new TypeError("HTTP cookies must export getSignedCookie");
}
const read = owner.getSignedCookie;
/** Transport and verification remain with HTTP's canonical cookie provider. */
export function getSignedCookie(req: IncomingMessage, name: string, secret: string): string | null {
  const value: unknown = read(req, name, secret);
  if (value !== null && typeof value !== "string") throw new TypeError("HTTP getSignedCookie must return a string or null");
  return value;
}
