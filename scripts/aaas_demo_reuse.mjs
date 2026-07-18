// AaaS live demo (REUSE mode) — runs the already-created skills/agents through
// the running DMR-X gateway and reports how DMR-X handled it. Verifies the
// MODALITY_ENDPOINTS fix: agents must now reach the LLM instead of 500ing.
const BASE = process.env.BASE || 'http://localhost:47113';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}
const log = (...a) => console.log(...a);
const hr = (t) => log('\n' + '='.repeat(72) + '\n' + t + '\n' + '='.repeat(72));

const brief = `We're standing up an internal AI agent platform. Teams define agents as markdown, run them with durable sessions that survive restarts, load skills on demand, and delegate specialist work to isolated subagents. Main concerns: per-tenant cost control, audit logging of every execution, and preventing a parent agent's conversation from leaking into a child. Also want a marketplace to share agents. Timeline: one quarter.`;

// Reuse known ids
const agents = {
  Researcher: { id: 'ce4b5bbe-acf2-4414-92df-67092205ee3d' },
  Reporter:   { id: '9a7e1a96-5936-4778-a641-2862ad579a1c' },
  Orchestrator:{ id: 'c92afa2f-6959-447b-89d4-fa9045e06534' },
};
// fetch the deployed instance id for a given definition (the /instances list
// returns ALL instances across the tenant, so filter by agentDefinitionId)
async function instId(defId) {
  const r = await api('GET', `/v1/agents/${defId}/instances`);
  const list = r.json?.items ?? r.json ?? [];
  const mine = list.find(i => i.agentDefinitionId === defId && i.status === 'active')
            || list.find(i => i.agentDefinitionId === defId)
            || list[0];
  return mine?.id ?? null;
}
for (const k of Object.keys(agents)) agents[k].instanceId = await instId(agents[k].id);
log('Instances:', Object.fromEntries(Object.entries(agents).map(([k,v])=>[k,v.instanceId])));

// ---------------------------------------------------------------------------
hr('RUN 1 — Researcher top-level (progressive skill loading via load_skill)');
const rRun = await api('POST', `/v1/agents/${agents.Researcher.instanceId}/chat`, {
  messages: [{ role: 'user', content: `Analyze this brief.\n\n${brief}` }],
  maxSteps: 8, stream: false,
});
const rr = rRun.json;
log(`HTTP ${rRun.status}  model=${rr.model}  steps=${rr.steps_completed}  convId=${rr.conversationId}`);
log(`loadedSkills=${JSON.stringify(rr.loadedSkills ?? [])}`);
const rTools = (rr.all_steps||[]).flatMap(s=>(s.tool_calls||[]).map(tc=>tc.function?.name)).filter(Boolean);
log(`tool_calls=${JSON.stringify(rTools)}`);
log('OUTPUT:\n' + String(rr.content||'').slice(0,900));

const sess = await api('GET', `/v1/agents/${agents.Researcher.instanceId}/sessions`);
log('DURABLE SESSIONS:', JSON.stringify((sess.json?.sessions||[]).map(s=>({id:s.conversationId?.slice(0,12),status:s.status}))));
const execs = await api('GET', `/v1/agents/${agents.Researcher.instanceId}/executions`);
log('EXECUTIONS recorded:', Array.isArray(execs.json?.items)?execs.json.items.length:(Array.isArray(execs.json)?execs.json.length:0));

// ---------------------------------------------------------------------------
hr('RUN 2 — Orchestrator with subagent delegation (isolation boundary)');
const oRun = await api('POST', `/v1/agents/${agents.Orchestrator.instanceId}/chat`, {
  messages: [{ role: 'user', content:
    `Initiative "Internal AI Agent Platform".\n1) Delegate to the Researcher agent: analyze the brief, return summary + ordered TODO list.\n2) Delegate to the Reporter agent: turn research into a Markdown report.\n3) Load your markdown-report skill and assemble the final deliverable.\n\nBrief: ${brief}` }],
  maxSteps: 14, stream: false,
});
const orr = oRun.json;
log(`HTTP ${oRun.status}  model=${orr.model}  steps=${orr.steps_completed}  convId=${orr.conversationId}`);
log(`loadedSkills=${JSON.stringify(orr.loadedSkills ?? [])}`);
const oTools = (orr.all_steps||[]).flatMap(s=>(s.tool_calls||[]).map(tc=>tc.function?.name)).filter(Boolean);
log(`tool_calls=${JSON.stringify(oTools)}`);
for (const s of (orr.all_steps||[])) for (const tr of (s.tool_results||[])) {
  if (tr.tool_name === 'delegate') {
    const out = tr.result?.output ?? tr.result?.error ?? '(no output)';
    log(`  delegate -> ${tr.result?.name}: ${String(out).slice(0,160).replace(/\n/g,' ')}`);
  }
}
log('FINAL OUTPUT (first 1000):\n' + String(orr.content||'').slice(0,1000));

hr('DONE — fix verified if RUN1/RUN2 returned HTTP 200 with model + content');
