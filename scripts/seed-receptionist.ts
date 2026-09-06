/**
 * Seed the __receptionist system agent definition if not present.
 * Run with: bun run scripts/seed-receptionist.ts
 */
import { initDb, getDb } from '@dmr-x/db';

await initDb();

const tenantId = 'local';
const db = getDb();

// Check if __receptionist already exists
const existing = db.prepare(
  'SELECT id FROM agent_definitions WHERE tenant_id = ? AND name = ?'
).get(tenantId, '__receptionist') as any;

if (existing) {
  console.log('__receptionist already exists:', existing.id);
  process.exit(0);
}

const id = crypto.randomUUID();
const now = new Date().toISOString();

db.prepare(`
  INSERT INTO agent_definitions (
    id, tenant_id, name, description, human_name, version,
    system_prompt, preferred_model, model_tier, allowed_tools,
    custom_tools, workflow, triggers, visibility, tags, category,
    icon, skills, skill_nudge_interval, verify_on_stop,
    plan_mode, history_compaction, compaction_threshold,
    compaction_keep_recent, godmode_wrap, capabilities,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  id,
  tenantId,
  '__receptionist',
  'System coordinator for multi-agent job delegation. Decomposes jobs into tasks, assigns them to the best-matching agents, tracks progress on the job board, verifies deliverables against acceptance criteria, and escalates stuck work to humans.',
  'Receptionist',
  '1.0.0',
  `You are the DMR-X Receptionist — a meta-agent coordinator for multi-agent jobs.

A job arrives as a brief. Your job is to:
1. DECOMPOSE the brief into a task list (use job_decompose)
2. For each task, FIND the best-matching active agent (use find_agents)
3. ASSIGN each task to its best-matched agent (use assign_task)
4. After all tasks are assigned, RUN the job (this happens automatically when you call run_job)
5. MONITOR progress by reading the job board (use read_job_board)
6. When tasks complete, REQUEST verification (use request_verification)
7. If verification passes, DELIVER the job (use deliver_job)
8. If no agent matches a task or the job is stuck, ESCALATE to a human (use escalate_to_human)

Always record your reasoning in the decision log. You are thin — you decompose and route, you do not do domain work.
Never assign yourself to a task. You coordinate; agents execute.`,
  null,
  'auto',
  JSON.stringify(['job_decompose', 'find_agents', 'assign_task', 'read_job_board', 'request_verification', 'deliver_job', 'escalate_to_human']),
  JSON.stringify([]),
  null,
  JSON.stringify([]),
  'team',
  JSON.stringify(['system', 'coordinator', 'multi-agent']),
  'Project Management',
  'Briefcase',
  JSON.stringify([]),
  8,
  0,
  1,
  0,
  null,
  null,
  0,
  JSON.stringify({
    domains: ['orchestration', 'coordination', 'multi-agent-systems'],
    deliverables: ['coordinated-outcome', 'task-assignment', 'verification-report'],
    languages: ['en'],
    seniority: 'principal',
    summary: 'Meta-agent that coordinates multi-agent jobs: decomposes briefs, matches tasks to agents, verifies outcomes, escalates failures.',
    accepts: ['delegate', 'coordinate', 'verify', 'escalate'],
  }),
  now,
  now,
);

console.log('__receptionist agent created:', id);
