// pi-dmrx-mcp: bridges pi to the DMR-X MCP server.
//
// DMR-X's MCP server (services/mcp-server) exposes 40+ dmrx_* tools over
// StreamableHTTP at http://127.0.0.1:3100/mcp. pi has no native MCP client,
// so this extension speaks MCP itself and re-exposes the tools to pi.
//
// It registers:
//   - dmrx_mcp_list  : list the live MCP tools (name + description)
//   - dmrx_mcp_call  : call any MCP tool by name with JSON args
//   - <each dmrx_* tool> : a native wrapper so the model can call it directly
import { McpClient } from "./mcp-client.ts";
import { Type } from "typebox";

const MCP_URL = process.env.DMRX_MCP_URL || "http://127.0.0.1:47114";
const MCP_KEY = process.env.DMRX_MCP_API_KEY || "test-mcp-key";

// ---- JSON Schema -> TypeBox (handles the subset MCP emits) ----
const CACHE = new Map<string, any>();
function toTB(node: any): any {
  if (!node || typeof node !== "object") return Type.Any();
  if (Array.isArray(node.anyOf)) return Type.Union(node.anyOf.map(toTB));
  if (Array.isArray(node.oneOf)) return Type.Union(node.oneOf.map(toTB));
  let types = node.type;
  if (types === undefined || types === null) {
    if (node.properties) types = "object";
    else return Type.Any();
  }
  if (Array.isArray(types)) {
    const parts = types
      .filter((x: string) => x !== "null")
      .map((t: string) => toTB({ ...node, type: t }));
    if (types.includes("null")) parts.push(Type.Null());
    return parts.length === 1 ? parts[0] : Type.Union(parts);
  }
  const t = String(types).toLowerCase();
  const desc = node.description;
  const opt = (extra: any) => (desc ? { description: desc } : extra);
  switch (t) {
    case "object": {
      const props: Record<string, any> = {};
      const req: string[] = [];
      const src = node.properties || {};
      for (const k of Object.keys(src)) {
        props[k] = toTB(src[k]);
        if (node.required && node.required.includes(k)) req.push(k);
      }
      return req.length ? Type.Object(props, { required: req, ...opt({}) }) : Type.Object(props, opt({}));
    }
    case "array":
      return node.items ? Type.Array(toTB(node.items), opt({})) : Type.Array(Type.Any(), opt({}));
    case "integer":
      return Type.Integer(opt({}));
    case "number":
      return Type.Number(opt({}));
    case "boolean":
      return Type.Boolean(opt({}));
    case "string":
    default:
      return Type.String(opt({}));
  }
}

// Cache the live tool list (set after initialize).
let CLIENT: McpClient | null = null;
let TOOL_LIST: any[] = [];
let TOOL_LIST_SET = false;

