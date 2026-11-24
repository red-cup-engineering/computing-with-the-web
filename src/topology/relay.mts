// relay.mts — the morphisms of the web category: relays.
//
// The category is the free category on the role-constrained quiver of
// exchanges: a relay is a path of exchanges, composition is relaying
// (path concatenation), and the identity at a node is the null relay —
// zero hops, no wire event. Associativity and the unit laws hold by
// construction, because array concatenation has them.
//
// The proxy theorem also holds by construction: every interior node of a
// relay is the target of one hop (so it bears the server role) and the
// source of the next (so it bears the client role) — the nodes a
// composite factors through are exactly the peers. A proxy is a peer,
// full stop.

import { sameNode, type Node } from "./node.mjs";
import type { Exchange } from "./exchange.mjs";

export interface Relay {
  readonly kind: "web.exchange.relay";
  readonly source: Node;
  readonly target: Node;
  readonly hops: readonly Exchange[];
}

const seal = (source: Node, target: Node, hops: readonly Exchange[]): Relay =>
  Object.freeze({ kind: "web.exchange.relay" as const, source, target, hops: Object.freeze([...hops]) });

/** The identity at a node: the null relay (loopback). Zero hops — traversing it is no wire event. */
export const identityRelay = (at: Node): Relay => seal(at, at, []);

/** A single exchange as a one-hop relay. */
export const relayOf = (hop: Exchange): Relay => seal(hop.source, hop.target, [hop]);

/** Diagrammatic composition: `first`, then `second`. Throws unless they meet at the same node. */
export function composeRelays(first: Relay, second: Relay): Relay {
  if (!sameNode(first.target, second.source)) {
    throw new TypeError(
      `composeRelays: relays do not meet — first ends at ${JSON.stringify(first.target.id)}, ` +
        `second starts at ${JSON.stringify(second.source.id)}`,
    );
  }
  return seal(first.source, second.target, [...first.hops, ...second.hops]);
}

/** The interior nodes a relay factors through. By the role constraint on exchanges, every one is a peer. */
export const intermediates = (relay: Relay): readonly Node[] =>
  Object.freeze(relay.hops.slice(0, -1).map((hop) => hop.target));
