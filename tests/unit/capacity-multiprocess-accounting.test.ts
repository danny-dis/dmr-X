import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapacityReservation } from '../../services/quota/src/capacity-manager.js';
const directory = mkdtempSync(join(tmpdir(), 'dmrx-capacity-accounting-'));
const previous = process.env.DMRX_DATA_DIR;
let closeDb: typeof import('@dmr-x/db').closeDb;
let Store: typeof import('../../services/quota/src/capacity-store-distributed.js').SQLiteCapacityStore;
beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  const database = await import('@dmr-x/db');
  closeDb = database.closeDb;
  await database.initDb();
  database.getDb().exec(`CREATE TABLE IF NOT EXISTS capacity_reservations (
    reservation_id TEXT NOT NULL, unit TEXT NOT NULL, scope_id TEXT NOT NULL,
    amount REAL NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, committed_at INTEGER,
    PRIMARY KEY(reservation_id,unit,scope_id))`);
  Store = (await import('../../services/quota/src/capacity-store-distributed.js')).SQLiteCapacityStore;
},90000);
afterAll(async () => {
  await closeDb?.();
  if(previous === undefined) delete process.env.DMRX_DATA_DIR; else process.env.DMRX_DATA_DIR = previous;
});
const dimension = {unit:'total_tokens' as const, scopeId:'capacity-accounting-pool', amount:10, currentRemaining:10};
function reservation(id:string):CapacityReservation {
  return {id,candidateId:'fixture',dimensions:[{unit:dimension.unit,scopeId:dimension.scopeId,reserved:10}],expiresAt:Date.now()+30000,createdAt:Date.now(),status:'reserved'};
}
describe('durable shared capacity accounting', () => {
  it('renews an active lease before its original expiry', async () => {
    const store = new Store();
    const dimension = { unit:'concurrency' as const,scopeId:'capacity-renew-pool',amount:1,currentRemaining:1 };
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(await store.tryReserve([dimension], 'capacity-renew', 10)).not.toBeNull();
      clock.mockReturnValue(now + 5);
      expect(await store.renew('capacity-renew',10000)).toBe(true);
      clock.mockReturnValue(now + 11);
      expect(await new Store().tryReserve([dimension], 'capacity-renew-contender')).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
  it('retains actual token consumption when another connection has the old quota snapshot', async () => {
    const store = new Store();
    expect(await store.tryReserve([dimension], 'capacity-first')).not.toBeNull();
    await store.commit(reservation('capacity-first'),{requests:1,inputTokens:2,outputTokens:2,concurrency:0});
    expect(await new Store().tryReserve([{...dimension,amount:7}], 'capacity-second')).toBeNull();
    expect(await new Store().tryReserve([{...dimension,amount:6}], 'capacity-third')).not.toBeNull();
  });
  it('exposes registered capacity without leaking a mutable vector reference', async () => {
    const { CapacityManager } = await import('../../services/quota/src/capacity-manager.js');
    const { buildVector, buildDimension } = await import('../../services/quota/src/quota-vector.js');
    const manager = new CapacityManager({store:new Store()});
    const vector = buildVector({providerId:'lookup-provider',modelId:'lookup-model',keyId:'lookup-key',dimensions:[buildDimension({unit:'concurrency',scope:'model',scopeId:'lookup-key',limit:3,remaining:3,source:'config',confidence:1})]});
    manager.registerVector(vector);
    const copy = manager.getVector?.('lookup-provider','lookup-model','lookup-key');
    expect(copy).toEqual(vector);
    copy!.dimensions[0]!.remaining = 100;
    expect(manager.getVector('lookup-provider','lookup-model','lookup-key')!.dimensions[0]!.remaining).toBe(3);
  });

  it('applies a fresh provider observation without reviving an older snapshot', async () => {
    const { CapacityManager } = await import('../../services/quota/src/capacity-manager.js');
    const { buildDimension, buildVector } = await import('../../services/quota/src/quota-vector.js');
    const manager = new CapacityManager({store:new Store(),estimateDemand:()=>({requests:1,inputTokens:0,outputTokens:7,concurrency:1})});
    const observedAtMs=Date.now();
    const vector=(remaining:number,observed:number)=>buildVector({providerId:'observed-provider',modelId:'m',keyId:'k',poolId:'observed-pool',dimensions:[buildDimension({unit:'total_tokens',scope:'account',scopeId:'observed',limit:10,remaining,state:'available',confidence:1,observedAtMs:observed,staleAfterMs:Infinity})]});
    manager.registerVector(vector(10,observedAtMs));
    const first=await manager.reserve('observed-provider','m','k',{});
    expect(first.success).toBe(true);
    await manager.commit(first.reservation!.id,{requests:1,inputTokens:1,outputTokens:3,concurrency:0});
    manager.registerVector(vector(9,observedAtMs+1));
    const fresh=await manager.reserve('observed-provider','m','k',{});
    expect(fresh.success).toBe(true);
    await manager.release(fresh.reservation!.id);
    manager.registerVector(vector(10,observedAtMs));
    const stale=await manager.reserve('observed-provider','m','k',{});
    expect(stale.success).toBe(true);
    await manager.commit(stale.reservation!.id,{requests:1,inputTokens:4,outputTokens:4,concurrency:0});
    expect((await manager.reserve('observed-provider','m','k',{})).success).toBe(false);
  });
  it('admits no more than three simultaneous upstream calls from eight OS processes', async () => {
    closeDb(); // Flush initialization before other processes open the physical file.
    const barrier = mkdtempSync(join(tmpdir(), 'dmrx-capacity-barrier-'));
    const tsconfig = join(barrier, 'tsconfig.json');
    writeFileSync(tsconfig, JSON.stringify({compilerOptions:{baseUrl:process.cwd(),paths:{'@dmr-x/db':['packages/db/src/index.ts'],'@dmr-x/utils':['packages/utils/src/index.ts']}}}));
    const children = Array.from({length:8},(_,i)=>{
      const id = `actor-${i}`;
      const child = spawn('bun',['--tsconfig-override',tsconfig,'tests/fixtures/sqlite-capacity-worker.ts',directory,barrier,id],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
      let output = '';
      child.stdout.on('data',d=>{output+=String(d);});
      child.stderr.on('data',d=>{output+=String(d);});
      const done = new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
      return {id,child,done,output:()=>output};
    });
    try {
      const deadline = Date.now()+90000;
      while (!children.every(c=>existsSync(join(barrier,`${c.id}.ready.json`)))) {
        if (Date.now()>deadline || children.some(c=>c.child.exitCode!==null)) throw new Error(children.map(c=>c.output()).join('\n').slice(-5000));
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      const admitted = children.map(c=>JSON.parse(readFileSync(join(barrier,`${c.id}.ready.json`),'utf8')) as {admitted:boolean}).filter(c=>c.admitted).length;
      expect(admitted).toBe(3);
      writeFileSync(join(barrier,'release'),'release');
      expect(await Promise.all(children.map(c=>c.done))).toEqual(Array(8).fill(0));
      expect(children.filter(c=>JSON.parse(readFileSync(join(barrier,`${c.id}.finished.json`),'utf8')).released).length).toBe(3);
    } finally {
      writeFileSync(join(barrier,'release'),'release');
      for (const c of children) if (c.child.exitCode===null) c.child.kill();
    }
  },120000);
});
