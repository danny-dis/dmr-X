/**
 * Live verification harness for the dmrx-mcp tool surface.
 *
 * Connects a real MCP client over Streamable HTTP and EXECUTES tools,
 * asserting on their output. Every check records PASS/FAIL with evidence.
 *
 * Usage: bun scripts/mcp-tool-verify.ts [stage]
 *   stages: discover | readonly | fs | infer | state | jobs | all
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const URL_ = process.env.MCP_URL ?? 'http://127.0.0.1:47114/mcp';
const KEY = process.env.MCP_KEY ?? 'test-mcp-key';
const stage = process.argv[2] ?? 'all';

type Res = { name: string; ok: boolean; evidence: string };
const results: Res[] = [];

function rec(name: string, ok: boolean, evidence: unknown) {
  const ev = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  results.push({ name, ok, evidence: (ev ?? '').slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${(ev ?? '').slice(0, 400)}`);
}

function text(r: any): string {
  const c = r?.content;
  if (!Array.isArray(c)) return JSON.stringify(r);
  return c.map((p: any) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
}

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  });
  const client = new Client({ name: 'dmrx-verify', version: '1.0.0' });
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  rec('connect + tools/list', names.length > 0, `${names.length} tools; sample=${names.slice(0, 6).join(',')}`);

  const has = (n: string) => names.includes(n);

  // schema sanity: every tool must have a name + inputSchema
  const badSchema = listed.tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object');
  rec('every tool has inputSchema', badSchema.length === 0, `bad=${badSchema.map((t) => t.name).join(',') || 'none'}`);
  const noDesc = listed.tools.filter((t) => !t.description);
  rec('every tool has description', noDesc.length === 0, `missing=${noDesc.map((t) => t.name).join(',') || 'none'}`);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  rec('no duplicate tool names', dupes.length === 0, `dupes=${dupes.join(',') || 'none'}`);

  // resources / prompts surface
  try {
    const r = await client.listResources();
    rec('resources/list', true, `${r.resources.length} resources: ${r.resources.map((x) => x.uri).slice(0, 5).join(',')}`);
  } catch (e: any) { rec('resources/list', false, e.message); }
  try {
    const p = await client.listPrompts();
    rec('prompts/list', true, `${p.prompts.length} prompts: ${p.prompts.map((x) => x.name).slice(0, 8).join(',')}`);
  } catch (e: any) { rec('prompts/list', false, e.message); }

  const call = async (name: string, args: any = {}, timeoutMs = 60000) => {
    const t0 = Date.now();
    const r: any = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    return { ms: Date.now() - t0, isError: !!r.isError, out: text(r), raw: r };
  };

  const check = async (label: string, name: string, args: any, predicate: (out: string, r: any) => boolean, timeoutMs = 60000) => {
    if (!has(name)) { rec(label, false, `tool ${name} NOT EXPOSED`); return null; }
    try {
      const r = await call(name, args, timeoutMs);
      const ok = predicate(r.out, r);
      rec(label, ok, `${r.ms}ms isError=${r.isError} :: ${r.out.replace(/\s+/g, ' ').slice(0, 300)}`);
      return r;
    } catch (e: any) { rec(label, false, `THREW ${e.message}`); return null; }
  };

  const want = (s: string) => (out: string, r: any) => !r.isError && out.toLowerCase().includes(s.toLowerCase());
  const okNoErr = (out: string, r: any) => !r.isError && out.length > 0;

  // ---------------- STAGE: readonly / discovery tools ----------------
  if (stage === 'all' || stage === 'discover' || stage === 'readonly') {
    await check('dmrx_tool_list returns the tool catalog', 'dmrx_tool_list', {}, (o) => o.includes('dmrx_chat'));
    await check('dmrx_tool_search finds image tools', 'dmrx_tool_search', { query: 'generate an image' }, (o) => o.includes('image'));
    await check('dmrx_models lists routable models', 'dmrx_models', {}, okNoErr);
    await check('dmrx_status reports health', 'dmrx_status', { include_providers: true }, okNoErr);
    await check('dmrx_list_skills', 'dmrx_list_skills', {}, okNoErr);
    await check('dmrx_list_agents', 'dmrx_list_agents', {}, okNoErr);
    await check('dmrx_preset_list', 'dmrx_preset_list', {}, okNoErr);
    await check('dmrx_template_list', 'dmrx_template_list', {}, okNoErr);
    await check('dmrx_context_list', 'dmrx_context_list', {}, okNoErr);
    await check('dmrx_status reports health (90s budget)', 'dmrx_status', { include_providers: true }, okNoErr, 90000);
  }

  // ---------------- STAGE: filesystem + bash (real side effects) ----------------
  if (stage === 'all' || stage === 'fs') {
    const f = `.mcp-verify-${Date.now()}.txt`;
    const body = `hello-from-mcp-${Date.now()}`;

    await check('dmrx_write_file creates a file', 'dmrx_write_file', { path: f, content: body }, okNoErr);
    await check('dmrx_read_file reads back the exact bytes', 'dmrx_read_file', { path: f }, (o) => o.includes(body));
    await check('dmrx_list_files sees the new file', 'dmrx_list_files', { path: '.' }, (o) => o.includes(f.replace('./', '')));
    await check('dmrx_edit_file applies a replacement', 'dmrx_edit_file',
      { path: f, old_string: 'hello-from-mcp', new_string: 'EDITED-BY-MCP' }, okNoErr);
    await check('dmrx_read_file confirms the edit landed', 'dmrx_read_file', { path: f }, (o) => o.includes('EDITED-BY-MCP'));
    await check('dmrx_search_files finds the edited marker', 'dmrx_search_files',
      { pattern: 'EDITED-BY-MCP', path: '.' }, (o) => o.includes(f) || o.includes('EDITED-BY-MCP'));

    // Guardrail: sandbox escape MUST be rejected
    await check('dmrx_read_file REJECTS path escape (../../etc/passwd)', 'dmrx_read_file',
      { path: '../../../../../../etc/passwd' }, (o, r) => r.isError || /outside|escape|denied|invalid|forbidden/i.test(o));
    await check('dmrx_write_file REJECTS absolute path outside workspace', 'dmrx_write_file',
      { path: 'C:/Windows/Temp/mcp-should-not-exist.txt', content: 'x' },
      (o, r) => r.isError || /outside|escape|denied|invalid|forbidden/i.test(o));

    await check('dmrx_bash executes a real command', 'dmrx_bash', { command: 'echo MCP_BASH_OK' }, (o) => o.includes('MCP_BASH_OK'));
    await check('dmrx_bash surfaces nonzero exit', 'dmrx_bash', { command: 'exit 7' }, (o, r) => r.isError || /7/.test(o));

    // cleanup
    await check('cleanup temp file', 'dmrx_bash', { command: `rm -f "${f}"` }, () => true);
  }

  // ---------------- STAGE: live inference through the gateway ----------------
  if (stage === 'all' || stage === 'infer') {
    await check('dmrx_chat returns a real completion (gateway proxy)', 'dmrx_chat',
      { messages: [{ role: 'user', content: 'Reply with exactly one word: PONG' }], max_tokens: 16 },
      (o, r) => { if (r.isError) return false; try { const j = JSON.parse(o); const c = j.choices?.[0]?.message?.content; return typeof c === 'string' && c.length > 0 && !!j.model && !!j.provider; } catch { return false; } }, 120000);

    await check('dmrx_chat honors a deterministic arithmetic prompt', 'dmrx_chat',
      { messages: [{ role: 'user', content: 'What is 17 + 25? Reply with only the number.' }], max_tokens: 16 },
      (o, r) => !r.isError && o.includes('42'), 120000);

    await check('dmrx_embed returns a numeric vector', 'dmrx_embed',
      { input: 'the quick brown fox' },
      (o, r) => { if (r.isError) return false; try { const j = JSON.parse(o); const v = j.embeddings?.[0] ?? j.data?.[0]?.embedding ?? j.embedding; return Array.isArray(v) && v.length > 8 && typeof v[0] === 'number'; } catch { return /\[\s*-?\d/.test(o); } }, 120000);

    // Error-path: invalid args must fail cleanly, not hang or 500
    await check('dmrx_chat rejects empty messages cleanly', 'dmrx_chat', { messages: [] },
      (o, r) => r.isError || /invalid|required|empty|at least/i.test(o), 60000);
  }

  // ---------------- STAGE: stateful tools (persistence round-trip) ----------------
  if (stage === 'all' || stage === 'state') {
    const cid = `verify-ctx-${Date.now()}`;
    const user = 'mcp-verify-user';
    await check('dmrx_context_save persists a context', 'dmrx_context_save',
      { id: cid, user, messages: [{ role: 'user', content: 'remember: banana-42' }] },
      (o) => o.includes(cid));
    await check('dmrx_context_load returns the saved content', 'dmrx_context_load',
      { id: cid }, (o) => o.includes('banana-42'));
    await check('dmrx_context_list (scoped to user) includes the new id', 'dmrx_context_list',
      { user }, (o) => o.includes(cid));
    await check('dmrx_context_compress runs on the saved context', 'dmrx_context_compress',
      { id: cid, target_tokens: 50 }, okNoErr, 120000);
    await check('dmrx_context_load rejects unknown id', 'dmrx_context_load',
      { id: 'ctx-does-not-exist-000' }, (o, r) => r.isError || /not found|expired|missing/i.test(o));

    const pr = await check('dmrx_preset_create creates a preset for dmrx_chat', 'dmrx_preset_create',
      { tool_name: 'dmrx_chat', defaults: { max_tokens: 77 }, description: 'mcp-verify-preset' }, okNoErr);
    let pid: string | undefined;
    if (pr && !pr.isError) { try { const j = JSON.parse(pr.out); pid = j.preset?.id ?? j.id; } catch {} }
    rec('preset id extracted', !!pid, `id=${pid}`);
    if (pid) {
      await check('dmrx_preset_list includes it', 'dmrx_preset_list', { tool_name: 'dmrx_chat' }, (o) => o.includes(pid!));
      await check('dmrx_preset_get retrieves it', 'dmrx_preset_get', { id: pid }, (o) => o.includes('77'));
      await check('dmrx_preset_update changes defaults', 'dmrx_preset_update', { id: pid, defaults: { max_tokens: 99 } }, (o) => o.includes('99'));
      await check('dmrx_preset_delete removes it', 'dmrx_preset_delete', { id: pid }, okNoErr);
      await check('dmrx_preset_get now 404s', 'dmrx_preset_get', { id: pid }, (o, r) => r.isError || /not found/i.test(o));
    }

    const tname = `verify-tpl-${Date.now()}`;
    const tr = await check('dmrx_template_create creates a template', 'dmrx_template_create',
      { name: tname, description: 'mcp verify', steps: [{ id: 's1', tool_name: 'dmrx_bash', parameters: { command: 'echo TPL_OK' } }] }, okNoErr);
    let tid: string | undefined;
    if (tr && !tr.isError) { try { const j = JSON.parse(tr.out); tid = j.template?.id ?? j.id; } catch {} }
    rec('template id extracted', !!tid, `id=${tid}`);
    if (tid) {
      await check('dmrx_template_get retrieves it', 'dmrx_template_get', { id: tid }, (o) => o.includes(tname));
      await check('dmrx_template_list includes it', 'dmrx_template_list', {}, (o) => o.includes(tname));
      await check('dmrx_template_delete removes it', 'dmrx_template_delete', { id: tid }, okNoErr);
      await check('dmrx_template_list no longer lists it', 'dmrx_template_list', {}, (o) => !o.includes(tname));
    }

    // skills: list, then fetch a REAL id from that list
    const sl = await check('dmrx_list_skills returns skills', 'dmrx_list_skills', { limit: 3 }, okNoErr);
    let skid: string | undefined;
    if (sl && !sl.isError) { try { skid = JSON.parse(sl.out).skills?.[0]?.id; } catch {} }
    if (skid) await check('dmrx_get_skill fetches a REAL skill by id', 'dmrx_get_skill', { id: skid }, (o) => o.includes(skid!));
    await check('dmrx_get_skill rejects unknown id', 'dmrx_get_skill', { id: 'nope-000' }, (o, r) => r.isError || /not found/i.test(o));

    // workflow: multi-step orchestration through real tools
    await check('dmrx_workflow runs a 2-step tool chain', 'dmrx_workflow',
      { steps: [ { id: 'step1', tool: 'dmrx_bash', parameters: { command: 'echo STEP1_OK' } },
                 { id: 'step2', tool: 'dmrx_models', parameters: {} } ], fail_fast: true },
      (o, r) => !r.isError && o.includes('STEP1_OK'), 120000);
  }

  // ---------------- STAGE: async jobs ----------------
  if (stage === 'all' || stage === 'jobs') {
    const jr = await check('dmrx_submit_job accepts a brief', 'dmrx_submit_job',
      { brief: 'Write one sentence about rain.', acceptanceCriteria: ['one sentence'], maxDepth: 1 }, okNoErr, 90000);
    let jid: string | undefined;
    if (jr && !jr.isError) { try { const j = JSON.parse(jr.out); jid = j.jobId ?? j.job_id ?? j.job?.id ?? j.id; } catch {} }
    rec('job id extracted', !!jid, `jobId=${jid}`);
    if (jid) {
      await check('dmrx_job_status returns a status', 'dmrx_job_status', { jobId: jid }, okNoErr);
      await check('dmrx_job_tasks lists tasks', 'dmrx_job_tasks', { jobId: jid }, okNoErr);
      await check('dmrx_cancel_job cancels it', 'dmrx_cancel_job', { jobId: jid }, okNoErr);
      await check('dmrx_job_status reflects cancellation', 'dmrx_job_status', { jobId: jid },
        (o) => /cancel/i.test(o));
    }
    await check('dmrx_job_status rejects unknown job id', 'dmrx_job_status', { jobId: 'does-not-exist-000' },
      (o, r) => r.isError || /not found|unknown|no job/i.test(o));

    await check('dmrx_dispatch_task routes a task to an agent', 'dmrx_dispatch_task',
      { task: 'Summarize what 2+2 equals.', run: false }, okNoErr, 90000);

    await check('dmrx_batch processes multiple prompts', 'dmrx_batch',
      { calls: [ { tool: 'dmrx_chat', parameters: { messages: [{ role: 'user', content: 'Reply with only: A' }], max_tokens: 8 } },
                 { tool: 'dmrx_embed', parameters: { input: 'batch vector test' } } ] },
      (o, r) => !r.isError && o.length > 50, 180000);
  }

  console.log('\n===== SUMMARY =====');
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('FAILED:\n' + failed.map((f) => ` - ${f.name}: ${f.evidence}`).join('\n'));

  await client.close();
  process.exit(0);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
