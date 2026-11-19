// client.mts — JSON-RPC 2.0 client with rotating upstream failover.
//
// Envelope construction, a fetch transport, and a multi-pass rotation
// over explicit nodes. The client knows the protocol, never the
// upstreams: node lists are the consumer's testimony, so `nodes` is
// required and there is no default node set here.

export type JsonRpcId = string | number | null;

export type JsonRpcParams = readonly unknown[] | Record<string, unknown>;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params: JsonRpcParams;
  id: JsonRpcId;
};

export type JsonRpcSuccess<T = unknown> = {
  jsonrpc?: "2.0";
  result: T;
  id?: JsonRpcId;
};

export type JsonRpcErrorObject = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type JsonRpcFailure = {
  jsonrpc?: "2.0";
  error: JsonRpcErrorObject;
  id?: JsonRpcId;
};

export type JsonRpcTransportResponse = {
  status: number;
  body: string;
  headers?: Record<string, string>;
};

export type JsonRpcAttemptContext = {
  method: string;
  params: JsonRpcParams;
  pass: number;
  nodeIndex: number;
  timeoutMs: number;
};

export type JsonRpcTransport = (
  url: string,
  request: JsonRpcRequest,
  context: JsonRpcAttemptContext,
) => Promise<JsonRpcTransportResponse>;

export type JsonRpcAttempt = {
  url: string;
  pass: number;
  nodeIndex: number;
  status?: number;
  error?: unknown;
  rpcError?: JsonRpcErrorObject;
};

export type JsonRpcClientOptions = {
  nodes: readonly string[];
  transport?: JsonRpcTransport;
  timeoutMs?: number;
  passes?: number;
  headers?: Record<string, string>;
  nextId?: () => JsonRpcId;
  onAttempt?: (attempt: JsonRpcAttempt) => void;
};

export type JsonRpcFetchTransportOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

export class JsonRpcCallError extends Error {
  readonly method: string;
  readonly attempts: readonly JsonRpcAttempt[];
  readonly lastError: unknown | undefined;
  readonly rpcError?: JsonRpcErrorObject;

  constructor(
    message: string,
    details: {
      method: string;
      attempts: readonly JsonRpcAttempt[];
      lastError: unknown | undefined;
      rpcError?: JsonRpcErrorObject;
    },
  ) {
    super(message);
    this.name = "JsonRpcCallError";
    this.method = details.method;
    this.attempts = details.attempts;
    this.lastError = details.lastError;
    if (details.rpcError) this.rpcError = details.rpcError;
  }
}

export function jsonRpcRequest(method: string, params: JsonRpcParams = [], id: JsonRpcId = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", method, params, id };
}

export function createJsonRpcFetchTransport(options: JsonRpcFetchTransportOptions = {}): JsonRpcTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (url, request, context) => {
    const timeoutMs = options.timeoutMs ?? context.timeoutMs;
    const response = await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      status: response.status,
      headers,
      body: await response.text(),
    };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rpcErrorMessage(error: JsonRpcErrorObject): string {
  if (typeof error.message === "string" && error.message.length > 0) return error.message;
  return JSON.stringify(error);
}

function parseRpcBody(body: string, url: string): JsonRpcSuccess | JsonRpcFailure {
  try {
    return JSON.parse(body) as JsonRpcSuccess | JsonRpcFailure;
  } catch (error) {
    throw new Error(`Unparseable JSON-RPC body from ${url}: ${errorMessage(error)}`);
  }
}

export class JsonRpcClient {
  readonly nodes: readonly string[];
  readonly timeoutMs: number;
  readonly passes: number;

  private readonly transport: JsonRpcTransport;
  private readonly nextId: () => JsonRpcId;
  private readonly onAttempt: ((attempt: JsonRpcAttempt) => void) | undefined;
  private cursor = 0;
  private id = 0;

  constructor(options: JsonRpcClientOptions) {
    if (!options.nodes || options.nodes.length === 0) {
      throw new TypeError("JsonRpcClient requires at least one node — upstream defaults belong to the caller");
    }
    this.nodes = [...options.nodes];
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.passes = Math.max(1, Math.floor(options.passes ?? 2));
    this.transport = options.transport ?? createJsonRpcFetchTransport({
      timeoutMs: this.timeoutMs,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    this.nextId = options.nextId ?? (() => {
      this.id += 1;
      return this.id;
    });
    this.onAttempt = options.onAttempt;
  }

  buildEnvelope(method: string, params: JsonRpcParams = []): JsonRpcRequest {
    return jsonRpcRequest(method, params, this.nextId());
  }

  async call<T = unknown>(method: string, params: JsonRpcParams = []): Promise<T> {
    const request = this.buildEnvelope(method, params);
    const start = this.cursor;
    this.cursor = (this.cursor + 1) % this.nodes.length;

    const attempts: JsonRpcAttempt[] = [];
    let lastError: unknown;
    let lastRpcError: JsonRpcErrorObject | undefined;

    for (let pass = 0; pass < this.passes; pass++) {
      for (let offset = 0; offset < this.nodes.length; offset++) {
        const nodeIndex = (start + offset) % this.nodes.length;
        const url = this.nodes[nodeIndex]!;
        const attempt: JsonRpcAttempt = { url, pass, nodeIndex };
        attempts.push(attempt);

        try {
          const response = await this.transport(url, request, {
            method,
            params,
            pass,
            nodeIndex,
            timeoutMs: this.timeoutMs,
          });
          attempt.status = response.status;

          if (response.status < 200 || response.status >= 300) {
            lastError = new Error(`HTTP ${response.status} from ${url}`);
            attempt.error = lastError;
            this.onAttempt?.(attempt);
            continue;
          }

          const parsed = parseRpcBody(response.body, url);
          if ("error" in parsed && parsed.error) {
            lastRpcError = parsed.error;
            lastError = new Error(`RPC error from ${url}: ${rpcErrorMessage(parsed.error)}`);
            attempt.error = lastError;
            attempt.rpcError = parsed.error;
            this.onAttempt?.(attempt);
            continue;
          }

          this.onAttempt?.(attempt);
          return (parsed as JsonRpcSuccess<T>).result;
        } catch (error) {
          lastError = error;
          attempt.error = error;
          this.onAttempt?.(attempt);
        }
      }
    }

    const details: {
      method: string;
      attempts: readonly JsonRpcAttempt[];
      lastError: unknown | undefined;
      rpcError?: JsonRpcErrorObject;
    } = { method, attempts, lastError };
    if (lastRpcError) details.rpcError = lastRpcError;
    throw new JsonRpcCallError(
      `All ${this.nodes.length} JSON-RPC nodes failed for ${method}: ${lastError ? errorMessage(lastError) : "unknown error"}`,
      details,
    );
  }
}
