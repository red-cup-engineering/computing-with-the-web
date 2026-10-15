/** Narrow type-only contract for the live RDF documentary reader.
 * Runtime ownership remains in Computer Triplet Serialized Content. */
declare module "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/reading-rdf" {
  export function readingTurtle(folded: {
    entity: string;
    fiber: readonly {
      predicate: string;
      object: unknown;
      value?: { evidence?: readonly [readonly string[], readonly string[]] };
    }[];
  }, options?: { base?: string; subjects?: readonly string[] }): string;
}
