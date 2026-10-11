// exchange.mts — the generating morphisms: directed, labeled exchanges.
//
// An exchange runs from a node bearing the client role to a node bearing
// the server role, labeled by what is exchanged (method, medium). The
// role requirement here is what later makes "composites factor through
// peers" a theorem rather than a rule: two consecutive exchanges meeting
// at a node force that node to bear both roles.

import { bearsRole, type Node } from "./node.mjs";

export interface ExchangeLabel {
  readonly method: string;
  readonly medium: string;
}

export interface Exchange {
  readonly kind: "web.exchange";
  readonly source: Node;
  readonly target: Node;
  readonly label: ExchangeLabel;
}

const isToken = (text: string): boolean => text.length > 0 && !/\s/.test(text);

export function exchange(source: Node, target: Node, label: ExchangeLabel): Exchange {
  if (!bearsRole(source, "client")) {
    throw new TypeError(`exchange: source ${JSON.stringify(source.id)} does not bear the client role`);
  }
  if (!bearsRole(target, "server")) {
    throw new TypeError(`exchange: target ${JSON.stringify(target.id)} does not bear the server role`);
  }
  if (!isToken(label.method) || !isToken(label.medium)) {
    throw new TypeError("exchange: label method and medium must be nonempty, whitespace-free tokens");
  }
  return Object.freeze({
    kind: "web.exchange" as const,
    source,
    target,
    label: Object.freeze({ method: label.method, medium: label.medium }),
  });
}

/**
 * The canonical textual form of a label: "method medium". Traversal cells
 * use this as their predicate term because cell identity must survive
 * serialization — bedrock marks of structured values coincide only by
 * reference (Object.is) and lose identity across dehydrate/rehydrate,
 * while strings coincide by value everywhere. The single space is the
 * separator; both components are whitespace-free tokens by construction.
 */
export const labelText = (label: ExchangeLabel): string => `${label.method} ${label.medium}`;
