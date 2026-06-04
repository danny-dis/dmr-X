import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function test() {
  const dbPath = path.join(os.homedir(), '.dmr-x', 'data.db');
  console.log('Path:', dbPath);
  
  const stats = fs.statSync(dbPath);
  console.log('fs.statSync size:', stats.size, 'bytes');
  
  const buffer = fs.readFileSync(dbPath);
  console.log('fs.readFileSync length:', buffer.length, 'bytes');
}
test();
