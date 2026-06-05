import { Database } from 'bun:sqlite';
const db = new Database('C:/Users/pc/.dmr-x/data.db');
const keys = db.query('SELECT ak.id, t.name as tenant_name FROM api_keys ak JOIN tenants t ON t.id = ak.tenant_id WHERE ak.is_active = 1').all();
console.log(JSON.stringify(keys, null, 2));
