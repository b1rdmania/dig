export const MCP_CONTRACT_VERSION = "v1-alpha";
export const MCP_SERVER_VERSION = "0.1.0";

export type McpResponseMeta = {
  request_id: string;
  tool: string;
  contract_version: string;
  server_version: string;
  timestamp: string;
};

type MetaInput = {
  requestId?: string;
  tool?: string;
  contractVersion?: string;
  serverVersion?: string;
};

function makeMeta(meta: MetaInput = {}): McpResponseMeta {
  return {
    request_id: meta.requestId ?? "unknown",
    tool: meta.tool ?? "unknown",
    contract_version: meta.contractVersion ?? MCP_CONTRACT_VERSION,
    server_version: meta.serverVersion ?? MCP_SERVER_VERSION,
    timestamp: new Date().toISOString(),
  };
}

function withMeta(data: unknown, meta: McpResponseMeta): unknown {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), _mcp: meta };
  }
  return { data, _mcp: meta };
}

export function toolResult(data: unknown, metaInput: MetaInput = {}) {
  const payload = withMeta(data, makeMeta(metaInput));
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function toolError(
  code: string,
  message: string,
  metaInput: MetaInput = {},
  details: unknown = null,
) {
  const payload = {
    error: { code, message, details },
    _mcp: makeMeta(metaInput),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: true,
  };
}
