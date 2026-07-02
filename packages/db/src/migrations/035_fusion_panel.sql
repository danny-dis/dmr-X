-- Fusion Panel persistence
-- Stores multi-model parallel execution configurations

CREATE TABLE IF NOT EXISTS fusion_panels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fusion_panel_slots (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES fusion_panels(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slot_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fusion_panel_slots_panel
ON fusion_panel_slots(panel_id, slot_order);

CREATE INDEX IF NOT EXISTS idx_fusion_panels_active
ON fusion_panels(is_active)
WHERE is_active = 1;
