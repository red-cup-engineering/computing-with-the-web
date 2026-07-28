// @red-cup-engineering/web-topology — the categorical home of the web tier.
//
// Objects are nodes bearing roles drawn from {client, server}; a peer
// bears both. The generating morphisms are exchanges — directed, labeled,
// from a client-role node to a server-role node — and the category is
// free on that quiver: morphisms are relays (paths of exchanges),
// composition is relaying, identity is the null relay. Because exchanges
// are role-constrained, every node a composite factors through bears
// both roles: proxies are exactly the peers, by theorem.
//
// Traversal is where structure becomes lesson evidence. A wire event over an
// exchange yields evidence whose cell mirrors the morphism;
// @red-cup-engineering/animating/becoming/doing/working/learning/lessons owns everything from there (utterance
// articulation, accretive memory, world induction on explicit reads —
// charges are measured from induced worlds, never seeded here).
//
// The answering vocabulary states what a server-role node answers:
// messages (RFC 9110 senses — pure values, no streams, no sockets) and
// resources (an address template with productions from request message
// to response message). Libraries describe resources; only the
// persistent process that traverses the wire touches transport.

export { node, client, server, peer, bearsRole, isPeer, sameNode } from "./node.mjs";
export type { Node, Role } from "./node.mjs";

export { exchange, labelText } from "./exchange.mjs";
export type { Exchange, ExchangeLabel } from "./exchange.mjs";

export { identityRelay, relayOf, composeRelays, intermediates } from "./relay.mjs";
export type { Relay } from "./relay.mjs";

export { traverseExchange, traverseRelay } from "./traversal.mjs";
export type { TraversalTestimony } from "./traversal.mjs";

export { requestMessage, responseMessage } from "./message.mjs";
export type { FieldValue, Fields, RequestMessage, ResponseMessage } from "./message.mjs";

export { resource, matchAddress } from "./resource.mjs";
export type { Bindings, Production, Resource } from "./resource.mjs";
