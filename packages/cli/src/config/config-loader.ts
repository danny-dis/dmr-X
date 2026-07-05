import fs from 'node:fs';
import path from 'node:path';

/**
 * YAML Config Loader for DMR-X.
 *
 * Mirrors LiteLLM's config.yaml format:
 *   model_list:
 *     - model_name: gpt-4o
 *       litellm_params:
 *         model: openai/gpt-4o
 *         api_key: os.environ/OPENAI_API_KEY
 *   router_settings:
 *     routing_strategy: least-busy
 *   general_settings:
 *     master_key: sk-1234
 *
 * Supports:
 * - Environment variable interpolation: os.environ/VAR_NAME
 * - Model list configuration
 * - Router settings
 * - General settings
 * - Environment variables section
 */

export interface ModelListItem {
  model_name: string;
  litellm_params: {
    model: string;
    api_key?: string;
    api_base?: string;
    api_version?: string;
    rpm?: number;
    tpm?: number;
    temperature?: number;
    max_tokens?: number;
    [key: string]: unknown;
  };
  model_info?: {
    version?: number;
    supported_environments?: string[];
    tags?: string[];
    [key: string]: unknown;
  };
}

export interface RouterSettings {
  routing_strategy?: 'simple-shuffle' | 'least-busy' | 'usage-based-routing' | 'latency-based-routing';
  num_retries?: number;
  timeout?: number;
  allowed_fails?: number;
  model_group_alias?: Record<string, string>;
  redis_host?: string;
  redis_password?: string;
  redis_port?: number;
  [key: string]: unknown;
}

export interface LitellmSettings {
  drop_params?: boolean;
  set_verbose?: boolean;
  success_callback?: string[];
  failure_callback?: string[];
  cache?: boolean | { type: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface GeneralSettings {
  master_key?: string;
  alerting?: string[];
  alerting_webhook?: string;
  database_url?: string;
  sso_provider?: string;
  [key: string]: unknown;
}

export interface DMRXConfig {
  model_list: ModelListItem[];
  router_settings: RouterSettings;
  litellm_settings: LitellmSettings;
  general_settings: GeneralSettings;
  environment_variables: Record<string, string>;
}

/**
 * Load and parse a DMR-X config.yaml file.
 */
export function loadConfig(configPath: string): DMRXConfig {
  const content = fs.readFileSync(configPath, 'utf-8');
  return parseYamlConfig(content);
}

/**
 * Parse YAML config content.
 * Uses a lightweight YAML parser (no external deps).
 */
function parseYamlConfig(content: string): DMRXConfig {
  const config: DMRXConfig = {
    model_list: [],
    router_settings: {},
    litellm_settings: {},
    general_settings: {},
    environment_variables: {},
  };

  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentModel: Partial<ModelListItem> | null = null;
  let currentSubSection: string | null = null;
  const indent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const lineIndent = line.search(/\S/);

    // Top-level section
    if (lineIndent === 0 && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1).trim();
      currentModel = null;
      currentSubSection = null;
      continue;
    }

    // Model list items
    if (currentSection === 'model_list') {
      if (trimmed.startsWith('- model_name:')) {
        currentModel = { model_name: trimmed.split(':')[1].trim() };
        currentSubSection = null;
        config.model_list.push(currentModel as ModelListItem);
        continue;
      }
      if (currentModel) {
        if (trimmed.startsWith('litellm_params:') || trimmed.startsWith('model_info:')) {
          currentSubSection = trimmed.split(':')[0].trim();
          continue;
        }
        if (currentSubSection === 'litellm_params') {
          const [key, ...rest] = trimmed.split(':');
          const value = rest.join(':').trim();
          if (!currentModel.litellm_params) currentModel.litellm_params = { model: '' };
          (currentModel.litellm_params as any)[key.trim()] = interpolateEnvVars(value);
        }
        if (currentSubSection === 'model_info') {
          const [key, ...rest] = trimmed.split(':');
          const value = rest.join(':').trim();
          if (!currentModel.model_info) currentModel.model_info = {};
          (currentModel.model_info as any)[key.trim()] = parseValue(value);
        }
      }
    }

    // Router settings
    if (currentSection === 'router_settings' && lineIndent > 0) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      (config.router_settings as any)[key.trim()] = parseValue(value);
    }

    // Litellm settings
    if (currentSection === 'litellm_settings' && lineIndent > 0) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      if (trimmed.endsWith(':') && !value) {
        currentSubSection = key.trim();
      } else if (currentSubSection && key.trim() === '') {
        // Array item (e.g., success_callback: ["langfuse"])
        (config.litellm_settings as any)[currentSubSection] = parseArray(value);
        currentSubSection = null;
      } else {
        (config.litellm_settings as any)[key.trim()] = parseValue(value);
        currentSubSection = null;
      }
    }

    // General settings
    if (currentSection === 'general_settings' && lineIndent > 0) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      (config.general_settings as any)[key.trim()] = parseValue(value);
    }

    // Environment variables
    if (currentSection === 'environment_variables' && lineIndent > 0) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      config.environment_variables[key.trim()] = interpolateEnvVars(value);
    }
  }

  return config;
}

/**
 * Interpolate environment variables in config values.
 * Supports: os.environ/VAR_NAME, os.getenv("VAR_NAME")
 */
function interpolateEnvVars(value: string): string {
  if (!value) return value;

  // os.environ/VAR_NAME pattern
  const envMatch = value.match(/^os\.environ\/(.+)$/);
  if (envMatch) {
    return process.env[envMatch[1]] || '';
  }

  // os.getenv("VAR_NAME") pattern
  const getenvMatch = value.match(/^os\.getenv\(["'](.+?)["']\)$/);
  if (getenvMatch) {
    return process.env[getenvMatch[1]] || '';
  }

  // Plain environment variable: ${VAR_NAME}
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] || '');
}

function parseValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '') return null;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return interpolateEnvVars(value);
}

function parseArray(value: string): unknown[] {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * Convert a DMRXConfig to provider configurations for adapter initialization.
 */
export function configToProviderConfigs(config: DMRXConfig): Array<{
  providerId: string;
  modelId: string;
  config: Record<string, unknown>;
}> {
  const results: Array<{
    providerId: string;
    modelId: string;
    config: Record<string, unknown>;
  }> = [];

  for (const item of config.model_list) {
    const model = item.litellm_params.model;
    const parts = model.split('/');
    let providerId = 'openai'; // default
    let modelId = model;

    if (parts.length > 1) {
      providerId = parts[0];
      modelId = parts.slice(1).join('/');
    }

    results.push({
      providerId,
      modelId,
      config: {
        baseUrl: item.litellm_params.api_base,
        apiKey: item.litellm_params.api_key,
        apiVersion: item.litellm_params.api_version,
        rpm: item.litellm_params.rpm,
        tpm: item.litellm_params.tpm,
        temperature: item.litellm_params.temperature,
        maxTokens: item.litellm_params.max_tokens,
      },
    });
  }

  return results;
}
