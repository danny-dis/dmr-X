import { initDb, getDb } from '@dmr-x/db';
import { hashApiKey } from '@dmr-x/utils';

async function inspect() {
  await initDb();
  const db = getDb();
  
  const keys = db.prepare('SELECT * FROM api_keys').all();
  console.log('Keys in Database:');
  for (const k of keys) {
    console.log(`- ID: ${k.id}`);
    console.log(`  Tenant ID: ${k.tenant_id}`);
    console.log(`  Name: ${k.name}`);
    console.log(`  Hash in DB: ${k.key_hash}`);
    console.log(`  Is Active: ${k.is_active}`);
  }
  
  const testKey = 'dmrx_key_4cb4ec20e746fcffcb59b9bb8a0b6ea7';
  const hashedTest = hashApiKey(testKey);
  console.log(`\nManual hash of 'dmrx_key_4cb4ec20e746fcffcb59b9bb8a0b6ea7':`);
  console.log(`  Hash: ${hashedTest}`);
}

inspect().catch(console.error);
