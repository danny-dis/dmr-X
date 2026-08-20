-- 080_attach_research_skills_to_web_agents.sql
--
-- Attach the seeded research skills (migration 079) to the agents that actually
-- do web work.
--
-- Which agents, and why these:
--   NOT a keyword match on the agent name — that sweeps in "Blockchain Security
--   Auditor" and "Accessibility Auditor", which never touch the web. Instead we
--   use the agents' OWN declaration: every agent whose allowed_tools names
--   WebFetch or WebSearch. On this install that is exactly 16 agents (Trend
--   Researcher, SEO Specialist, Pricing Analyst, Content Creator, Growth Hacker,
--   Search Query Analyst, and the paid-media/product roles). They asked for web
--   access, so they are the ones who need the methodology for using it.
--
-- Why attaching still matters even though discovery exists:
--   The runtime now DISCOVERS tenant skills, so every agent can see and load
--   these. Declared skills are additionally listed FIRST in the advertisement
--   block, which is the difference between "available somewhere" and "this is
--   your job's toolkit". Attaching expresses intent and survives any future
--   tightening of discovery.
--
-- Shape of agent_definitions.skills:
--   A JSON array stored as TEXT (e.g. '[]' or '["a","b"]'), read by
--   buildSystemPrompt as definition.skills. We append by NAME because skill ids
--   are random per install (migration 079 generates them with randomblob), while
--   names are stable. SkillLoader.resolveSkills matches on id OR name.
--
-- Idempotency:
--   Each UPDATE is guarded with a LIKE check for the skill name, so re-running
--   never double-appends. Agents that already list the skill are untouched.

-- ---------------------------------------------------------------------------
-- url-hunting-recovery -> agents that requested web tools
-- ---------------------------------------------------------------------------

-- Case 1: skills is empty/NULL/'[]' -> becomes a single-element array.
UPDATE agent_definitions
SET skills = '["url-hunting-recovery"]',
    updated_at = strftime('%s', 'now')
WHERE (skills IS NULL OR trim(skills) = '' OR trim(skills) = '[]')
  AND (
    lower(COALESCE(allowed_tools, '')) LIKE '%webfetch%'
    OR lower(COALESCE(allowed_tools, '')) LIKE '%websearch%'
  );

-- Case 2: skills already holds entries -> append before the closing bracket.
UPDATE agent_definitions
SET skills = substr(trim(skills), 1, length(trim(skills)) - 1) || ',"url-hunting-recovery"]',
    updated_at = strftime('%s', 'now')
WHERE trim(skills) LIKE '[%]'
  AND trim(skills) <> '[]'
  AND skills NOT LIKE '%url-hunting-recovery%'
  AND (
    lower(COALESCE(allowed_tools, '')) LIKE '%webfetch%'
    OR lower(COALESCE(allowed_tools, '')) LIKE '%websearch%'
  );

-- ---------------------------------------------------------------------------
-- grounded-research-brief -> same set
-- ---------------------------------------------------------------------------
-- Runs after the block above, so these agents now have a non-empty array and
-- only the append case can apply.

UPDATE agent_definitions
SET skills = '["grounded-research-brief"]',
    updated_at = strftime('%s', 'now')
WHERE (skills IS NULL OR trim(skills) = '' OR trim(skills) = '[]')
  AND (
    lower(COALESCE(allowed_tools, '')) LIKE '%webfetch%'
    OR lower(COALESCE(allowed_tools, '')) LIKE '%websearch%'
  );

UPDATE agent_definitions
SET skills = substr(trim(skills), 1, length(trim(skills)) - 1) || ',"grounded-research-brief"]',
    updated_at = strftime('%s', 'now')
WHERE trim(skills) LIKE '[%]'
  AND trim(skills) <> '[]'
  AND skills NOT LIKE '%grounded-research-brief%'
  AND (
    lower(COALESCE(allowed_tools, '')) LIKE '%webfetch%'
    OR lower(COALESCE(allowed_tools, '')) LIKE '%websearch%'
  );
