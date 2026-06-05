import { Database } from 'bun:sqlite';
const db = new Database('C:/Users/pc/.dmr-x/data.db');
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);
for (const table of tables) {
  const schema = db.query(`PRAGMA table_info(${table.name})`).all();
  console.log(`Schema for ${table.name}:`, schema);
}
