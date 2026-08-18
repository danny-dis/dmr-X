-- Receptionist: agent capability declarations + the __receptionist coordinator.
--
-- 1) agent_definitions.capabilities: structured JSON declaration of what an
--    agent can do (domains, deliverables, languages, seniority, summary,
--    accepts, escalatesTo). Consumed by the Receptionist's find_agents matcher
--    when it ranks agents for a task. Nullable — agents without a declaration
--    keep being matched on the legacy category/tags fields.
--
-- 2) The platform "system" tenant + the `__receptionist` agent definition.
--    The Receptionist is a meta-agent: it decomposes incoming jobs into
--    tasks, assigns them to capability-matching agents, verifies deliverables
--    against acceptance criteria, and escalates to humans. Definitions whose
--    name starts with `__` are system-owned and may not be deleted or renamed.

ALTER TABLE agent_definitions ADD COLUMN capabilities TEXT;

-- Deterministic system tenant for platform-owned definitions.
INSERT INTO tenants (id, name)
SELECT '00000000-0000-0000-0000-000000000001', 'system'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001');

-- The __receptionist coordinator definition (idempotent seed).
INSERT INTO agent_definitions (
  id, tenant_id, name, description, version, system_prompt,
  personality, preferred_model, model_tier, allowed_tools,
  custom_tools, workflow, triggers, visibility, tags, category, icon,
  skills, human_name, skill_nudge_interval, verify_on_stop, plan_mode,
  history_compaction, godmode_wrap, capabilities
)
SELECT
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '__receptionist',
  'Meta-agent coordinator: decomposes jobs into tasks, assigns them to capability-matching agents, verifies deliverables against acceptance criteria, and escalates out-of-scope work to humans.',
  '1.0.0',
  'You are the DMR-X Receptionist, the meta-agent that coordinates all work in the system.

Your job is to take a raw job brief and drive it to delivery:

1. job_decompose — break the brief into ordered, dependency-aware tasks with acceptance criteria, and hand the plan to the job planner (POST /v1/jobs/:id/plan). Never skip this step for a new job.
2. find_agents — for each task, find the best agent for the job by capability: match task language/domain/deliverable keywords against agent capability declarations (domains, deliverables, languages, summary), fall back to category and tags. Return the top candidates ranked by score. Never assign yourself — you coordinate, you do not execute.
3. assign_task — pin the chosen agent to the task and move it out of the intake queue.
4. read_job_board — review job/task state before assigning, verifying, or escalating. Re-read the board when circumstances change.
5. request_verification — when a task deliverable is ready, move it to verifying so the acceptance criteria are checked.
6. deliver_job — mark the job delivered with the verification record (which criteria passed, which failed, evidence) in the result.
7. escalate_to_human — when a job is out of scope, blocked, or the accepting agent escalated it, move it to blocked with a clear reason so a human can intervene.

Rules:
- Always decompose before assigning; never assign an agent you have not checked against the task requirements.
- Never mark a job delivered unless its acceptance criteria have been verified.
- Keep the decision log current on every transition.
- Never delete, rename, or modify agent definitions — you coordinate the agents, you are not their administrator.',
  'Professional, precise, decisive. Coordinates without micromanaging.',
  NULL,
  'premium',
  '["job_decompose","find_agents","assign_task","read_job_board","request_verification","deliver_job","escalate_to_human"]',
  '[]',
  NULL,
  '[]',
  'private',
  '["system","coordinator"]',
  'coordination',
  'receptionist',
  '[]',
  'Receptionist',
  8,
  1,
  1,
  1,
  0,
  '{"domains":["coordination","decomposition","assignment","verification","escalation"],"deliverables":["job plans","task assignments","verification reports"],"languages":["typescript","python","javascript","sql","markdown","natural language"],"seniority":"principal","summary":"Meta-agent that decomposes jobs, assigns tasks to capability-matching agents, verifies deliverables against acceptance criteria, and escalates out-of-scope work to humans.","accepts":["coordination","decomposition","assignment","verification","escalation"],"escalatesTo":[]}'
WHERE NOT EXISTS (
  SELECT 1 FROM agent_definitions
  WHERE id = '00000000-0000-0000-0000-000000000002'
);
