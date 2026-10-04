import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Router } from '../../services/router/src/router.service.ts';
import { EligibilityEngine } from '../../services/router/src/eligibility/eligibility-engine.ts';
import { resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.ts';
import { inferPricingTier, getProviderTemplate } from '../../packages/provider-catalog/src/index.ts';
import { CapacityManager, InMemoryCapacityStore } from '../../services/quota/src/capacity-manager.ts';
import { evaluateVector } from '../../services/quota/src/quota-vector.ts';
import { chatRoutes } from '../../apps/gateway/src/routes/chat.routes.ts';
const candidate=(providerId:string,modelId:string, extra:any={})=>({providerId,providerName:providerId,modelId,modality:'llm',intelligenceLayer:'executor',capabilityTier:'executor',capabilities:['streaming','tool_use'],contextLength:128000,costPerInputToken:0,costPerOutputToken:0,avgLatencyMs:10,qualityScore:0.9,isHealthy:true,...extra});
const free=candidate('free-provider','free-model',{pricingTier:'free'});
const response=(providerId:string,modelId:string)=>({providerId,modelId,modality:'llm',requestId:'review',latencyMs:1,message:{role:'assistant',content:'offline response'}});
const request=(model:string, metadata:any={})=>({model,modality:'llm',stream:false,messages:[{role:'user',content:'Hello'}],metadata});
const options={path:'/v1/chat/completions',qualityTarget:'balanced' as const};
afterEach(()=>{delete process.env.DMRX_DEGRADED_MODEL;resetModelErrorCache();});
describe('Independent free-policy safety probes (offline mocked executors)',()=>{
 it.each(['request','router-default','cost-default'])('direct route must not execute paid degraded target: %s',async(mode)=>{
  process.env.DMRX_DEGRADED_MODEL='paid-provider/paid-model';
  const config:any={enableDecomposition:false};
  if(mode==='router-default') config.freeTierStrategy='free_only';
  if(mode==='cost-default') config.metaModelCostFilter='free';
  const router=new Router(config);router.setCandidates([free]);
  const calls:string[]=[];
  router.setAdapterExecutor({execute:async(p,m)=>{calls.push(p);if(p==='paid-provider')return response(p,m) as any;throw new Error('upstream down');}});
  await router.route(request('free-model',mode==='request'?{freeTierStrategy:'free_only'}:{}) as any,options).catch(()=>null);
  console.log('direct '+mode+' calls='+JSON.stringify(calls));
  expect(calls).not.toContain('paid-provider');
 });
 it('stream free_only must not augment plan with paid global candidates',async()=>{
  const app=Fastify({logger:false});const calls:string[]=[];
  app.decorate('router',{getEffectiveCostFilter:()=> 'all',route:async()=>({plan:{primary:{providerId:'free-provider',modelId:'free-model',score:1},chain:[],timeoutMs:30000,maxRetries:1}}),getCandidates:()=>[free,candidate('paid-provider','paid-model',{pricingTier:'paid'})]});
  app.decorate('getAdapter',(p:string)=>({executeStream:async function*(){calls.push(p);if(p==='free-provider')throw new Error('down');yield {type:'token',data:{content:'paid response'}};yield {type:'done'};}}));
  await app.register(chatRoutes);
  try{await app.inject({method:'POST',url:'/chat/completions',headers:{'x-free-tier-strategy':'free_only'},payload:{model:'auto',messages:[{role:'user',content:'Hello'}],stream:true}});console.log('stream calls='+JSON.stringify(calls));expect(calls).not.toContain('paid-provider');}finally{await app.close();}
 });
 it.each(['alias','default'])('unknown zero-price must not enter free-only plan: %s',async(mode)=>{
  const router=new Router({enableDecomposition:false,...(mode==='default'?{metaModelCostFilter:'free' as const}:{})});
  router.setCandidates([candidate('unknown-provider','unpriced-model',{pricingTier:'unknown'})]);router.setAdapterExecutor({execute:async()=>{throw Error('plan only')}});
  const result=await router.route(request(mode==='alias'?'free':'unpriced-model') as any,{...options,planOnly:true}).catch(()=>null);
  console.log('unknown '+mode+' plan='+JSON.stringify(result?.plan));expect(result).toBeNull();
 });
 it('provider-level free tier must not authorize unmarked mixed-aggregator model',async()=>{
  const router=new Router({enableDecomposition:false,freeTierStrategy:'free_only'});
  router.setCandidates([candidate('tokenrouter','paid-unmarked-model',{pricingTier:'free_with_limits'})]);router.setAdapterExecutor({execute:async()=>{throw Error('plan only')}});
  const result=await router.route(request('tokenrouter/paid-unmarked-model') as any,{...options,planOnly:true}).catch(()=>null);
  console.log('mixed tier plan='+JSON.stringify(result?.plan));expect(result).toBeNull();
 });
 it('composite direct route must honor router free cost default',async()=>{
  const router=new Router({enableDecomposition:true,decompositionThreshold:1,metaModelCostFilter:'free'});
  router.setCandidates([candidate('paid-provider','paid-model',{pricingTier:'paid'})]);
  const calls:string[]=[];router.setAdapterExecutor({execute:async(p,m)=>{calls.push(p);return response(p,m) as any;}});
  const req=request('paid-model');req.messages[0].content='Build frontend and backend services with database and API';
  await router.route(req as any,options).catch(()=>null);console.log('composite calls='+JSON.stringify(calls));expect(calls).not.toContain('paid-provider');
 });
 it('trial templates must not grant unconditional free tier before enrollment/expiry checks',()=>{
  const model=getProviderTemplate('zai-coding')!.models[0];console.log('trial pricing='+model.pricingTier+' trialDays='+model.freeTier!.trialDays);
  expect(inferPricingTier(model)).not.toBe('free');
 });
 it('strict catalog-backed eligibility must veto subscription-only candidates',()=>{
  const engine=new EligibilityEngine({freeOnly:true,strictFree:true},{checkEligibility:()=>({eligible:true,reason:'free'})});
  const result=engine.filter([candidate('subscription-provider','subscription-model',{pricingTier:'subscription_only'})] as any);
  console.log('subscription eligible='+result.eligible.length);expect(result.eligible).toHaveLength(0);
 });
 it('new seconds quota must block admission when exhausted',()=>{
  const now=Date.now();const dim=(unit:string,remaining:number)=>({unit,scope:'account',scopeId:'pool',limit:100,remaining,replenishment:'fixed_window',resetAtMs:now+60000,state:remaining===0?'exhausted':'available',confidence:1,observedAtMs:now,staleAfterMs:60000});
  const snapshot=evaluateVector({providerId:'p',modelId:'m',keyId:'k',dimensions:[dim('requests',10),dim('seconds',0)],lastObservedAtMs:now} as any,{requests:1,inputTokens:0,outputTokens:0,concurrency:0,seconds:1});
  console.log('seconds admissible='+snapshot.admissible);expect(snapshot.admissible).toBe(false);
 });
 it('manager must reject stale seconds capacity rather than reserve it',async()=>{
  const now=Date.now(); const manager=new CapacityManager({store:new InMemoryCapacityStore(),estimateDemand:()=>({requests:1,inputTokens:0,outputTokens:0,concurrency:0,seconds:1})});
  manager.registerVector({providerId:'p',modelId:'m',keyId:'k',dimensions:[{unit:'requests',scope:'account',scopeId:'pool',limit:10,remaining:10,replenishment:'fixed_window',resetAtMs:now+60000,state:'available',confidence:1,observedAtMs:now,staleAfterMs:60000},{unit:'seconds',scope:'account',scopeId:'pool',limit:100,remaining:100,replenishment:'fixed_window',resetAtMs:now+60000,state:'available',confidence:1,observedAtMs:now-120000,staleAfterMs:60000}],lastObservedAtMs:now});
  const result=await manager.reserve('p','m','k',{});console.log('stale seconds manager success='+result.success);expect(result.success).toBe(false);
 });
 it('authoritative shared poolId must prevent duplicate credential capacity',async()=>{
  const now=Date.now();const store=new InMemoryCapacityStore();const manager=new CapacityManager({store,estimateDemand:()=>({requests:1,inputTokens:0,outputTokens:0,concurrency:0})});
  for(const keyId of ['key-a','key-b'])manager.registerVector({providerId:'p',modelId:'m',keyId,poolId:'p::account::account-one',dimensions:[{unit:'requests',scope:'account',scopeId:keyId,limit:1,remaining:1,replenishment:'fixed_window',resetAtMs:now+60000,state:'available',confidence:1,observedAtMs:now,staleAfterMs:60000}],lastObservedAtMs:now});
  const first=await manager.reserve('p','m','key-a',{});const second=await manager.reserve('p','m','key-b',{});console.log('shared pool success='+JSON.stringify([first.success,second.success]));expect(first.success).toBe(true);expect(second.success).toBe(false);
 });
});
