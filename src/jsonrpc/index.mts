// @red-cup-engineering/web-jsonrpc — JSON-RPC 2.0 client with rotating upstream
// failover. The client knows the protocol, never the upstreams: nodes
// are explicit, and default node sets live with the consumers that
// know them.

export {
  createJsonRpcFetchTransport,
  jsonRpcRequest,
  JsonRpcCallError,
  JsonRpcClient,
} from "./client.mjs";
export type {
  JsonRpcAttempt,
  JsonRpcAttemptContext,
  JsonRpcClientOptions,
  JsonRpcErrorObject,
  JsonRpcFailure,
  JsonRpcFetchTransportOptions,
  JsonRpcId,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcTransport,
  JsonRpcTransportResponse,
} from "./client.mjs";
