import { initDb, getDb, closeDb } from '@dmr-x/db';

async function testFlow() {
  console.log('--- Step 1: Open and write ---');
  let dbWrapper = await initDb();
  let db = getDb();
  
  // Create table if not exists (just a test table)
  db.exec('CREATE TABLE IF NOT EXISTS test_save (id TEXT PRIMARY KEY, value TEXT)');
  
  // Insert value
  db.prepare('INSERT OR REPLACE INTO test_save (id, value) VALUES (?, ?)').run('test_id', 'test_value');
  
  // Read in memory
  const rowsInMemory = db.prepare('SELECT * FROM test_save').all();
  console.log('Rows in memory before close:', rowsInMemory);
  
  // Close and flush to disk
  await closeDb();
  console.log('Database closed.');
  
  console.log('\n--- Step 2: Reopen and read ---');
  dbWrapper = await initDb();
  db = getDb();
  
  const rowsFromDisk = db.prepare('SELECT * FROM test_save').all();
  console.log('Rows loaded from disk after reopen:', rowsFromDisk);
  
  await closeDb();
}

testFlow().catch(console.error);
