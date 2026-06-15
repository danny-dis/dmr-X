// Quick test to verify the createServer return type mismatch
import { initDb } from '@dmr-x/db';
await initDb();

const mod = await import('../../apps/gateway/src/server.js');
const result = await mod.createServer();
console.log('createServer returned:', Object.keys(result));
console.log('Has .listen?', typeof (result as any).listen);
console.log('Has .server?', typeof (result as any).server);
console.log('Has .runBackgroundInit?', typeof (result as any).runBackgroundInit);
process.exit(0);
