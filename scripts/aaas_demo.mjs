// AaaS live demo against the running DMR-X gateway.
// Creates skills + agents, deploys instances, runs a task, and reports how DMR-X handled it.
const BASE = process.env.BASE || 'http://localhost:47113';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}
const log = (...a) => console.log(...a);
const hr = (t) => log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70));

// ---------------------------------------------------------------------------
// 1. SKILLS
// ---------------------------------------------------------------------------
hr('STEP 1 — Create skills (POST /v1/skills)');
const skillDefs = [
  {
    name: 'summarize-text',
    description: 'Condense long text into a structured summary: TL;DR, key points, open questions.',
    content: `# Summarize Text
When asked to summarize, always produce:
1. **TL;DR** — exactly one sentence capturing the essence.
2. **Key points** — a bullet list of 3–6 items, using the source's own terminology.
3. **Open questions** — what is still unresolved or unspecified.
Never invent facts. If the input is ambiguous, say so under Open questions.`,
    tags: ['analysis', 'writing'],
  },
  {
    name: 'extract-todos',
    description: 'Extract an ordered, concrete TODO checklist from a request or transcript.',
    content: `# Extract TODOs
From the input, extract an ordered TODO list. Each item:
- begins with \`[ ]\` (a checkbox)
- is a single concrete, actionable task
- references an owner in parentheses only if one is named
Group related items under a \`##\` heading by workstream.`,
    tags: ['planning'],
  },
  {
    name: 'markdown-report',
    description: 'Render findings as a clean Markdown report: summary, table, recommendations, next steps.',
    content: `# Markdown Report
Produce a report with this exact structure:
- \`# Title\`
- \`## Summary\` — one tight paragraph
- a Markdown table of findings (columns: Area | Status | Note)
- \`## Recommendations\`
- \`## Next Steps\` — a checkbox \`[ ]\` list
Keep it scannable; no walls of text.`,
    tags: ['writing', 'reporting'],
  },
];
const skillIds = {};
for (const s of skillDefs) {
  const r = await api('POST', '/v1/skills', s);
  log(`  ${s.name.padEnd(16)} -> HTTP ${r.status}  id=${r.json?.id ?? r.json?.error?.message ?? '?'}`);
  if (r.json?.id) skillIds[s.name] = r.json.id;
}

// ---------------------------------------------------------------------------
// 2. AGENTS
// ---------------------------------------------------------------------------
hr('STEP 2 — Create agents (POST /v1/agents) + deploy instances');
const agentDefs = [
  {
    name: 'Researcher',
    humanName: 'Researcher',
    description: 'Analyzes a brief: summarizes it and extracts an ordered TODO list, following house-style skills.',
    systemPrompt: 'You are a research analyst. When the task involves summarizing or extracting tasks, FIRST call load_skill for the relevant skill (summarize-text, extract-todos) and follow its procedure exactly. Do not skip the skill step.',
    skills: ['summarize-text', 'extract-todos'],
    allowedTools: ['load_skill'],
    preferredModel: 'gemini-2.5-flash',
    triggers: [],
    tags: ['analysis'],
    category: 'Research',
  },
  {
    name: 'Reporter',
    humanName: 'Reporter',
    description: 'Turns research into a polished Markdown report following the markdown-report skill.',
    systemPrompt: 'You are a technical writer. When producing a report, FIRST call load_skill for "markdown-report" and follow its structure exactly.',
    skills: ['markdown-report'],
    allowedTools: ['load_skill'],
    preferredModel: 'gemini-2.5-flash',
    triggers: [],
    tags: ['writing'],
    category: 'Product',
  },
  {
    name: 'Orchestrator',
    humanName: 'Orchestrator',
    description: 'Platform lead: delegates to Researcher/Reporter subagents (isolated) and assembles the final Markdown deliverable.',
    systemPrompt: 'You are a platform lead. Delegate specialist work to subagents via the delegate tool (e.g. "Researcher", "Reporter"). Before producing the final deliverable, call load_skill for "markdown-report" and follow its structure. The subagents run in isolation and return their answers to you; you assemble and do not re-do their work.',
    skills: ['markdown-report'],
    allowedTools: ['delegate', 'load_skill'],
    preferredModel: 'gemini-2.5-flash',
    triggers: [],
    tags: ['orchestration'],
    category: 'Operations',
  },
];
const agents = {};
for (const a of agentDefs) {
  const r = await api('POST', '/v1/agents', a);
  if (!r.json?.id) { log(`  ${a.name} FAILED:`, r.status, JSON.stringify(r.json).slice(0, 200)); continue; }
  const id = r.json.id;
  const d = await api('POST', `/v1/agents/${id}/deploy`, {});
  const instId = d.json?.id;
  agents[a.name] = { id, instanceId: instId };
  log(`  ${a.name.padEnd(13)} def=${id}  instance=${instId}  HTTP deploy ${d.status}`);
}

