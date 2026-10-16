import { createRequire } from "node:module";

/** Only the knowledge naming family crosses the taxonomy boundary. */
export type KnowledgeReading = "absurd" | "potential" | "active" | "stable";

export function isKnowledgeReading(value: unknown): value is KnowledgeReading {
  return value === "absurd" || value === "potential" || value === "active" || value === "stable";
}

// Data 0.2.0 exposes genuine ESM without declarations. Node >=22.18 supports
// this synchronous ESM load; unknown plus checks avoids inventing declarations.
const dataFour: unknown = createRequire(import.meta.url)(
  "@red-cup-engineering/computer-data-engineering-services-section/four",
);
if (typeof dataFour !== "object" || dataFour === null
  || !("knowledgeJoinReading" in dataFour)
  || typeof dataFour.knowledgeJoinReading !== "function") {
  throw new TypeError("Data FOUR must export knowledgeJoinReading");
}
const dataKnowledgeJoin = dataFour.knowledgeJoinReading;

export function joinKnowledgeReadings(left: KnowledgeReading, right: KnowledgeReading): KnowledgeReading {
  if (!isKnowledgeReading(left) || !isKnowledgeReading(right)) {
    throw new TypeError("Taxonomy cells must use the knowledge reading family");
  }
  const result: unknown = dataKnowledgeJoin(left, right);
  if (!isKnowledgeReading(result)) {
    throw new TypeError("Data FOUR knowledge join returned a non-knowledge reading");
  }
  return result;
}

