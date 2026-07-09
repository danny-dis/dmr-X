-- Skill pinning flag
-- Pinned skills are curated/safe and CANNOT be auto-patched by the
-- autonomous agent path (patchSkillContent / createSkillFromAgent).
-- 0 = false (mutable), 1 = true (pinned, mutation forbidden).

ALTER TABLE skills ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
