import { getDb } from '@dmr-x/db';

const db = getDb();

try {
  const row = db.prepare('SELECT COUNT(*) as count FROM agent_evaluations').get();
  console.log('Evaluation count:', row?.count ?? 0);

  const latest = db.prepare('SELECT * FROM agent_evaluations ORDER BY created_at DESC LIMIT 1').get();
  console.log('Latest:', JSON.stringify(latest, null, 2) ?? 'none');
} catch (err) {
  console.error('Error:', err);
}
