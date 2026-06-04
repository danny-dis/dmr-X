import { initDb, getDb, closeDb } from '@dmr-x/db';
import { hashApiKey } from '@dmr-x/utils';
import crypto from 'node:crypto';

async function checkAndCreateKey() {
  await initDb();
  const db = getDb();
  
  // List tenants
  const tenants = db.prepare('SELECT * FROM tenants').all();
  console.log('Tenants:', tenants);
  
  if (tenants.length === 0) {
    console.log('No tenants found, creating default...');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(id, 'default');
    tenants.push({ id, name: 'default' });
  }
  
  const tenant = tenants[0];
  
  // Check api_keys
  const keys = db.prepare('SELECT * FROM api_keys').all();
  console.log('Existing API Keys:', keys.map(k => ({ id: k.id, tenant_id: k.tenant_id, is_active: k.is_active, last_used_at: k.last_used_at })));
  
  if (keys.length === 0) {
    console.log('No API keys found, generating a test key...');
    const rawKey = 'dmrx_key_4cb4ec20e746fcffcb59b9bb8a0b6ea7';
    const hashed = hashApiKey(rawKey);
    const keyId = crypto.randomUUID();
    db.prepare('INSERT INTO api_keys (id, tenant_id, name, key_hash, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(keyId, tenant.id, 'test-key', hashed);
    console.log('\n--- NEW TEST API KEY GENERATED ---');
    console.log('Use this key for request Authorization headers:');
    console.log(`Bearer ${rawKey}`);
    console.log('----------------------------------\n');
  } else {
    const rawKey = 'dmrx_key_' + crypto.randomBytes(16).toString('hex');
    const hashed = hashApiKey(rawKey);
    const keyId = crypto.randomUUID();
    db.prepare('INSERT INTO api_keys (id, tenant_id, name, key_hash, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(keyId, tenant.id, 'temp-test-key', hashed);
    console.log('\n--- TEMPORARY TEST API KEY GENERATED ---');
    console.log('Use this key for request Authorization headers:');
    console.log(`Bearer ${rawKey}`);
    console.log('----------------------------------\n');
  }

  // MUST CLOSE DATABASE TO FLUSH WRITES TO DISK (WASM memory -> disk file)
  await closeDb();
  console.log('Database connection closed and flushed.');
}

checkAndCreateKey().catch(console.error);
