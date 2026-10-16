// Generated only from named functions in emsenn/swarm@72847d0a5a0e3303a0ec417e793daabb0634fa8d.
// See swarm-taxonomy-provenance.json. Type erasure only; no invented projection or HTTP adapter.
import { createHash } from "node:crypto";
function taxonomyItemFromTraceEntry(entry, options) {
    const id = traceEntryItemId(entry);
    const predicate = displayPredicate(entry.a);
    const subject = displayTerm(entry.e);
    const object = displayTerm(objectOf(entry));
    const instant = instantOf(entry.t);
    const terms = termsFromTraceEntry(entry);
    return Object.freeze({
        id,
        url: `${absolute(options.baseUrl, options.timelinePath ?? "/timeline")}#${encodeURIComponent(id)}`,
        title: `${chargeLabel(entry)} ${predicate} ${object}`,
        summary: `${subject} ${predicate} ${object}`,
        ...(instant === undefined ? {} : { published: instant, updated: instant }),
        terms,
    });
}
function taxonomyAlgebraFromTraceEntry(entry) {
    const neutral = [{ predicate: "charge", object: chargeLabel(entry) }];
    const charged = termPairsFromTraceEntry(entry).filter((term) => term.predicate !== "charge");
    return Object.freeze({
        subject: traceEntryItemId(entry),
        potential: Object.freeze([
            ...neutral,
            ...(entry.v.value[0] && !entry.v.value[1] ? charged : []),
        ]),
        active: Object.freeze(entry.v.value[1] && !entry.v.value[0] ? charged : []),
        stable: Object.freeze(entry.v.value[0] && entry.v.value[1] ? charged : []),
    });
}
function termsFromTraceEntry(entry) {
    const terms = new Map();
    for (const term of termPairsFromTraceEntry(entry)) {
        const bucket = terms.get(term.predicate) ?? new Set();
        bucket.add(term.object);
        terms.set(term.predicate, bucket);
    }
    return Object.freeze(Object.fromEntries([...terms.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([scheme, values]) => [scheme, Object.freeze([...values].sort())])));
}
function termPairsFromTraceEntry(entry) {
    const terms = [
        { predicate: "charge", object: chargeLabel(entry) },
        { predicate: "subject", object: displayTerm(entry.e) },
        { predicate: "predicate", object: displayPredicate(entry.a) },
        { predicate: "object", object: displayTerm(objectOf(entry)) },
    ];
    const family = subjectFamily(entry.e);
    if (family !== null)
        terms.push({ predicate: "family", object: family });
    if (entry.a && typeof entry.a === "object" && !Array.isArray(entry.a)) {
        const record = entry.a;
        if (typeof record.field === "string" && record.field.trim())
            terms.push({ predicate: "field", object: record.field });
        if (typeof record.mark === "string" && record.mark.trim())
            terms.push({ predicate: "mark", object: record.mark });
    }
    for (const witness of [...entry.v.evidence[0], ...entry.v.evidence[1]]) {
        if (typeof witness === "string" && witness.trim())
            terms.push({ predicate: "witness", object: witness });
    }
    return Object.freeze(terms);
}
function relationDocument(relation) {
    return {
        subjects: relation.subjects,
        terms: relation.terms,
        cells: relation.subjects.map((subject) => ({
            subject,
            terms: relation.terms.map((term) => ({
                ...term,
                value: relation.at(subject, term),
            })).filter((cell) => cell.value !== "absurd"),
        })),
    };
}
function traceEntryItemId(entry) {
    return `trace-${traceEntryId(entry).slice(0, 16)}`;
}
function chargeLabel(entry) {
    const positive = entry.v.value[0];
    const negative = entry.v.value[1];
    if (positive && negative)
        return "stable";
    if (positive)
        return "potential";
    if (negative)
        return "active";
    return "absurd";
}
function displayPredicate(attribute) {
    if (attribute && typeof attribute === "object" && !Array.isArray(attribute)) {
        const record = attribute;
        if (typeof record.mark === "string" && record.mark.trim())
            return record.mark;
        if (typeof record.predicate === "string" && record.predicate.trim())
            return record.predicate;
    }
    return displayTerm(attribute);
}
function objectOf(entry) {
    if (entry.a && typeof entry.a === "object" && !Array.isArray(entry.a) && "object" in entry.a) {
        return entry.a.object;
    }
    return entry.t;
}
function displayTerm(value) {
    return typeof value === "string" ? value : stableKey(value);
}
function instantOf(value) {
    const candidate = instantCandidate(value);
    if (candidate === undefined)
        return undefined;
    const time = Date.parse(candidate);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
function instantCandidate(value) {
    if (typeof value === "string" || typeof value === "number")
        return String(value);
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const record = value;
    for (const key of ["at", "t", "transaction", "createdAt", "updatedAt", "timestamp"]) {
        const candidate = record[key];
        if (typeof candidate === "string" || typeof candidate === "number")
            return String(candidate);
    }
    return undefined;
}
function subjectFamily(value) {
    if (typeof value !== "string")
        return null;
    if (value.startsWith("stigmergy/fields/work-board/"))
        return "work-board";
    if (value.startsWith("stigmergy/fields/"))
        return "stigmergy";
    return null;
}
function absolute(baseUrl, path) {
    return new URL(path.replace(/^\/+/, ""), ensureBaseUrl(baseUrl)).href;
}
function ensureBaseUrl(baseUrl) {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
function stableKey(value) {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value !== "object")
        return typeof value + ":" + String(value);
    if (Array.isArray(value))
        return "[" + value.map(stableKey).join(",") + "]";
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return "{" + entries.map(([key, item]) => key + ":" + stableKey(item)).join(",") + "}";
}
function canonicalId(value) {
    return createHash("sha256").update(canonicalAny(value), "utf8").digest("hex");
}
function canonicalAny(value) {
    if (value === undefined)
        return "\"[undefined]\"";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(canonicalAny).join(",") + "]";
    const record = value;
    return "{" + Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalAny(record[key])}`).join(",") + "}";
}
function traceEntryId(entry) {
    return canonicalId(traceEntryDigest(entry));
}
function traceEntryDigest(entry) {
    return {
        e: entry.e,
        a: entry.a,
        v: {
            value: [entry.v.value[0], entry.v.value[1]],
            evidence: [
                entry.v.evidence[0].map((item) => item),
                entry.v.evidence[1].map((item) => item),
            ],
        },
        t: entry.t,
    };
}
export { taxonomyItemFromTraceEntry, taxonomyAlgebraFromTraceEntry, relationDocument };
