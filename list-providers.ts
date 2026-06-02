import { Database } from 'bun:sqlite';
const db = new Database('C:/Users/pc/.dmr-x/data.db');
const providers = db.query('SELECT name, base_url, is_active FROM providers').all();
console.log(JSON.stringify(providers, null, 2));
