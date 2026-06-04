import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function inspectRaw() {
  const dbPath = path.join(os.homedir(), '.dmr-x', 'data.db');
  console.log('Reading database from:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database file does not exist.');
    return;
  }
  
  const buffer = fs.readFileSync(dbPath);
  console.log('Buffer size:', buffer.length, 'bytes');
  
  const SQL = await initSqlJs();
  const db = new SQL.Database(buffer);
  
  // List all tables
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  if (result.length > 0 && result[0].values) {
    console.log('Tables in database file:');
    for (const row of result[0].values) {
      console.log(`- ${row[0]}`);
    }
  } else {
    console.log('No tables found in database file.');
  }
  
  db.close();
}

inspectRaw().catch(console.error);