// ---------------------------------------------------------------------------
// 3. RUN — Researcher top-level (exercises load_skill + skill bodies)
// ---------------------------------------------------------------------------
hr('STEP 3 — Run Researcher top-level (progressive skill loading)');
const brief = `We’re standing up an internal AI agent platform. Teams should define agents as markdown, run them with durable sessions that survive restarts, load skills on demand, and delegate specialist work to isolated subagents. Our main concerns: per-tenant cost control, audit logging of every execution, and making sure a parent agent’s conversation never leaks into a child. We also want a marketplace so teams can share agents. Timeline is one quarter.`;
const rRun = await api('POST', `/v1/agents/${agents['Researcher'].instanceId}/chat`, {
  messages: [{ role: 'user', content: `Analyze this brief.\n\n${brief}` }],
  maxSteps: 8,
  stream: false,
});
const rr = rRun.json;
log(`  HTTP ${rRun.status}  model=${rr.model}  steps=${rr.steps_completed}  convId=${rr.conversationId}`);
log(`  loadedSkills=${JSON.stringify(rr.loadedSkills ?? [])}`);
const toolNames = (rr.all_steps || []).flatMap(s => (s.tool_calls || []).map(tc => tc.function?.name)).filter(Boolean);
log(`  tool_calls=${JSON.stringify(toolNames)}`);
log('  --- Researcher output (first 600 chars) ---');
log('  ' + String(rr.content || '').slice(0, 600).replace(/\n/g, '\n  '));

// sessions + executions for durability check
const sess = await api('GET', `/v1/agents/${agents['Researcher'].instanceId}/sessions`);
log(`  durable sessions for Researcher: ${JSON.stringify((sess.json?.sessions||[]).map(s=>({id:s.conversationId,status:s.status})))}`);
const execs = await api('GET', `/v1/agents/${agents['Researcher'].instanceId}/executions`);
log(`  executions recorded: ${(execs.json?.items||execs.json||[]).length}`);

// ---------------------------------------------------------------------------
// 4. RUN — Orchestrator with delegation (isolation boundary)
// ---------------------------------------------------------------------------
hr('STEP 4 — Run Orchestrator (delegates to isolated subagents)');
const oRun = await api('POST', `/v1/agents/${agents['Orchestrator'].instanceId}/chat`, {
  messages: [{
    role: 'user',
    content: `Initiative: "Internal AI Agent Platform".\n1) Delegate to the Researcher agent: analyze the brief below, return a summary + ordered TODO list.\n2) Delegate to the Reporter agent: turn the research into a Markdown report.\n3) Load your markdown-report skill and assemble the final deliverable.\n\nBrief: ${brief}`,
  }],
  maxSteps: 12,
  stream: false,
});
const orr = oRun.json;
log(`  HTTP ${oRun.status}  model=${orr.model}  steps=${orr.steps_completed}  convId=${orr.conversationId}`);
log(`  loadedSkills=${JSON.stringify(orr.loadedSkills ?? [])}`);
const oToolNames = (orr.all_steps || []).flatMap(s => (s.tool_calls || []).map(tc => tc.function?.name)).filter(Boolean);
log(`  tool_calls=${JSON.stringify(oToolNames)}`);
// show delegate results if present
for (const s of (orr.all_steps||[])) {
  for (const tr of (s.tool_results||[])) {
    if (tr.tool_name === 'delegate') {
      const out = tr.result?.output ?? tr.result?.error ?? '(no output)';
      log(`  delegate -> ${tr.result?.name}: ${String(out).slice(0,200).replace(/\n/g,' ')}`);
    }
  }
}
log('  --- Orchestrator final output (first 700 chars) ---');
log('  ' + String(orr.content || '').slice(0, 700).replace(/\n/g, '\n  '));

hr('DONE');
