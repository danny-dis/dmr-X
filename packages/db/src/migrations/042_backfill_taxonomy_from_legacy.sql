-- Backfill 9-dimension taxonomy columns from legacy intelligence_layer and capability_tier
-- This migration populates the new columns for existing models

-- Backfill context_tier from context_window
UPDATE model_profiles SET context_tier = 'short' WHERE context_tier = 'medium' AND context_window < 32000;
UPDATE model_profiles SET context_tier = 'medium' WHERE context_tier = 'medium' AND context_window >= 32000 AND context_window < 128000;
UPDATE model_profiles SET context_tier = 'long' WHERE context_tier = 'medium' AND context_window >= 128000 AND context_window < 1000000;
UPDATE model_profiles SET context_tier = 'ultra' WHERE context_tier = 'medium' AND context_window >= 1000000 AND context_window < 10000000;
UPDATE model_profiles SET context_tier = 'massive' WHERE context_tier = 'medium' AND context_window >= 10000000;

-- Backfill deployment from provider name
UPDATE model_profiles SET deployment = 'self_hosted' WHERE deployment = 'cloud' AND provider_id IN (
  SELECT id FROM providers WHERE name IN ('ollama', 'vllm', 'llamacpp', 'localai', 'lmstudio')
);

-- Backfill task_categories from specializations (basic mapping)
UPDATE model_profiles SET task_categories = '["reasoning"]' WHERE task_categories = '["general"]' AND supports_reasoning = 1;
UPDATE model_profiles SET task_categories = '["code"]' WHERE task_categories = '["general"]' AND model_id LIKE '%codestral%' OR model_id LIKE '%coder%';
UPDATE model_profiles SET task_categories = '["embedding"]' WHERE task_categories = '["general"]' AND modality = 'embedding';
UPDATE model_profiles SET task_categories = '["tts"]' WHERE task_categories = '["general"]' AND modality = 'audio_tts';
UPDATE model_profiles SET task_categories = '["stt"]' WHERE task_categories = '["general"]' AND modality = 'audio_stt';
UPDATE model_profiles SET task_categories = '["image_generation"]' WHERE task_categories = '["general"]' AND modality = 'diffusion';
UPDATE model_profiles SET task_categories = '["moderation"]' WHERE task_categories = '["general"]' AND modality = 'moderation';

-- Backfill reasoning_mode from capabilities
UPDATE model_profiles SET reasoning_mode = 'hybrid' WHERE reasoning_mode = 'fixed' AND supports_reasoning = 1 AND model_id LIKE '%deepseek%';
UPDATE model_profiles SET reasoning_mode = 'adaptive' WHERE reasoning_mode = 'fixed' AND model_id LIKE '%gpt-5%';

-- Backfill agentic_level from capabilities
UPDATE model_profiles SET agentic_level = 'tool_use' WHERE agentic_level = 'chat' AND supports_tool_use = 1;

-- Log completion
SELECT 'Backfill complete: ' || changes || ' rows updated' FROM (SELECT COUNT(*) as changes FROM model_profiles WHERE context_tier != 'medium');
