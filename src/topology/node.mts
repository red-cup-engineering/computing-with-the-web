// node.mts — the objects of the web category: nodes bearing roles.
//
// A node is an addressable participant. Roles are properties of objects
// that determine which hom-sets are inhabited — not separate object
// classes: a node bearing "client" can source exchanges, a node bearing
// "server" can receive them, and a peer bears both. A node bearing no
// role is a lawful isolated object: it has its identity relay and
// nothing else.

export type Role = "client" | "server";

export interface Node {
  readonly kind: "web.node";
  readonly id: string;
  readonly roles: ReadonlySet<Role>;
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(["client", "server"]);

export function node(id: string, roles: Iterable<Role> = []): Node {
  if (id.length === 0) throw new TypeError("node: a node is addressable — id must be nonempty");
  const set = new Set<Role>();
  for (const role of roles) {
    if (!KNOWN_ROLES.has(role)) throw new TypeError(`node: unknown role ${JSON.stringify(role)}`);
    set.add(role);
  }
  return Object.freeze({ kind: "web.node" as const, id, roles: set });
}

export const client = (id: string): Node => node(id, ["client"]);
export const server = (id: string): Node => node(id, ["server"]);
export const peer = (id: string): Node => node(id, ["client", "server"]);

export const bearsRole = (subject: Node, role: Role): boolean => subject.roles.has(role);

/** A peer bears both roles — exactly the kind of node composition can factor through. */
export const isPeer = (subject: Node): boolean =>
  subject.roles.has("client") && subject.roles.has("server");

/** Object identity: same id, same role set. Same id with differing roles is a contradiction, not a coincidence. */
export function sameNode(left: Node, right: Node): boolean {
  if (left.id !== right.id) return false;
  if (left.roles.size !== right.roles.size) return false;
  for (const role of left.roles) if (!right.roles.has(role)) return false;
  return true;
}
