// Web observes wire traversal; SignCell owns carrier construction and identity.
// Caller testimony is preserved outside the carrier, without attribution.
import { mark, webEvidence, type WebEvidence } from "../evidence.mjs";
import { labelText, type Exchange } from "./exchange.mjs";
import type { Relay } from "./relay.mjs";

export type TraversalEvidence = WebEvidence;
/** Opaque caller testimony, never interpreted as authority or signature proof. */
export interface TraversalTestimony { readonly provenance?: unknown }

export function traverseExchange(hop: Exchange, testimony: TraversalTestimony = {}): TraversalEvidence {
  return webEvidence(mark(hop.source.id), mark(labelText(hop.label)), mark(hop.target.id), testimony.provenance);
}

/** One observed claim per hop, in order and with multiplicity. Identity is silent. */
export const traverseRelay = (relay: Relay, testimony: TraversalTestimony = {}): readonly TraversalEvidence[] =>
  Object.freeze(relay.hops.map((hop) => traverseExchange(hop, testimony)));
