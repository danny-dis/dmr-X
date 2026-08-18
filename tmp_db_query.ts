const { getDb } = await import('C:/Users/pc/Documents/projects/DMR-X/packages/db/src/client.ts');
const db = getDb();
const rows = db.prepare("SELECT provider_id, model_id FROM model_profiles WHERE provider_id IN ('480eb619-4b41-4f3e-9315-f6feda6d7275','6eff3a27-cff0-4da2-ba94-7dcec86a2f13')").all();
console.log(JSON.stringify(rows, null, 2));
