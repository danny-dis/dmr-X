import { describe, it, expect } from 'vitest';

import { normalizeAllowedTools } from '../../packages/core/src/agent-tools.js';

/**
 * Regression: an agent's `allowedTools` names are resolved against the tool
 * registry and anything unknown is SKIPPED silently, so an agent could run with
 * far fewer capabilities than its definition asks for and nothing would say so.
 *
 * Measured against the live DMR-X fleet: of the 17 agents that restrict their
 * tools, 16 request `WebFetch` and `WebSearch`. Neither is registered, and no
 * equivalent exists — the only web-ish entries in the catalog are MCP agent
 * wrappers (`dmrx_agent_*`) and `search_files`, which searches the local
 * filesystem. So e.g. "Trend Researcher" resolves to exactly
 * ['read_file','write_file','edit_file'] and has NO way to reach the internet,
 * while still answering confidently from model priors.
 *
 * These tests pin two things:
 *  1. normalizeAllowedTools handles the shapes actually stored in the DB — a
 *     bare comma-separated STRING, not just an array — and maps the documented
 *     aliases. (A naive reader that iterates the raw string yields single
 *     characters; that bug is already fixed and must stay fixed.)
 *  2. `WebFetch`/`WebSearch` do NOT silently become something else. If a real
 *     web tool is added later, the alias map should map them deliberately and
 *     this test should be updated on purpose rather than passing by accident.
 */

/** The 20 SDK tools actually handed to agents (source:'sdk' in /v1/tools). */
const REGISTERED_SDK_TOOLS = [
  'assign_task',
  'bash',
  'delegate',
  'deliver_job',
  'edit_file',
  'escalate_to_human',
  'execute_code',
  'find_agents',
  'job_decompose',
  'list_files',
  'load_skill',
  'read_file',
  'read_job_board',
  'recall',
  'remember',
  'request_verification',
  'search_files',
  'skill_create',
  'skill_patch',
  'write_file',
];

function resolve(names: string[]): { hit: string[]; missing: string[] } {
  const reg = new Set(REGISTERED_SDK_TOOLS);
  return {
    hit: names.filter((n) => reg.has(n)),
    missing: names.filter((n) => !reg.has(n)),
  };
}

describe('allowedTools normalization', () => {
  it('splits the bare comma-separated string shape stored in the DB', () => {
    // This is verbatim what the DB holds for several agents.
    const out = normalizeAllowedTools('WebFetch, WebSearch, Read, Write, Edit');
    // Must be whole tool names, never single characters.
    expect(out).not.toContain('W');
    expect(out).not.toContain(',');
    expect(out.length).toBe(5);
  });

  it('maps documented aliases to registered tool names', () => {
    expect(normalizeAllowedTools('Read, Write, Edit')).toEqual([
      'read_file',
      'write_file',
      'edit_file',
    ]);
    expect(normalizeAllowedTools('Glob, Grep')).toEqual(['list_files', 'search_files']);
  });

  it('accepts the array shape too, and de-duplicates', () => {
    expect(normalizeAllowedTools(['Read', 'read', 'read_file'])).toEqual(['read_file']);
  });

  it('treats absent/empty as "no restriction" (empty list)', () => {
    expect(normalizeAllowedTools(undefined)).toEqual([]);
    expect(normalizeAllowedTools('')).toEqual([]);
    expect(normalizeAllowedTools([])).toEqual([]);
  });
});

describe('the WebFetch/WebSearch capability gap', () => {
  it('leaves WebFetch and WebSearch unresolved rather than silently aliasing them', () => {
    const names = normalizeAllowedTools('WebFetch, WebSearch, Read, Write, Edit');
    const { hit, missing } = resolve(names);

    // The file tools resolve...
    expect(hit).toEqual(['read_file', 'write_file', 'edit_file']);
    // ...and the two web tools do not exist. If this ever fails because a real
    // web tool was registered, update the expectation deliberately.
    expect(missing).toEqual(['WebFetch', 'WebSearch']);
  });

  it('a research agent ends up with file tools only — the gap we must not hide', () => {
    // "Trend Researcher" as actually stored.
    const names = normalizeAllowedTools('WebFetch, WebSearch, Read, Write, Edit');
    const { hit } = resolve(names);
    expect(hit).toHaveLength(3);
    expect(hit.some((t) => /web|fetch|http|url/i.test(t))).toBe(false);
  });

  it('search_files is NOT a web tool — it searches the local filesystem', () => {
    // Guards against "close enough" aliasing in a future change.
    expect(REGISTERED_SDK_TOOLS).toContain('search_files');
    const names = normalizeAllowedTools('WebSearch');
    expect(resolve(names).hit).toEqual([]);
  });
});
