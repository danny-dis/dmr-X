import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const t = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? 'http://127.0.0.1:47114/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_KEY ?? 'test-mcp-key'}` } },
});
const c = new Client({ name: 'schema-dump', version: '1.0.0' });
await c.connect(t);
const l = await c.listTools();
const want = (process.argv[2] ?? '').split(',').filter(Boolean);
for (const tool of l.tools) {
  if (want.length && !want.some((w) => tool.name.includes(w))) continue;
  const s: any = tool.inputSchema;
  const props = s?.properties ? Object.keys(s.properties) : [];
  console.log(`${tool.name}\n  required: ${JSON.stringify(s?.required ?? [])}\n  props: ${props.join(', ')}`);
}
await c.close();
process.exit(0);