async function connect(retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = new McpClient(MCP_URL, MCP_KEY);
    try {
      await client.initialize();
      const listed = await client.listTools();
      TOOL_LIST = listed.tools || [];
      TOOL_LIST_SET = true;
      CLIENT = client;
      console.log(`[pi-dmrx-mcp] connected: ${TOOL_LIST.length} tools (attempt ${attempt})`);
      return true;
    } catch (e: any) {
      console.error(`[pi-dmrx-mcp] connect attempt ${attempt}/${retries} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  console.error(`[pi-dmrx-mcp] could not connect to ${MCP_URL}; tools/enums will be discovered lazily on first call.`);
  return false;
}

export default async function extension(pi: any) {
  // Best-effort eager connect; tolerates a flapping server at load time.
  await connect();

  async function callAny(name: string, args: any) {
    if (!CLIENT) {
      // Lazy (re)connect on first use — handles server restart between sessions.
      const ok = await connect();
      if (!ok) throw new Error(`DMR-X MCP server unreachable at ${MCP_URL}`);
    }
    try {
      const result = await CLIENT!.callTool(name, args);
      return McpClient.resultToText(result);
    } catch (e: any) {
      // If the connection died mid-session, try one reconnect before giving up.
      if (CLIENT) { CLIENT = null; }
      const ok = await connect(1);
      if (ok) {
        const result = await CLIENT!.callTool(name, args);
        return McpClient.resultToText(result);
      }
      throw e;
    }
  }

  // ---- meta tools (always available) ----
  pi.registerTool({
    name: "dmrx_mcp_list",
    label: "DMR-X MCP: list tools",
    description: "List all DMR-X MCP tools currently exposed by the gateway's MCP server, with their descriptions. Use this to discover available capabilities before calling one.",
    parameters: Type.Object({}, { description: "No parameters." }),
    execute: async () => {
      let list = TOOL_LIST;
      if (!list.length) {
        if (!CLIENT) await connect(1);
        if (CLIENT) {
          try { list = TOOL_LIST; } catch { /* ignore */ }
        }
      }
      const lines = list.map((t) => `- ${t.name}: ${t.description || "(no description)"}`);
      return { content: [{ type: "text", text: `DMR-X MCP tools (${list.length}):\n${lines.join("\n")}` }] };
    },
  });

  pi.registerTool({
    name: "dmrx_mcp_call",
    label: "DMR-X MCP: call a tool",
    description: "Call any DMR-X MCP tool by name with a JSON arguments object. The arguments object should match the named tool's schema (see dmrx_mcp_list). Returns the tool's text result.",
    parameters: Type.Object({
      name: Type.String({ description: "The MCP tool name, e.g. dmrx_status or dmrx_chat." }),
      args: Type.Any({ description: "JSON object of arguments for the tool." }),
    }, { required: ["name"] }),
    execute: async (_id: string, params: any) => {
      const out = await callAny(params.name, params.args || {});
      return { content: [{ type: "text", text: out }] };
    },
  });

  // ---- native wrappers for each dmrx_* tool ----
  // IMPORTANT: DMR-X exposes 321 MCP tools (~271 of them dmrx_agent_* subagents).
  // Registering all of them ships 321 tool schemas on EVERY pi inference request,
  // which blows past provider request limits and makes pi hang/time out.
  // So we natively wrap only the core dmrx_* surface; the dmrx_agent_* shelf stays
  // fully reachable through the dmrx_mcp_call meta-tool.
  const WRAP_AGENTS = process.env.DMRX_MCP_WRAP_AGENTS === "1";
  const MAX_WRAPPED = Number(process.env.DMRX_MCP_MAX_TOOLS || 16);
  const wrappable = TOOL_LIST.filter((t: any) => {
    if (t.name === "dmrx_mcp_list" || t.name === "dmrx_mcp_call") return false;
    if (!WRAP_AGENTS && t.name.startsWith("dmrx_agent_")) return false;
    return true;
  }).slice(0, MAX_WRAPPED);
  if (TOOL_LIST.length > wrappable.length) {
    console.log(
      `[pi-dmrx-mcp] natively wrapping ${wrappable.length}/${TOOL_LIST.length} tools ` +
      `(rest reachable via dmrx_mcp_call; set DMRX_MCP_WRAP_AGENTS=1 / DMRX_MCP_MAX_TOOLS to change)`
    );
  }
  for (const tool of wrappable) {
    const schema = tool.inputSchema && tool.inputSchema.properties
      ? tool.inputSchema
      : { type: "object", properties: {} };
    const params = toTB(schema);
    const toolName = tool.name;
    try {
      pi.registerTool({
        name: toolName,
        label: `DMR-X: ${toolName}`,
        description: tool.description || `DMR-X MCP tool ${toolName}.`,
        promptSnippet: undefined,
        parameters: params,
        execute: async (_id: string, p: any) => {
          const out = await callAny(toolName, p || {});
          return { content: [{ type: "text", text: out }] };
        },
      });
    } catch (e: any) {
      console.error(`[pi-dmrx-mcp] could not register ${toolName}: ${e.message}`);
    }
  }
}
