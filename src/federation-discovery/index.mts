import { jsonRepr as serverJsonRepr, wellKnown, type App, type Repr, type Resource } from "@red-cup-engineering/computing-with-http/app";
import { assertHttpUrl } from "@red-cup-engineering/content/codecs/feed";

export type JsonRecord = Record<string, unknown>;

export type WebFingerLink = {
  rel: string;
  type?: string;
  href?: string;
  titles?: Record<string, string>;
  properties?: Record<string, string | null>;
};

export type WebFingerSubject = {
  subject: string;
  aliases?: readonly string[];
  properties?: Record<string, string | null>;
  links?: readonly WebFingerLink[];
};

export type NodeInfoSoftware = {
  name: string;
  version: string;
  repository?: string;
  homepage?: string;
};

export type NodeInfoUsage = {
  users?: {
    total?: number;
    activeHalfyear?: number;
    activeMonth?: number;
  };
  localPosts?: number;
  localComments?: number;
};

export type NodeInfoServices = {
  inbound?: readonly string[];
  outbound?: readonly string[];
};

export type NodeInfoDocument = {
  software: NodeInfoSoftware;
  protocols?: readonly string[];
  services?: NodeInfoServices;
  openRegistrations?: boolean;
  usage?: NodeInfoUsage;
  metadata?: JsonRecord;
};

export type FederationDiscoveryOptions = {
  webfinger: readonly WebFingerSubject[];
  nodeInfo: NodeInfoDocument;
  baseUrl: string;
  nodeInfoPath?: string;
};

const NODEINFO_REL = "http://nodeinfo.diaspora.software/ns/schema/2.1";

function assertNonEmpty(value: string, field: string): void {
  if (!value) throw new TypeError(`${field} is required`);
}

function assertCount(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
}

function canonicalAcct(resource: string): string {
  return resource.startsWith("acct:") ? resource.toLowerCase() : resource;
}

function requireWebFingerSubject(subject: WebFingerSubject): void {
  assertNonEmpty(subject.subject, "webfinger.subject");
  for (const [index, alias] of (subject.aliases ?? []).entries()) {
    assertHttpUrl(alias, `webfinger.aliases[${index}]`);
  }
  for (const [index, link] of (subject.links ?? []).entries()) {
    assertNonEmpty(link.rel, `webfinger.links[${index}].rel`);
    if (link.href) assertHttpUrl(link.href, `webfinger.links[${index}].href`);
  }
}

function requireNodeInfo(document: NodeInfoDocument): void {
  assertNonEmpty(document.software.name, "nodeInfo.software.name");
  assertNonEmpty(document.software.version, "nodeInfo.software.version");
  if (document.software.repository) assertHttpUrl(document.software.repository, "nodeInfo.software.repository");
  if (document.software.homepage) assertHttpUrl(document.software.homepage, "nodeInfo.software.homepage");
  assertCount(document.usage?.users?.total, "nodeInfo.usage.users.total");
  assertCount(document.usage?.users?.activeHalfyear, "nodeInfo.usage.users.activeHalfyear");
  assertCount(document.usage?.users?.activeMonth, "nodeInfo.usage.users.activeMonth");
  assertCount(document.usage?.localPosts, "nodeInfo.usage.localPosts");
  assertCount(document.usage?.localComments, "nodeInfo.usage.localComments");
}

function jsonRepr(body: unknown, type = "application/json"): Repr {
  return serverJsonRepr(body, { type, pretty: true, cacheControl: { visibility: "public", maxAge: 300 } });
}

export function webFingerJrd(subject: WebFingerSubject): JsonRecord {
  requireWebFingerSubject(subject);
  return {
    subject: subject.subject,
    ...(subject.aliases && subject.aliases.length > 0 ? { aliases: [...subject.aliases] } : {}),
    ...(subject.properties ? { properties: subject.properties } : {}),
    ...(subject.links && subject.links.length > 0 ? { links: subject.links.map((link) => ({ ...link })) } : {}),
  };
}

export function webFingerIndex(subjects: readonly WebFingerSubject[]): Map<string, WebFingerSubject> {
  const index = new Map<string, WebFingerSubject>();
  for (const subject of subjects) {
    requireWebFingerSubject(subject);
    index.set(canonicalAcct(subject.subject), subject);
    index.set(subject.subject, subject);
    for (const alias of subject.aliases ?? []) index.set(alias, subject);
  }
  return index;
}

export function nodeInfoDiscovery(baseUrl: string, nodeInfoPath = "/nodeinfo/2.1"): JsonRecord {
  assertHttpUrl(baseUrl, "baseUrl");
  return {
    links: [{
      rel: NODEINFO_REL,
      href: new URL(nodeInfoPath, baseUrl).href,
    }],
  };
}

export function nodeInfoDocument(document: NodeInfoDocument): JsonRecord {
  requireNodeInfo(document);
  return {
    version: "2.1",
    software: {
      name: document.software.name,
      version: document.software.version,
      ...(document.software.repository ? { repository: document.software.repository } : {}),
      ...(document.software.homepage ? { homepage: document.software.homepage } : {}),
    },
    protocols: [...(document.protocols ?? [])],
    services: {
      inbound: [...(document.services?.inbound ?? [])],
      outbound: [...(document.services?.outbound ?? [])],
    },
    openRegistrations: document.openRegistrations ?? false,
    usage: {
      users: {
        total: document.usage?.users?.total ?? 0,
        activeHalfyear: document.usage?.users?.activeHalfyear ?? 0,
        activeMonth: document.usage?.users?.activeMonth ?? 0,
      },
      localPosts: document.usage?.localPosts ?? 0,
      localComments: document.usage?.localComments ?? 0,
    },
    metadata: document.metadata ?? {},
  };
}

export function federationDiscoveryApp(options: FederationDiscoveryOptions): App {
  assertHttpUrl(options.baseUrl, "baseUrl");
  requireNodeInfo(options.nodeInfo);
  const nodeInfoPath = options.nodeInfoPath ?? "/nodeinfo/2.1";
  const index = webFingerIndex(options.webfinger);
  const nodeInfoResource: Resource = {
    match: nodeInfoPath,
    route: nodeInfoPath,
    id: "federation.nodeinfo.document",
    name: "NodeInfo Document",
    methods: ["GET"],
    produces: ["application/json"],
    handler: () => jsonRepr(nodeInfoDocument(options.nodeInfo)),
  };
  const wellKnownApp = wellKnown([
    {
      name: "webfinger",
      methods: ["GET"],
      produces: ["application/jrd+json", "application/json"],
      handler: async (ctx) => {
        const resource = ctx.url.searchParams.get("resource");
        if (!resource) {
          return { status: 400, type: "text/plain; charset=utf-8", body: "Missing resource" };
        }
        const subject = index.get(canonicalAcct(resource)) ?? index.get(resource);
        if (!subject) {
          return { status: 404, type: "text/plain; charset=utf-8", body: "Not Found" };
        }
        return jsonRepr(webFingerJrd(subject), "application/jrd+json");
      },
    },
    {
      name: "nodeinfo",
      methods: ["GET"],
      produces: ["application/jrd+json", "application/json"],
      repr: jsonRepr(nodeInfoDiscovery(options.baseUrl, nodeInfoPath), "application/jrd+json"),
    },
  ]);

  return {
    resources: [
      ...(wellKnownApp.resources ?? []),
      nodeInfoResource,
    ],
  };
}
