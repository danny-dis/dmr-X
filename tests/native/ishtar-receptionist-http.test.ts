import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import Fastify from 'fastify';
const db = new Database(':memory:');
mock.module('@dmr-x/db', () => ({ getDb: () => db }));
mock.module('@dmr-x/utils', () => ({ logger: { warn() {}, info() {}, error() {}, debug() {} } }));
mock.module('@dmr-x/agent-registry', () => ({ agentRegistryService: {listInstances: async()=>({items:[],total:0}),getDefinition:async(id:string)=>({id,tenantId:'receptionist-http',name:'worker'}),getInstance:async(id:string)=>({id,tenantId:'receptionist-http',agentDefinitionId:'worker',status:'active',lifecycleState:'ready'})}, isSystemAgentName: (name: string)=> name?.startsWith('__') }));
const { jobStore } = await import('../../services/agent-runtime/src/job.store.ts');
const receptionist = await import('../../services/agent-runtime/src/receptionist.ts');
const { readBoard } = await import('../../services/agent-runtime/src/job-board.ts');
const { runJobPass, subscribeToJobEvents } = await import('../../services/agent-runtime/src/job-orchestrator.ts');
mock.module('@dmr-x/agent-runtime',()=>({jobStore,readBoard,...receptionist,subscribeToJobEvents}));
mock.module(new URL('../../apps/gateway/src/lib/job-runner.ts',import.meta.url).href,()=>({planJob: async()=>({ok:false,error:'not called'})}));
mock.module(new URL('../../apps/gateway/src/lib/job-queue.ts',import.meta.url).href,()=>({jobQueue:{stats:()=>({active:0,queued:0}),dequeue(){},enqueue:()=>({accepted:true,position:0})}}));
mock.module(new URL('../../apps/gateway/src/middleware/agent-rbac.middleware.ts',import.meta.url).href,()=>({agentPermissions:{create:()=>async()=>{},read:()=>async()=>{},update:()=>async()=>{}}}));
const { registerJobRoutes } = await import('../../apps/gateway/src/routes/job.routes.ts');
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

const tenant='receptionist-http';
beforeEach(()=>db.exec('DELETE FROM job_tasks; DELETE FROM jobs;'));
afterAll(()=>db.close());
function job(criteria: string[]=[]){return jobStore.createJob({id:crypto.randomUUID(),tenantId:tenant,source:'api',brief:'bounded test',acceptanceCriteria:criteria});}
function task(j:any,status='pending',output?:any){const t=jobStore.createTask({id:crypto.randomUUID(),jobId:j.id,seq:1,title:'test task'});return jobStore.updateTask(tenant,t.id,{status:status as any,...(output===undefined?{}:{output})});}
async function request(j:any,path:string,body:any={}){const app=Fastify();app.addHook('onRequest',async(req)=>{(req as any).tenant={id:tenant};});registerJobRoutes(app);try{return await app.inject({method:'POST',url:`/jobs/${j.id}/${path}`,payload:body});}finally{await app.close();}}
test('HTTP refuses to deliver empty unexecuted job',async()=>{const j=job(['Produce proof']);const response=await request(j,'deliver',{passed:true});expect(response.statusCode).toBe(422);expect(jobStore.getJob(tenant,j.id)?.status).toBe('intake');});
test('HTTP cannot deliver completed task with false verification',async()=>{const j=job(['Produce proof']);task(j,'completed',{summary:'proof'});const response=await request(j,'deliver',{passed:false,criteria:[{text:'Produce proof',status:'unmet',evidence:'bad'}]});expect(response.statusCode).toBe(422);expect(jobStore.getJob(tenant,j.id)?.status).not.toBe('delivered');});
test('HTTP accepts complete output with explicit full evidence',async()=>{const j=job(['Produce proof']);task(j,'completed',{summary:'proof'});const response=await request(j,'deliver',{passed:true,criteria:[{text:'Produce proof',status:'met',evidence:'Observed task output summary proof'}]});expect(response.statusCode).toBe(200);expect(jobStore.getJob(tenant,j.id)?.status).toBe('delivered');});
test('HTTP rejects verification transition before any task output',async()=>{const j=job();const response=await request(j,'verify');expect(response.statusCode).toBe(422);expect(jobStore.getJob(tenant,j.id)?.status).toBe('intake');});
test('HTTP does not escalate a delivered job',async()=>{const j=job();jobStore.updateJobStatus(tenant,j.id,'delivered');const response=await request(j,'escalate',{reason:'not valid'});expect(response.statusCode).toBe(409);expect(jobStore.getJob(tenant,j.id)?.status).toBe('delivered');});
test('automatic completed tasks with semantic criteria wait for verification',async()=>{const j=job(['Must contain proof']);task(j);const r=await runJobPass(tenant,j.id,async()=>({ok:true,agentName:'worker',summary:'proof'}));expect(r.state).toBe('complete');expect(jobStore.getJob(tenant,j.id)?.status).toBe('verifying');expect(jobStore.getJob(tenant,j.id)?.result).toMatchObject({passed:false});});
test('criterion-free job with completed output can deliver automatically',async()=>{const j=job();task(j);await runJobPass(tenant,j.id,async()=>({ok:true,agentName:'worker',summary:'proof'}));expect(jobStore.getJob(tenant,j.id)?.status).toBe('delivered');});

test('HTTP enqueue rejects forged staffing fingerprint',async()=>{const j=job();const t=task(j);jobStore.updateTask(tenant,t!.id,{assignedAgentDefId:'worker',assignedInstanceId:'instance'});const response=await request(j,'run',{receptionistRun:true,staffingFingerprint:'forged'});expect(response.statusCode).toBe(409);});
test('HTTP enqueue accepts exactly validated current staffing fingerprint',async()=>{const j=job();const t=task(j);jobStore.updateTask(tenant,t!.id,{assignedAgentDefId:'worker',assignedInstanceId:'instance'});const eligible=await receptionist.validateReceptionistRun({tenantId:tenant},j.id);const response=await request(j,'run',{receptionistRun:true,staffingFingerprint:eligible.fingerprint});expect(response.statusCode).toBe(202);});

test('automatic empty output never claims verified delivery',async()=>{const j=job(['Produce proof']);task(j);await runJobPass(tenant,j.id,async()=>({ok:true,agentName:'worker',summary:''}));expect(jobStore.getJob(tenant,j.id)?.status).not.toBe('delivered');});
