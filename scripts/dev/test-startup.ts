// Quick diagnostic: trace which startup step hangs
import { createServer } from '../../apps/gateway/src/server.js';

const start = Date.now();
const log = (msg: string) => console.log(`[${Date.now() - start}ms] ${msg}`);

log('Starting createServer()...');
try {
  const server = await createServer();
  log('createServer() completed');
  
  const port = Number(process.env.PORT || 3000);
  await server.listen({ port, host: '0.0.0.0' });
  log(`Listening on port ${port}`);
  
  // Health check
  const resp = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await resp.json();
  log(`Health: ${JSON.stringify(body)}`);
  
  await server.close();
  log('Done');
  process.exit(0);
} catch (err) {
  log(`ERROR: ${err}`);
  process.exit(1);
}
