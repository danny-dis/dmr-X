/**
 * Standardized provider identifiers.
 * Adapted from OpenRouter SDK's ProviderName enum with DMR-X slug conventions.
 */
export const PROVIDER_SLUGS = {
    // Major cloud LLM providers
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    googleAiStudio: 'google-ai-studio',
    googleVertex: 'google-vertex',
    azure: 'azure',
    amazonBedrock: 'amazon-bedrock',
    amazonNova: 'amazon-nova',
    mistral: 'mistral',
    cohere: 'cohere',
    deepseek: 'deepseek',
    xai: 'xai',
    // Inference platforms
    groq: 'groq',
    cerebras: 'cerebras',
    fireworks: 'fireworks',
    together: 'together',
    sambanova: 'sambanova',
    deepinfra: 'deepinfra',
    novita: 'novita',
    nebius: 'nebius',
    lambda: 'lambda',
    lepton: 'lepton',
    perplexity: 'perplexity',
    hyperbolic: 'hyperbolic',
    fireAI: 'fire-ai',
    nebula: 'nebula',
    klusterai: 'klusterai',
    baseten: 'baseten',
    octoai: 'octoai',
    anyscale: 'anyscale',
    modal: 'modal',
    rep: 'rep',
    // Chinese / Asian providers
    alibaba: 'alibaba',
    baidu: 'baidu',
    moonshotai: 'moonshot-ai',
    zhipu: 'zhipu',
    minimax: 'minimax',
    stepfun: 'stepfun',
    siliconflow: 'siliconflow',
    byteplus: 'byteplus',
    xiaomi: 'xiaomi',
    seed: 'seed',
    // Free-tier / edge providers
    cloudflare: 'cloudflare',
    nvidia: 'nvidia',
    featherless: 'featherless',
    chutes: 'chutes',
    venice: 'venice',
    upstage: 'upstage',
    reka: 'reka',
    liquid: 'liquid',
    inflection: 'inflection',
    poolside: 'poolside',
    recraft: 'recraft',
    relace: 'relace',
    morph: 'morph',
    inception: 'inception',
    // Local / self-hosted
    ollama: 'ollama',
    lmstudio: 'lmstudio',
    vllm: 'vllm',
    textgen: 'textgen',
    // Specialized
    elevenlabs: 'elevenlabs',
    deepgram: 'deepgram',
    stability: 'stability',
    replicate: 'replicate',
    jina: 'jina',
    wandb: 'wandb',
};
/**
 * Canonical provider ID used internally by DMR-X.
 * Maps common aliases to a canonical form.
 */
const PROVIDER_ALIASES = {
    'open-ai': 'openai',
    'open_ai': 'openai',
    'gpt': 'openai',
    'claude': 'anthropic',
    'anthropic-bedrock': 'amazon-bedrock',
    'anthropic-vertex': 'google-vertex',
    'gcp': 'google-vertex',
    'aws': 'amazon-bedrock',
    'ollama-local': 'ollama',
    'github': 'github-models',
    'nvidia-nim': 'nvidia',
    'cf': 'cloudflare',
};
/**
 * Resolve a provider string to its canonical slug.
 * Handles aliases, case normalization, and common variations.
 */
export function resolveProviderSlug(input) {
    const normalized = input.toLowerCase().trim();
    return PROVIDER_ALIASES[normalized] || normalized;
}
//# sourceMappingURL=providers.js.map