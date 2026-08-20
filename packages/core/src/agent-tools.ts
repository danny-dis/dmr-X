/**
 * Normalisation for an agent definition's `allowedTools`.
 *
 * Lives in core because both the gateway (which resolves tool schemas) and the
 * agent runtime (which names the tools in the system prompt) have to agree on
 * the answer, and `services/*` cannot import from `apps/*`.
 */

/**
 * Imported agent definitions name their tools the way Claude Code subagents do
 * — `Read`, `Write`, `Bash` — while this gateway registers `read_file`,
 * `write_file`, `bash`. Without a translation every imported agent resolves to
 * zero tools, so an agent whose whole purpose is editing files silently gets
 * none. Names with no local equivalent (Task) are deliberately absent and are
 * dropped later by the tool-existence filter.
 */
const IMPORTED_TOOL_ALIASES: Record<string, string> = {
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  multiedit: 'edit_file',
  notebookedit: 'edit_file',
  bash: 'bash',
  shell: 'bash',
  glob: 'list_files',
  ls: 'list_files',
  list: 'list_files',
  grep: 'search_files',
  search: 'search_files',
  webfetch: 'web_fetch',
  websearch: 'web_search',
};

/**
 * Coerce an agent's `allowedTools` into registered tool names.
 *
 * Frontmatter written as `tools: Read, Write, Edit` (no brackets) was stored by
 * the config loader as a bare string. Consumers declared `string[]`, so nothing
 * caught it, and a string's truthy `.length` carried it into `.map()` and
 * `.join()` — neither of which a string supports in the way those call sites
 * assumed — throwing before the agent could run at all. Accepting both shapes
 * keeps already-imported agents working without a data migration.
 */
export function normalizeAllowedTools(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const out: string[] = [];
  for (const entry of raw) {
    const name = String(entry).trim();
    if (!name) continue;
    const mapped = IMPORTED_TOOL_ALIASES[name.toLowerCase()] ?? name;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}
