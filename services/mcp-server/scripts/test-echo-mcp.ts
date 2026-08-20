// Minimal stdio MCP server used to verify DMR-X aggregation + hot-reload.
// Deterministic, no network. Registered via dmrx-mcp.config.json -> aggregation.servers.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TAG = process.env.ECHO_TAG ?? 'echo';

const server = new Server(
  { name: `test-${TAG}-mcp`, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo_ping',
      description: 'Echo a ping message back. Deterministic test tool.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', description: 'message to echo' } },
        required: ['message'],
      },
    },
    {
      name: 'add_numbers',
      description: 'Add two numbers. Deterministic test tool.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'first operand' },
          b: { type: 'number', description: 'second operand' },
        },
        required: ['a', 'b'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === 'echo_ping') {
    return { content: [{ type: 'text', text: `pong: ${String(args?.message ?? '')}` }] };
  }
  if (name === 'add_numbers') {
    return { content: [{ type: 'text', text: `result: ${Number(args?.a ?? 0) + Number(args?.b ?? 0)}` }] };
  }
  return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
});

await server.connect(new StdioServerTransport());
console.error(`[test-${TAG}-mcp] stdio server ready`);
