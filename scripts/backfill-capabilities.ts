/**
 * Backfill agent_definitions.capabilities from existing category/tags/description.
 * The 273 agents imported from GitHub have taxonomy fields but the structured
 * capabilities JSON column is empty, so scoreAgentForTask has nothing to match.
 *
 * Run with: bun run scripts/backfill-capabilities.ts
 */

const GW = process.env.DMRX_GATEWAY_URL ?? 'http://localhost:47113';
const KEY = process.env.DMRX_ADMIN_API_KEY;

function deriveCapabilities(agent: Record<string, unknown>) {
  const category = (agent.category as string) ?? '';
  const tags: string[] = Array.isArray(agent.tags) ? (agent.tags as string[]) : [];
  const desc = (agent.description as string) ?? '';
  const name = (agent.name as string) ?? '';
  const humanName = (agent.humanName as string) ?? '';

  const domains = new Set<string>();
  const deliverables = new Set<string>();
  const accepts = new Set<string>();

  // Map common categories → domains
  const catMap: Record<string, string[]> = {
    'Development': ['coding', 'software-development', 'architecture'],
    'Testing': ['testing', 'qa', 'quality-assurance'],
    'DevOps': ['devops', 'infrastructure', 'deployment'],
    'Data': ['data-science', 'analytics', 'machine-learning'],
    'Design': ['design', 'ux', 'ui'],
    'Marketing': ['marketing', 'seo', 'content'],
    'Finance': ['finance', 'accounting'],
    'Security': ['security', 'pentesting'],
    'Research': ['research', 'analysis'],
    'Writing': ['writing', 'documentation'],
    'Product': ['product-management', 'roadmapping'],
    'Support': ['support', 'customer-service'],
    'Legal': ['legal', 'compliance'],
    'System': ['orchestration', 'coordination'],
  };

  if (catMap[category]) {
    for (const d of catMap[category]) domains.add(d);
  }

  // Extract deliverables from tags
  const tagDeliverables: Record<string, string> = {
    'code': 'code',
    'documentation': 'documentation',
    'testing': 'test-report',
    'review': 'code-review',
    'debugging': 'bug-report',
    'refactoring': 'refactored-code',
    'design': 'design-spec',
    'analysis': 'analysis-report',
    'planning': 'project-plan',
    'automation': 'automation-scripts',
    'deployment': 'deployment-pipeline',
    'monitoring': 'monitoring-dashboard',
    'research': 'research-report',
    'api': 'api-spec',
    'security': 'security-audit',
    'performance': 'performance-report',
    'data': 'data-pipeline',
    'ml': 'ml-model',
  };

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (tagDeliverables[lower]) deliverables.add(tagDeliverables[lower]);
    // Also add tag as-is to domains if it looks like a domain skill
    if (['python', 'javascript', 'typescript', 'rust', 'go', 'sql', 'react', 'node', 'docker', 'kubernetes'].includes(lower)) {
      domains.add(lower);
    }
  }

  // Parse description for deliverable hints
  const descLower = desc.toLowerCase();
  if (descLower.includes('write') || descLower.includes('author')) deliverables.add('documentation');
  if (descLower.includes('review')) deliverables.add('code-review');
  if (descLower.includes('test')) deliverables.add('test-report');
  if (descLower.includes('debug') || descLower.includes('fix')) deliverables.add('bug-fix');
  if (descLower.includes('design')) deliverables.add('design-spec');
  if (descLower.includes('implement') || descLower.includes('build') || descLower.includes('code')) deliverables.add('code');

  // Derive accepts from description patterns
  if (descLower.includes('task') || descLower.includes('job')) accepts.add('tasks');
  if (!accepts.size) accepts.add('tasks');

  // Build summary from description or name + category
  let summary = '';
  if (desc && desc.length < 200) {
    summary = desc;
  } else if (humanName || name) {
    summary = `${humanName || name} — ${category} agent${tags.length ? ` skilled in ${tags.slice(0, 5).join(', ')}` : ''}.`;
  }

  const caps: Record<string, unknown> = {};
  if (domains.size) caps.domains = [...domains];
  if (deliverables.size) caps.deliverables = [...deliverables];
  caps.languages = ['en'];
  if (accepts.size) caps.accepts = [...accepts];
  if (summary) caps.summary = summary.slice(0, 2000);

  return caps;
}

async function main() {
  if (!KEY) {
    echo('ERROR: DMRX_ADMIN_API_KEY not set');
    process.exit(1);
  }

  echo(`Fetching agents from ${GW}...`);

  // Paginate through definitions
  const agents: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(`${GW}/v1/agents?limit=${limit}&offset=${offset}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) {
      echo(`Failed to list agents: ${res.status}`);
      process.exit(1);
    }
    const data = (await res.json()) as { items: Record<string, unknown>[]; total: number };
    agents.push(...data.items);
    if (agents.length >= data.total || data.items.length === 0) break;
    offset += limit;
  }

  echo(`Found ${agents.length} agent definitions`);

  let updated = 0;
  let skipped = 0;
  let noCaps = 0;

  for (const agent of agents) {
    const id = agent.id as string;
    const name = agent.name as string;
    const existing = agent.capabilities as Record<string, unknown> | undefined | null;

    // Skip if already has meaningful capabilities
    if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
      skipped++;
      continue;
    }

    // Skip system agents (they don't execute tasks)
    if (name.startsWith('__')) {
      skipped++;
      continue;
    }

    const caps = deriveCapabilities(agent);
    if (!caps.domains?.length && !caps.deliverables?.length) {
      noCaps++;
      // Still update with summary + accepts so we don't re-scan
      const res = await fetch(`${GW}/v1/agents/${id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ capabilities: caps }),
      });
      if (!res.ok) echo(`  ✗ ${name}: ${res.status}`);
      continue;
    }

    const res = await fetch(`${GW}/v1/agents/${id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: caps }),
    });

    if (res.ok) {
      updated++;
      if (updated % 25 === 0) echo(`  → ${updated} updated...`);
    } else {
      echo(`  ✗ ${name}: ${res.status}`);
    }
  }

  echo(`\nDone: ${updated} updated with capabilities, ${skipped} already populated (skipped), ${noCaps} minimal (no domains/deliverables derivable)`);
}

function echo(s: string) {
  console.log(s);
}

main().catch((e) => {
  echo(`Fatal: ${e}`);
  process.exit(1);
});
