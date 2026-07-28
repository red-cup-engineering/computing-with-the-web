// resource.mts — resources: what a server-role node answers.
//
// A resource (RFC 9110's sense) is addressed relative to a node by a
// template and answers exchanges with response messages. The
// production is description, not process: request message and address
// bindings in, response message out. It does not tick, remember, or
// touch a socket — when a production runs because a wire event
// arrived, that traversal is the service's, and its trace enters
// through traversal.mts as ever.
//
// The exchange labels a resource inhabits follow from its methods
// (the label's method component); the medium component is the
// production's to negotiate, via the codecs it links.

import type { RequestMessage, ResponseMessage } from "./message.mjs";

/** Variable bindings from matching an address template against a path. */
export type Bindings = Readonly<Record<string, string>>;

export type Production = (
  request: RequestMessage,
  bindings: Bindings,
) => ResponseMessage | Promise<ResponseMessage>;

export interface Resource {
  readonly kind: "web.resource";
  readonly address: string;
  readonly methods: readonly string[];
  readonly respond: Production;
}

const isToken = (text: string): boolean => text.length > 0 && !/\s/.test(text);

export function resource(address: string, methods: readonly string[], respond: Production): Resource {
  if (!address.startsWith("/")) {
    throw new TypeError("resource: address must start with /");
  }
  if (methods.length === 0) {
    throw new TypeError("resource: at least one method is required");
  }
  for (const method of methods) {
    if (!isToken(method)) {
      throw new TypeError("resource: methods must be nonempty, whitespace-free tokens");
    }
  }
  return Object.freeze({
    kind: "web.resource" as const,
    address,
    methods: Object.freeze([...methods]),
    respond,
  });
}

/**
 * Match an address template against a request path. Templates bind one
 * path segment per ":name" segment and require equality elsewhere;
 * bound segments are percent-decoded. Returns the bindings (empty for
 * a literal match), or null when the path does not lie at the address
 * — including when a bound segment is not valid percent-encoding,
 * since such a path denotes nothing.
 */
export function matchAddress(address: string, pathname: string): Bindings | null {
  const templateSegments = address.split("/");
  const pathSegments = pathname.split("/");
  if (templateSegments.length !== pathSegments.length) return null;
  const bindings: Record<string, string> = {};
  for (let i = 0; i < templateSegments.length; i++) {
    const template = templateSegments[i]!;
    const segment = pathSegments[i]!;
    if (template.startsWith(":") && template.length > 1) {
      if (segment.length === 0) return null;
      try {
        bindings[template.slice(1)] = decodeURIComponent(segment);
      } catch {
        return null;
      }
    } else if (template !== segment) {
      return null;
    }
  }
  return Object.freeze(bindings);
}
