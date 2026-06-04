import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function check() {
  const dbPath = path.join(os.homedir(), '.dmr-x', 'data.db');
  console.log('Database path:', dbPath);
  console.log('Exists:', fs.existsSync(dbPath));
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log('Size:', stats.size, 'bytes');
    console.log('Last modified:', stats.mtime);
  }
}
check();
