import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
const sqlite=new Database(':memory:');
const db={prepare:(s:string)=>sqlite.prepare(s),transaction:<T>(fn:()=>T):T=>sqlite.transaction(fn)()};
mock.module('@dmr-x/db',()=>({getDb:()=>db}));
mock.module('@dmr-x/utils',()=>({logger:{info(){},warn(){},error(){},debug(){}}}));
const {jobStore}=await import('../../services/agent-runtime/src/job.store.ts');
const {materializePlan,buildPlanPrompt,parsePlanResponse}=await import('../../services/agent-runtime/src/job-planner.ts');
mock.module('@dmr-x/agent-runtime',()=>({jobStore,materializePlan,buildPlanPrompt,parsePlanResponse,runJobPass(){throw Error('not allowed');}}));
const {planJob}=await import('../../apps/gateway/src/lib/job-runner.ts');
sqlite.exec(`
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
const tenant='planning-owner';
const plan=[{ref:'one',title:'one',description:'one',dependsOn:[]}];
const originalFetch=globalThis.fetch;
beforeEach(()=>{sqlite.exec('DELETE FROM job_tasks;DELETE FROM jobs;');globalThis.fetch=originalFetch;});
afterAll(()=>{globalThis.fetch=originalFetch;sqlite.close();});
function job(status:any='intake'){return jobStore.createJob({id:crypto.randomUUID(),tenantId:tenant,source:'api',brief:'one task',status});}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function fetchFixture(model:()=>Promise<Response>){globalThis.fetch=(async(input:any)=>String(input).includes('/chat/completions')?model():Response.json({items:[],total:0})) as any;}
const response=()=>Response.json({model:'free-fixture',choices:[{message:{content:JSON.stringify({tasks:plan})}}]});
test('one plan only, duplicate materialization is rejected atomically',()=>{const j=job();materializePlan(tenant,j.id,plan);expect(()=>materializePlan(tenant,j.id,plan)).toThrow();expect(jobStore.listTasks(tenant,j.id)).toHaveLength(1);});
test.each(['cancelled','delivered','verifying','blocked','running'])('cannot materialize on terminal/executing state %s',(status)=>{const j=job(status);expect(()=>materializePlan(tenant,j.id,plan)).toThrow();expect(jobStore.listTasks(tenant,j.id)).toHaveLength(0);expect(jobStore.getJob(tenant,j.id)?.status).toBe(status);});
test('wrong tenant materialization leaves owner untouched',()=>{const j=job();expect(()=>materializePlan('foreign',j.id,plan)).toThrow();expect(jobStore.listTasks(tenant,j.id)).toHaveLength(0);});
test('overlapping plan calls admit exactly one model operation',async()=>{const j=job();const started=deferred<void>();const wait=deferred<Response>();let count=0;fetchFixture(async()=>{count++;started.resolve();return wait.promise;});const first=planJob(tenant,j.id,{model:'free-agentic'});await started.promise;const second=planJob(tenant,j.id,{model:'free-agentic'});wait.resolve(response());const results=await Promise.all([first,second]);expect(count).toBe(1);expect(results.filter(x=>x.ok)).toHaveLength(1);expect(jobStore.listTasks(tenant,j.id)).toHaveLength(1);expect(jobStore.getJob(tenant,j.id)?.status).toBe('planning');});
test('cancellation during provider wait commits no tasks and cannot revive job',async()=>{const j=job();const started=deferred<void>();const wait=deferred<Response>();fetchFixture(async()=>{started.resolve();return wait.promise;});const pending=planJob(tenant,j.id,{model:'free-agentic'});await started.promise;jobStore.cancelJob(tenant,j.id);wait.resolve(response());expect((await pending).ok).toBe(false);expect(jobStore.getJob(tenant,j.id)?.status).toBe('cancelled');expect(jobStore.listTasks(tenant,j.id)).toHaveLength(0);});
test('failed provider leaves a retryable failed draft, then a real plan stays not running',async()=>{const j=job();fetchFixture(async()=>Response.json({error:{message:'unavailable'}},{status:503}));expect((await planJob(tenant,j.id,{model:'free-agentic'})).ok).toBe(false);expect(jobStore.getJob(tenant,j.id)?.status).toBe('failed');fetchFixture(async()=>response());expect((await planJob(tenant,j.id,{model:'free-agentic'})).ok).toBe(true);expect(jobStore.getJob(tenant,j.id)?.status).toBe('planning');});
