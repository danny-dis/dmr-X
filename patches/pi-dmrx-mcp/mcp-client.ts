// Minimal MCP StreamableHTTP client for DMR-X (pi extension helper).
import http from "node:http";

export class McpClient {
  base: string;
  auth: Record<string, string>;
  sessionId: string | null = null;
  id = 0;

  constructor(baseUrl: string, apiKey?: string) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.auth = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  }

  _parseBody(raw: string, contentType?: string): any {
    if (contentType && contentType.includes("text/event-stream")) {
      for (const frame of raw.split("\n\n")) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine) {
          try { return JSON.parse(dataLine.slice(5).trim()); } catch { /* ignore */ }
        }
      }
      return null;
    }
    try { return JSON.parse(raw); } catch { return null; }
  }

  _request(method: string, params: any, isNotification = false): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = isNotification
        ? JSON.stringify({ jsonrpc: "2.0", method, params })
        : JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params });
      const headers: Record<string, string> = {
        ...this.auth,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
      const u = new URL(`${this.base}/mcp`);
      const req = http.request(u, { method: "POST", headers, timeout: 20000 }, (res) => {
        if (res.headers["mcp-session-id"] && !this.sessionId) {
          this.sessionId = res.headers["mcp-session-id"] as string;
        }
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (isNotification) return resolve(null);
          const ct = res.headers["content-type"] || "";
          const msg = this._parseBody(raw, ct);
          if (!msg) return reject(new Error(`Empty/invalid MCP response (HTTP ${res.statusCode}): ${raw.slice(0, 300)}`));
          if (msg.error) return reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          resolve(msg.result);
        });
      });
      req.on("timeout", () => req.destroy(new Error("MCP request timeout")));
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  async initialize() {
    const res = await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-dmrx-bridge", version: "1.0.0" },
    });
    await this._request("notifications/initialized", {}, true);
    return res;
  }

  async listTools() {
    return this._request("tools/list", {});
  }

  async callTool(name: string, args: any) {
    return this._request("tools/call", { name, arguments: args || {} });
  }

  static resultToText(result: any): string {
    if (!result) return "(no result)";
    if (Array.isArray(result.content)) {
      return result.content
        .map((c: any) => (c && c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");
    }
    if (typeof result === "string") return result;
    return JSON.stringify(result, null, 2);
  }
}
