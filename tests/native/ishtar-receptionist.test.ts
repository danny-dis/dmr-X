import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
const db = new Database(':memory:');
mock.module('@dmr-x/db', () => ({ getDb: () => db }));
mock.module('@dmr-x/utils', () => ({ logger: { warn() {}, info() {}, error() {}, debug() {} } }));
const definitions = new Map<string, any>();
const instances = new Map<string, any>();
let pages = 0;
let lookupHook: (() => void) | undefined;
mock.module('@dmr-x/agent-registry', () => ({
 isSystemAgentName: (name: unknown) => typeof name === 'string' && name.startsWith('__'),
 agentRegistryService: {
  getDefinition: async (id: string) => { lookupHook?.(); return definitions.get(id) ?? null; },
  getInstance: async (id: string) => instances.get(id) ?? null,
  canAccessDefinition: async (id: string, tenant: string) => definitions.get(id)?.tenantId === tenant,
  listInstances: async (tenant: string, opts: any) => { pages++; const items = [...instances.values()].filter(i => i.tenantId === tenant && i.status === opts.status); return { total: items.length, items: items.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit) }; },
 }
}));
const { jobStore } = await import('../../services/agent-runtime/src/job.store.ts');
const receptionist = await import('../../services/agent-runtime/src/receptionist.ts');
const { runJobPass } = await import('../../services/agent-runtime/src/job-orchestrator.ts');
db.exec(`
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, submitted_by TEXT, source TEXT, brief TEXT,
    acceptance_criteria TEXT, status TEXT, budget_usd REAL, budget_tokens INTEGER,
    budget_duration_ms INTEGER, deadline_at TEXT, max_depth INTEGER, spent_usd REAL,
    spent_tokens INTEGER, plan TEXT, result TEXT, decision_log TEXT, pin_agents INTEGER,
    created_at TEXT, updated_at TEXT
  );
  CREATE TABLE job_tasks (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, parent_task_id TEXT, seq INTEGER, title TEXT,
    description TEXT, deliverable TEXT, acceptance TEXT, assigned_agent_def_id TEXT,
    assigned_agent_version TEXT, assigned_instance_id TEXT, session_id TEXT, assigned_model TEXT,
    status TEXT, depends_on TEXT, attempt INTEGER, max_retries INTEGER, retry_after TEXT,
    output TEXT, created_at TEXT, updated_at TEXT
  );
`);

const tenant = 'service-owner';
const ctx = { tenantId: tenant };
beforeEach(() => {
 db.exec('DELETE FROM job_tasks; DELETE FROM jobs;'); definitions.clear(); instances.clear(); pages = 0; lookupHook = undefined;
 definitions.set('worker', { id: 'worker', tenantId: tenant, name: 'worker', status: 'active' });
 instances.set('instance', { id: 'instance', tenantId: tenant, agentDefinitionId: 'worker', status: 'active', lifecycleState: 'ready', definitionName: 'worker', definitionDescription: 'typescript', definitionCategory: 'coding' });
});
afterAll(() => db.close());
function makeJob(extra: any = {}) { return jobStore.createJob({ id: crypto.randomUUID(), tenantId: tenant, source: 'api', brief: 'service test', status: 'planning', ...extra }); }
function task(jobId: string, extra: any = {}) { const created = jobStore.createTask({ id: crypto.randomUUID(), jobId, seq: 1, title: 'typescript task', ...extra }); return extra.output !== undefined ? jobStore.updateTask(tenant, created.id, { output: extra.output })! : created; }
async function rejectWithoutMutation(jobId: string, call: () => Promise<any>) {
 const before = JSON.stringify({ job: jobStore.getJob(tenant, jobId), tasks: jobStore.listTasks(tenant, jobId) });
 expect((await call()).error).toBeString();
 expect(JSON.stringify({ job: jobStore.getJob(tenant, jobId), tasks: jobStore.listTasks(tenant, jobId) })).toBe(before);
}
test('assignment stays schedulable and executes through actual runJobPass', async () => {
 const job = makeJob(); const first = task(job.id);
 expect((await receptionist.assignTask(ctx, { taskId: first.id, agentDefinitionId: 'worker', instanceId: 'instance' }) as any).status).toBe('pending');
 const calls: string[] = [];
 const result = await runJobPass(tenant, job.id, async ({ task }) => { calls.push(task.id); expect(task.assignedAgentDefId).toBe('worker'); return { ok: true, agentName: 'worker', summary: 'Implemented the requested module', costUsd: 0, tokens: 0 }; });
 expect(calls).toEqual([first.id]); expect(result.state).toBe('complete'); expect(jobStore.getJob(tenant, job.id)?.status).toBe('delivered');
});
for (const invalid of ['foreign-definition', 'self', 'foreign-instance', 'mismatch', 'paused', 'retired', 'running-task', 'verifying-job', 'cancelled-job']) {
 test(`assignment rejects ${invalid} without mutation`, async () => {
  const job = makeJob(); const first = task(job.id);
  if (invalid === 'foreign-definition') definitions.get('worker').tenantId = 'foreign';
  if (invalid === 'self') definitions.get('worker').name = '__receptionist';
  if (invalid === 'foreign-instance') instances.get('instance').tenantId = 'foreign';
  if (invalid === 'mismatch') instances.get('instance').agentDefinitionId = 'other';
  if (invalid === 'paused') instances.get('instance').status = 'paused';
  if (invalid === 'retired') instances.get('instance').lifecycleState = 'retired';
  if (invalid === 'running-task') jobStore.updateTask(tenant, first.id, { status: 'running' });
  if (invalid === 'verifying-job') jobStore.updateJobStatus(tenant, job.id, 'verifying');
  if (invalid === 'cancelled-job') jobStore.cancelJob(tenant, job.id);
  await rejectWithoutMutation(job.id, () => receptionist.assignTask(ctx, { taskId: first.id, agentDefinitionId: 'worker', instanceId: 'instance' }));
 });
}

