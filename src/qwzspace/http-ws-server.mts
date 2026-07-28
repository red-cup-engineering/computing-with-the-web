import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "node:http";
import { handler, staticFiles, websocketServer } from "@red-cup-engineering/http-server";

export type WsConnection = {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  ping(data?: Buffer): void;
  onMessage?: (data: string | Buffer, isBinary?: boolean) => void;
  onClose?: (code?: number, reason?: string) => void;
  onError?: (error: unknown) => void;
  raw: unknown;
  req: IncomingMessage;
};

export type AttachOptions = Readonly<{
  path?: string | RegExp | ((path: string) => boolean);
  maxPayload?: number;
}>;

export function wsClient(raw: {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  ping(data?: Buffer): void;
  on(event: "message" | "close" | "error", cb: (...args: any[]) => void): unknown;
}, req: IncomingMessage): WsConnection {
  const conn: WsConnection = {
    raw,
    req,
    send: (data) => raw.send(data),
    close: (code, reason) => raw.close(code, reason),
    ping: (data) => raw.ping(data),
  };
  raw.on("message", (data: string | Buffer, isBinary?: boolean) => conn.onMessage?.(data, isBinary));
  raw.on("close", (code?: number, reason?: string) => conn.onClose?.(code, reason));
  raw.on("error", (error: unknown) => conn.onError?.(error));
  return conn;
}

export function attach(server: Server, onConnection: (conn: WsConnection, req: IncomingMessage) => void | Promise<void>, options: AttachOptions = {}): () => void {
  const endpoint = websocketServer(async (raw, req) => {
    await onConnection(wsClient(raw, req), req);
  }, options.maxPayload === undefined ? {} : { maxPayload: options.maxPayload });
  const upgrade = endpoint.toUpgrade(options.path);
  const listener = (req: IncomingMessage, socket: unknown, head: Buffer): void => {
    if (upgrade.match && !matches(upgrade.match, req)) {
      if (typeof (socket as { destroy?: unknown }).destroy === "function") (socket as { destroy(): void }).destroy();
      return;
    }
    upgrade.handleUpgrade?.(req, socket, head);
  };
  server.on("upgrade", listener);
  return () => server.off("upgrade", listener);
}

export function staticHandler(root: string, defaultPath = "/index.html"): (req: IncomingMessage, res: ServerResponse) => void {
  const serve = handler({ resources: [{ match: () => true, handler: staticFiles({ root }) }] });
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      const normalized = defaultPath.startsWith("/") ? defaultPath : `/${defaultPath}`;
      req.url = normalized + url.search;
    }
    serve(req, res);
  };
}

function matches(match: NonNullable<AttachOptions["path"]>, req: IncomingMessage): boolean {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (typeof match === "string") return path === match;
  if (match instanceof RegExp) return match.test(path);
  return Boolean(match(path));
}
