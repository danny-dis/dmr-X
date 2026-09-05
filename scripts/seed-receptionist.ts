#!/usr/bin/env bun
// Seed the __receptionist system agent

import { getDb } from '@dmr-x/db';

const RECEPTIONIST_AGENT = {
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '2a5ca7b9-a148-4738-8bc4-9d0345f4e8ee',
  name: '__receptionist',
  description: 'The meta-agent coordinator for multi-agent jobs. Decomposes briefs into tasks, assigns to agents, tracks progress, verifies deliverables.',
  version: '1.0.0',
  systemPrompt: `# Receptionist — Multi-Agent Job Coordinator

You are the **Receptionist**, the meta-agent coordinator for multi-agent jobs. Your job is to decompose incoming briefs into ordered tasks, assign each to the best-matching agent, track progress, verify deliverables, and escalate when stuck.

## Your Tools
- **job_decompose**: Break a brief into an ordered, dependency-aware task list
- **find_agents**: Find the best agents for a task by matching capabilities
- **assign_task**: Assign an agent to a task
- **read_job_board**: Read current task status
- **request_verification**: Request verification of deliverables
- **deliver_job**: Mark a job as delivered after verification
- **escalate_to_human**: Escalate blocked/stuck work to a human

## Your Workflow
1. When a new job arrives, call **job_decompose** to break it into tasks
2. For each task, call **find_agents** to discover the best matches
3. Call **assign_task** to assign each task to an agent
4. Periodically call **read_job_board** to track progress
5. When tasks complete, call **request_verification** then **deliver_job**
6. If blocked, call **escalate_to_human** with a clear reason

## Rules
- Never assign yourself to a task
- Always verify deliverables before delivering
- Escalate early when stuck — don't spin
- Use acceptance criteria as the source of truth`,
  personality: 'Coordinator',
  preferredModel: 'auto',
  modelTier: 'auto',
  allowedTools: JSON.stringify(['job_decompose', 'find_agents', 'assign_task', 'read_job_board', 'request_verification', 'deliver_job', 'escalate_to_human']),
  customTools: '[]',
  workflow: null,
  triggers: '[]',
  visibility: 'public',
  tags: JSON.stringify(['system', 'coordinator', 'multi-agent']),
  category: 'System',
  icon: '🎯',
  skills: '[]',
  humanName: 'Receptionist',
  skillNudgeInterval: 8,
  verifyOnStop: false,
  planMode: false,
  historyCompaction: false,
  godmodeWrap: false,
};

function seedReceptionist() {
  const db = getDb();
  
  // Check if already exists
  const existing = db.prepare('SELECT id FROM agent_definitions WHERE id = ?').get(RECEPTIONIST_AGENT.id);
  if (existing) {
    console.log('✅ __receptionist agent already seeded');
    return;
  }

  db.prepare(`
    INSERT INTO agent_definitions (
      id, tenant_id, name, description, version, system_prompt,
      personality, preferred_model, model_tier, allowed_tools,
      custom_tools, workflow, triggers, visibility, tags, category, icon,
      skills, human_name, skill_nudge_interval, verify_on_stop, plan_mode,
      history_compaction, godmode_wrap, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    RECEPTIONIST_AGENT.id,
    RECEPTIONIST_AGENT.tenantId,
    RECEPTIONIST_AGENT.name,
    RECEPTIONIST_AGENT.description,
    RECEPTIONIST_AGENT.version,
    RECEPTIONIST_AGENT.systemPrompt,
    RECEPTIONIST_AGENT.personality,
    RECEPTIONIST_AGENT.preferredModel,
    RECEPTIONIST_AGENT.modelTier,
    RECEPTIONIST_AGENT.allowedTools,
    RECEPTIONIST_AGENT.customTools,
    RECEPTIONIST_AGENT.workflow,
    RECEPTIONIST_AGENT.triggers,
    RECEPTIONIST_AGENT.visibility,
    RECEPTIONIST_AGENT.tags,
    RECEPTIONIST_AGENT.category,
    RECEPTIONIST_AGENT.icon,
    RECEPTIONIST_AGENT.skills,
    RECEPTIONIST_AGENT.humanName,
    RECEPTIONIST_AGENT.skillNudgeInterval,
    RECEPTIONIST_AGENT.verifyOnStop ? 1 : 0,
    RECEPTIONIST_AGENT.planMode ? 1 : 0,
    RECEPTIONIST_AGENT.historyCompaction ? 1 : 0,
    RECEPTIONIST_AGENT.godmodeWrap ? 1 : 0,
  );

  console.log('✅ __receptionist agent seeded successfully');
  console.log('   ID:', RECEPTIONIST_AGENT.id);
  console.log('   Name:', RECEPTIONIST_AGENT.name);
  console.log('   Tools:', JSON.parse(RECEPTIONIST_AGENT.allowedTools).join(', '));
}

seedReceptionist();
