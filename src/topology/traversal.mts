// traversal.mts — the boundary where structure becomes lesson evidence.
//
// web-topology is pure structure: nothing in it ticks or remembers.
// A wire event over an exchange yields lesson evidence in
// @red-cup-engineering/animating/becoming/doing/working/learning/lessons vocabulary: the evidence cell mirrors the
// morphism it traverses (source —label→ target), and the provenance is
// the wire event's testimony, supplied by whoever witnessed it. There
// is no charge to admit — charges are measured from induced worlds,
// never seeded, and a contrary fact about a traversal is its own entry
// claiming a contrary predicate. From there the learning layer owns the
// path: evidence articulates utterances, utterances accrete in memory, and
// worlds are induced only on explicit reads.

import type { LessonEvidence } from "@red-cup-engineering/animating/becoming/doing/working/learning/lessons";
import { mark } from "@red-cup-engineering/relating";
import { labelText, type Exchange } from "./exchange.mjs";
import type { Relay } from "./relay.mjs";

/** What the witness of a wire event testifies about it. */
export interface TraversalTestimony {
  /** Opaque provenance, carried at the learning layer - never into the bedrock. */
  readonly provenance?: unknown;
}

/** The lesson evidence one wire event over an exchange yields. */
export function traverseExchange(hop: Exchange, testimony: TraversalTestimony = {}): LessonEvidence {
  return Object.freeze({
    subject: mark(hop.source.id),
    predicate: mark(labelText(hop.label)),
    object: mark(hop.target.id),
    ...(testimony.provenance !== undefined ? { provenance: testimony.provenance } : {}),
  });
}

/**
 * The lesson evidence one wire event over a relay yields: one entry per hop, in hop
 * order. The identity relay traverses silently — the null relay is no
 * wire event at all, so it leaves no lesson evidence.
 */
export const traverseRelay = (relay: Relay, testimony: TraversalTestimony = {}): readonly LessonEvidence[] =>
  Object.freeze(relay.hops.map((hop) => traverseExchange(hop, testimony)));