for (const model of [undefined, 'test-model']) {
 test(`planning sends nonempty JSON body (model=${model})`, async () => {
  const job = makeJob(); const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts: any) => {
   expect(String(url)).toEndWith(`/v1/jobs/${job.id}/plan`); expect(opts.method).toBe('POST');
   expect(opts.headers['content-type']).toBe('application/json'); expect(opts.body).toBe(JSON.stringify(model ? { model } : {}));
   task(job.id); return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try { const result: any = await receptionist.jobDecompose(ctx, { jobId: job.id, model }); expect(result.error).toBeUndefined(); expect(result.tasks).toHaveLength(1); }
  finally { globalThis.fetch = original; }
 });
}

for (const output of [undefined, null, '', '   ', {}, [], { deliverable: { summary: '', artifacts: [], agent: 'worker' } }, { board: { agentName: 'worker', artifacts: [] } }]) {
 test(`delivery rejects absent substantive output ${JSON.stringify(output)}`, async () => {
  const job = makeJob(); task(job.id, { status: 'completed', output });
  expect(receptionist.verifyAcceptanceCriteria(job, jobStore.listTasks(tenant, job.id)).passed).toBe(false);
  await rejectWithoutMutation(job.id, () => receptionist.deliverJob(ctx, { jobId: job.id, verification: { passed: true, criteria: [] } }));
 });
}
test('delivery rejects empty job and incomplete task despite forged structural fields', async () => {
 const job = makeJob();
 await rejectWithoutMutation(job.id, () => receptionist.deliverJob(ctx, { jobId: job.id, verification: { passed: true, allTasksCompleted: true, missingDeliverables: [] } }));
 task(job.id, { output: 'partial' });
 await rejectWithoutMutation(job.id, () => receptionist.deliverJob(ctx, { jobId: job.id, verification: { passed: true } }));
});
const criterion = { text: 'Build module', status: 'met', evidence: 'Task output includes the built module and test receipt' };
for (const verdict of [undefined, {}, { passed: false }, { passed: 'true', criteria: [criterion] }, { passed: true, criteria: [] }, { passed: true, criteria: [criterion, criterion] }, { passed: true, criteria: [{ ...criterion, text: 'foreign' }] }, { passed: true, criteria: [{ ...criterion, evidence: '' }] }, { passed: true, criteria: [{ ...criterion, status: 'unverified' }] }, { passed: true, criteria: [{ ...criterion, evidence: 42 }] }]) {
 test(`delivery rejects invalid semantic verdict ${JSON.stringify(verdict)}`, async () => {
  const job = makeJob({ acceptanceCriteria: ['Build module'] }); task(job.id, { status: 'completed', output: { deliverable: { summary: 'Built module' } } });
  const structural = receptionist.verifyAcceptanceCriteria(job, jobStore.listTasks(tenant, job.id)); expect(structural.passed).toBe(false); expect(structural.criteria[0].status).toBe('unverified');
  await rejectWithoutMutation(job.id, () => receptionist.deliverJob(ctx, { jobId: job.id, verification: verdict }));
 });
}
test('complete criterion evidence delivers with durable authoritative structural fields', async () => {
 const job = makeJob({ acceptanceCriteria: [' Build module '] }); task(job.id, { status: 'completed', output: { deliverable: { summary: 'Built module' } } });
 const result: any = await receptionist.deliverJob(ctx, { jobId: job.id, verification: { passed: true, criteria: [criterion], allTasksCompleted: false } });
 expect(result.status).toBe('delivered'); expect((jobStore.getJob(tenant, job.id)?.result as any).passed).toBe(true); expect(result.result.allTasksCompleted).toBe(true);
});
test('criteria-free completed output delivers but supplied false is rejected', async () => {
 const job = makeJob(); task(job.id, { status: 'completed', output: 'Actual substantive result' });
 await rejectWithoutMutation(job.id, () => receptionist.deliverJob(ctx, { jobId: job.id, verification: { passed: false } }));
 expect((await receptionist.deliverJob(ctx, { jobId: job.id }) as any).status).toBe('delivered');
});

