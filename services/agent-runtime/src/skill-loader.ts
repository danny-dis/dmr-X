import { agentRegistryService } from '@dmr-x/agent-registry';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Load-on-demand skill loader (progressive disclosure)
//
// Borrowed from Vercel EVE's SKILL.md / `load_skill` model. Previously
// DMR-X inlined EVERY one of an agent's skills into the system prompt on
// every turn — wasteful and noisy. With this loader:
//
//   1. Each skill's *description* is advertised to the model as a hint
//      (cheap, small).
//   2. The model decides when a skill is relevant and calls `load_skill`
//      by name.
//   3. Only the requested skill BODY is appended to the prompt for that
//      turn (progressive disclosure).
//
// The agent's `buildSystemPrompt` receives the set of *loaded* skill ids
// so only those are inlined; everything else stays as advertising hints.
// ---------------------------------------------------------------------------

export interface SkillAdvert {
  name: string;
  description: string;
}

export class SkillLoader {
  /**
   * Advertise an agent's skills as short hints. Returns the list of
   * `{name, description}` for every skill the agent declares, regardless of
   * whether the body is loaded. The model reads these to decide what to
   * load on demand.
   */
  advertise(tenantId: string, skillIds: string[]): SkillAdvert[] {
    if (!skillIds || skillIds.length === 0) return [];
    const resolved = this.resolveSkills(tenantId, skillIds);
    return resolved.map((s) => ({ name: s.name, description: s.description }));
  }

  /**
   * Discover skills natively from the tenant's `skills` table, independent of
   * what an agent happens to declare in `definition.skills`.
   *
   * Why this exists: `advertise()` only describes an agent's DECLARED skills, so
   * an agent with an empty `skills` array was told nothing existed — and every
   * one of the 271 agents on this install has an empty array. Meanwhile
   * `load_skill` was never gated by the declared list: it resolves any skill in
   * the tenant. So the bodies were reachable the whole time and only DISCOVERY
   * was missing. Agents could not ask for what they were never told about.
   *
   * Ordering is deterministic (platform `source='seed'` methodology first, then
   * alphabetical) so the prompt is stable across turns and cache-friendly.
   * `limit` bounds the prompt cost: skills advertise as one short line each, but
   * a tenant with hundreds of skills should not push out the agent's own
   * instructions.
   */
  discover(tenantId: string, limit = 40): SkillAdvert[] {
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT name, description FROM skills
           WHERE tenant_id = ?
           ORDER BY CASE WHEN source = 'seed' THEN 0 ELSE 1 END, name
           LIMIT ?`,
        )
        .all(tenantId, limit) as Array<{ name: string; description: string | null }>;
      return rows.map((r) => ({ name: r.name, description: r.description ?? '' }));
    } catch (err) {
      // Non-fatal: discovery is an enhancement, never a hard dependency.
      logger.warn({ tenantId, err }, 'SkillLoader: skill discovery failed');
      return [];
    }
  }

  /**
   * Resolve a skill by id or name to its full body. Returns null if the
   * skill cannot be resolved or does not belong to the tenant. Non-fatal:
   * a missing skill simply yields null (caller decides what to do).
   */
  resolveBody(tenantId: string, skillRef: string): { name: string; description: string; content: string } | null {
    const resolved = this.resolveSkills(tenantId, [skillRef]);
    return resolved.length > 0 ? resolved[0] : null;
  }

  /**
   * Render the "advertising" section the model sees every turn: one line per
   * skill describing it, plus instructions to call `load_skill` to pull the
   * full body into context. Mirrors EVE's progressive-disclosure contract.
   */
  advertismentSection(adverts: SkillAdvert[]): string {
    if (adverts.length === 0) return '';
    const lines = adverts
      .map((a) => `- ${a.name}: ${a.description}`)
      .join('\n');
    return (
      `Available skills (load on demand with the load_skill tool):\n${lines}\n\n` +
      `Do NOT assume a skill's full instructions are already in context. If a task ` +
      `matches a skill above, call load_skill with its name to read the full procedure.`
    );
  }

  private resolveSkills(
    tenantId: string,
    skillRefs: string[],
  ): { name: string; description: string; content: string }[] {
    try {
      const db = getDb();
      const placeholders = skillRefs.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT name, description, content FROM skills
           WHERE tenant_id = ? AND (id IN (${placeholders}) OR name IN (${placeholders}))`,
        )
        .all(tenantId, ...skillRefs, ...skillRefs) as Array<{
        name: string;
        description: string | null;
        content: string | null;
      }>;
      return rows.map((r) => ({
        name: r.name,
        description: r.description ?? '',
        content: r.content ?? '',
      }));
    } catch (err) {
      logger.warn({ tenantId, skillRefs, err }, 'SkillLoader: failed to resolve skills');
      return [];
    }
  }
}

export const skillLoader = new SkillLoader();
