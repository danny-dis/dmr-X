// Runtime-owned coordination receipt; model prose remains in raw all_steps.
interface Step {
 tool_calls?: Array<{ id?: string; function?: { arguments?: string; name?: string } }>;
 tool_results?: Array<{ tool_call_id?: string; tool_name?: string; result?: unknown; error?: unknown }>;
}
const TOOLS = new Set(['job_decompose','find_agents','assign_task','run_job','read_job_board','request_verification','deliver_job','escalate_to_human']);
export function buildReceptionistReceipt(steps: Step[]): { content: string; failed: boolean } | null {
 const outcomes = new Map<string,{name:string;failed:boolean;detail:string}>();
 for (const step of steps) for (const row of step.tool_results ?? []) {
  if (!row.tool_name || !TOOLS.has(row.tool_name)) continue;
  let args: Record<string,unknown> = {};
  try { args = JSON.parse(step.tool_calls?.find(c=>c.id===row.tool_call_id)?.function?.arguments ?? '{}'); } catch { /* no invented target */ }
  const value = row.result && typeof row.result==='object' && !Array.isArray(row.result) ? row.result as Record<string,unknown> : {};
  const target = typeof args?.taskId==='string' ? args.taskId : typeof args?.jobId==='string' ? args.jobId : typeof args?.task==='string' ? args.task : '';
  const failed = Boolean(row.error || value.error); const details:string[]=[];
  if(typeof value.jobId==='string') details.push(`job ${value.jobId}`);
  if(typeof value.status==='string') details.push(`status ${value.status}`);
  if(typeof value.taskCount==='number') details.push(`${value.taskCount} tasks`);
  if(Array.isArray(value.candidates)) details.push(`${value.candidates.length} candidates`);
  outcomes.set(`${row.tool_name}:${target}`,{name:row.tool_name,failed,detail:details.join(', ')});
 }
 if(outcomes.size===0) return null;
 const failed=[...outcomes.values()].some(o=>o.failed);
 const lines=[...outcomes.values()].map(o=>`${o.name}: ${o.failed?'failed':'recorded'}${o.detail?` (${o.detail})`:''}`);
 return {failed,content:`[dmr-x Receptionist] ${failed?'Coordination has unresolved tool failures.':'Recorded coordination actions:'}\n${lines.join('\n')}\nAssignments and queued requests are not proof of completed work. Delivery is confirmed only by the job's verified delivered state.`};
}