test('board includes pending task identifiers, states and outputs', async () => {
 const job = makeJob(); const first = task(job.id); const second = task(job.id, { status: 'completed', output: 'Completed work' });
 const result: any = await receptionist.readJobBoard(ctx, { jobId: job.id });
 expect(result.tasks.map((t: any) => [t.id, t.status, t.output])).toEqual([[first.id, 'pending', undefined], [second.id, 'completed', 'Completed work']]); expect(result.taskCount).toBe(2);
});
for (const status of ['cancelled', 'delivered', 'failed']) {
 for (const action of ['jobDecompose', 'requestVerification', 'escalateToHuman', 'deliverJob'] as const) {
  test(`${action} preserves terminal ${status}`, async () => {
   const job = makeJob({ status }); task(job.id, { status: 'completed', output: 'Done' });
   await rejectWithoutMutation(job.id, () => receptionist[action](ctx, { jobId: job.id }));
  });
 }
}
test('request verification rejects incomplete or outputless jobs', async () => {
 const job = makeJob(); const first = task(job.id);
 await rejectWithoutMutation(job.id, () => receptionist.requestVerification(ctx, { jobId: job.id }));
 jobStore.updateTask(tenant, first.id, { status: 'completed' });
 await rejectWithoutMutation(job.id, () => receptionist.requestVerification(ctx, { jobId: job.id }));
});

test('run_job is exposed and submits scoped assigned pending work with JSON body', async () => {
 const job=makeJob(); const first=task(job.id); await receptionist.assignTask(ctx,{taskId:first.id,agentDefinitionId:'worker',instanceId:'instance'});
 const handler=receptionist.getReceptionistToolHandlers().run_job; expect(handler).toBeFunction(); expect(receptionist.RECEPTIONIST_TOOLS.some(t=>t.name==='run_job')).toBe(true);
 const original=globalThis.fetch;globalThis.fetch=(async(url:any,opts:any)=>{expect(String(url)).toEndWith(`/v1/jobs/${job.id}/run`);expect(JSON.parse(opts.body).receptionistRun).toBe(true); expect(JSON.parse(opts.body).staffingFingerprint).toBeString();return new Response(JSON.stringify({jobId:job.id,status:'queued'}),{status:202});}) as typeof fetch;
 try{const result:any=await handler(ctx,{jobId:job.id});expect(result.status).toBe('queued');expect(jobStore.getTask(tenant,first.id)?.status).toBe('pending');}finally{globalThis.fetch=original;}
});
test('run_job refuses unassigned and cancelled work without sending a request',async()=>{
 const j=makeJob();task(j.id);const handler=receptionist.getReceptionistToolHandlers().run_job;expect(handler).toBeFunction();
 const original=globalThis.fetch;globalThis.fetch=(async()=>{throw new Error('must not request');}) as typeof fetch;
 try{expect((await handler(ctx,{jobId:j.id}) as any).error).toBeString();jobStore.cancelJob(tenant,j.id);await rejectWithoutMutation(j.id,()=>handler(ctx,{jobId:j.id}));}finally{globalThis.fetch=original;}
});


for(const mutation of ['assignment','new-task','failed','verifying']) test(`run_job rejects durable ${mutation} changes while checking agents`,async()=>{
 const j=makeJob();const t=task(j.id);await receptionist.assignTask(ctx,{taskId:t.id,agentDefinitionId:'worker',instanceId:'instance'});
 let sent=0;lookupHook=()=>{lookupHook=undefined;if(mutation==='assignment')jobStore.updateTask(tenant,t.id,{assignedAgentDefId:'foreign'});else if(mutation==='new-task')task(j.id);else jobStore.updateJobStatus(tenant,j.id,mutation as any);};
 const original=globalThis.fetch;globalThis.fetch=(async()=>{sent++;return new Response(JSON.stringify({jobId:j.id,status:'queued'}),{status:202});}) as typeof fetch;
 try{expect((await receptionist.runJob(ctx,{jobId:j.id}) as any).error).toBeString();expect(sent).toBe(0);}finally{globalThis.fetch=original;lookupHook=undefined;}
});

test('candidate search pages beyond 200 and excludes retired, system and foreign definitions', async () => {
 instances.clear();
 for (let i = 0; i < 205; i++) instances.set(`i${i}`, { id: `i${i}`, tenantId: tenant, status: 'active', lifecycleState: 'ready', agentDefinitionId: 'worker', definitionName: 'worker', definitionDescription: i === 204 ? 'typescript' : 'unrelated' });
 for (const [id, changes] of [['retired', { lifecycleState: 'retired' }], ['system', { definitionName: '__receptionist' }], ['foreign', { agentDefinitionId: 'foreign' }]] as const) instances.set(id, { ...instances.get('i204'), id, ...changes });
 definitions.set('foreign', { id: 'foreign', tenantId: 'other', name: 'foreign' });
 const result: any = await receptionist.findAgents(ctx, { task: 'typescript', limit: NaN });
 expect(result.candidates.map((c: any) => c.instanceId)).toEqual(['i204']); expect(pages).toBe(2);
});
