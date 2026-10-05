import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit argument is the Pi agent CONFIG directory, not the project directory.
const agentDir = process.argv[2] ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
const sourceDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(agentDir, 'extensions', 'pi-dmrx-mcp');
const stamp = new Date().toISOString().replaceAll(':', '-');
const backupDir = join(agentDir, '.backups', `pi-dmrx-mcp-${stamp}`);
await mkdir(extensionDir, { recursive: true });
const files = [];
for (const name of ['index.ts', 'mcp-client.ts']) {
  const source = join(sourceDir, name);
  const target = join(extensionDir, name);
  const newBytes = await readFile(source);
  let oldBytes;
  try { oldBytes = await readFile(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (oldBytes?.equals(newBytes)) {
    files.push({ name, changed: false });
    continue;
  }
  let backup;
  if (oldBytes) {
    await mkdir(backupDir, { recursive: true });
    backup = join(backupDir, name);
    await copyFile(target, backup);
  }
  await copyFile(source, target);
  files.push({ name, changed: true, backup });
}
console.log(JSON.stringify({ agentDir, extensionDir, files, untouched: ['models.json', 'settings.json', 'auth.json'] }, null, 2));
