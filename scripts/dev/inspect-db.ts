import { Database } from 'bun:sqlite';

const db = new Database('C:/Users/pc/.dmr-x/data.db', { readonly: true });

console.log('=== providers count ===');
const providerCount = db.query('SELECT COUNT(*) as c FROM providers').get();
console.log(providerCount);

console.log('\n=== providers schema ===');
const schema = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='providers'").get();
console.log(schema?.sql ?? 'no schema');

console.log('\n=== providers sample ===');
const rows = db.query("SELECT id, name, base_url, is_healthy, auth_method FROM providers LIMIT 25").all();
for (const r of rows as any[]) {
  console.log(JSON.stringify(r));
}

console.log('\n=== model_profiles count ===');
const mpCount = db.query('SELECT COUNT(*) as c FROM model_profiles').get();
console.log(mpCount);

console.log('\n=== model_profiles is_active breakdown ===');
const mpAct = db.query('SELECT is_active, COUNT(*) as c FROM model_profiles GROUP BY is_active').all();
for (const r of mpAct as any[]) {
  console.log(JSON.stringify(r));
}

console.log('\n=== migrations ===');
const migs = db.query("SELECT id, name, applied_at FROM migrations ORDER BY id").all();
for (const m of migs as any[]) console.log(JSON.stringify(m));

db.close();
