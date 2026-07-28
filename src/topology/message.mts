// message.mts — the content of an exchange: request and response
// messages, in RFC 9110's senses.
//
// A message is a pure value: method and target, header fields as a
// name → field-value map, and a body that is octets or text. Nothing
// here streams, ticks, or touches a socket — reading bytes off a wire
// and writing them back is transport, and transport belongs to the
// persistent process that traverses the exchange. Field names are
// normalized to lowercase on construction (the HTTP/2 canonical form,
// and what node hands a server), so productions and codecs index
// fields without case folding of their own.

export type FieldValue = string | readonly string[];

/** Header fields: lowercase field name → field value. */
export type Fields = Readonly<Record<string, FieldValue>>;

export interface RequestMessage {
  readonly kind: "web.request";
  readonly method: string;
  readonly target: URL;
  readonly headers: Fields;
  readonly body?: Uint8Array | string;
}

export interface ResponseMessage {
  readonly kind: "web.response";
  readonly status: number;
  readonly headers: Fields;
  readonly body?: Uint8Array | string;
}

const isToken = (text: string): boolean => text.length > 0 && !/\s/.test(text);

function normalizeFields(headers: Fields = {}): Fields {
  const out: Record<string, FieldValue> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(out);
}

export function requestMessage(init: {
  method: string;
  target: URL | string;
  headers?: Fields;
  body?: Uint8Array | string;
}): RequestMessage {
  if (!isToken(init.method)) {
    throw new TypeError("requestMessage: method must be a nonempty, whitespace-free token");
  }
  const target = init.target instanceof URL ? init.target : new URL(init.target);
  return Object.freeze({
    kind: "web.request" as const,
    method: init.method,
    target,
    headers: normalizeFields(init.headers),
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

export function responseMessage(status: number, init: {
  headers?: Fields;
  body?: Uint8Array | string;
} = {}): ResponseMessage {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError(`responseMessage: status must be an integer in 100..599, got ${String(status)}`);
  }
  return Object.freeze({
    kind: "web.response" as const,
    status,
    headers: normalizeFields(init.headers),
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}
