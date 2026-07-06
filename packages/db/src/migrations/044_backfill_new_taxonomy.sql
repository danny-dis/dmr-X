-- Backfill taxonomy data for existing models
-- This migration populates architecture and other taxonomy fields for models
-- that were registered before the taxonomy system was fully adopted.

-- Backfill architecture tier from model_id patterns
UPDATE model_profiles SET architecture = 'moe'
WHERE architecture IS NULL AND (
  model_id LIKE '%mixtral%' OR
  model_id LIKE '%grok%' OR
  model_id LIKE '%mistral-large%' OR
  model_id LIKE '%deepseek-v3%' OR
  model_id LIKE '%deepseek-v4%' OR
  model_id LIKE '%qwen%235b%' OR
  model_id LIKE '%phi-4-moe%'
);

UPDATE model_profiles SET architecture = 'ssm'
WHERE architecture IS NULL AND (
  model_id LIKE '%mamba%' OR
  model_id LIKE '%jamba%'
);

UPDATE model_profiles SET architecture = 'hybrid'
WHERE architecture IS NULL AND (
  model_id LIKE '%zamba%' OR
  model_id LIKE '%jamba-hybrid%'
);

UPDATE model_profiles SET architecture = 'dense'
WHERE architecture IS NULL AND (
  model_id LIKE '%gpt%' OR
  model_id LIKE '%claude%' OR
  model_id LIKE '%gemini%' OR
  model_id LIKE '%llama%' OR
  model_id LIKE '%phi%' OR
  model_id LIKE '%qwen%' OR
  model_id LIKE '%mistral%' OR
  model_id LIKE '%yi%' OR
  model_id LIKE '%command%' OR
  model_id LIKE '%embed%' OR
  model_id LIKE '%whisper%' OR
  model_id LIKE '%dall%' OR
  model_id LIKE '%stable%' OR
  model_id LIKE '%flux%'
);

-- Default remaining to unknown
UPDATE model_profiles SET architecture = 'unknown' WHERE architecture IS NULL;

-- Backfill context_tier from context_window (for models that still have default 'medium')
UPDATE model_profiles SET context_tier = 'short' WHERE context_tier = 'medium' AND context_window < 32000;
UPDATE model_profiles SET context_tier = 'medium' WHERE context_tier = 'medium' AND context_window >= 32000 AND context_window < 128000;
UPDATE model_profiles SET context_tier = 'long' WHERE context_tier = 'medium' AND context_window >= 128000 AND context_window < 1000000;
UPDATE model_profiles SET context_tier = 'ultra' WHERE context_tier = 'medium' AND context_window >= 1000000 AND context_window < 10000000;
UPDATE model_profiles SET context_tier = 'massive' WHERE context_tier = 'medium' AND context_window >= 10000000;

-- Backfill deployment from provider name (for models that still have default 'cloud')
UPDATE model_profiles SET deployment = 'self_hosted' WHERE deployment = 'cloud' AND provider_id IN (
  SELECT id FROM providers WHERE name IN ('ollama', 'vllm', 'llamacpp', 'localai', 'lmstudio')
);

-- Backfill agentic_level from capabilities (for models that still have default 'chat')
UPDATE model_profiles SET agentic_level = 'tool_use' WHERE agentic_level = 'chat' AND supports_tool_use = 1;
UPDATE model_profiles SET agentic_level = 'autonomous' WHERE agentic_level = 'chat' AND (
  model_id LIKE '%gpt-5%' OR
  model_id LIKE '%gemini%pro%' OR
  model_id LIKE '%grok%4%'
);
