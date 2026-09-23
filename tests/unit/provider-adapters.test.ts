import { describe, it, expect } from 'vitest';
import {
  getProviderAdapter,
  hasProviderAdapter,
  getRegisteredProviders,
  type ScopeInfo,
  type ProviderQuotaAdapter,
} from '../../services/quota/src/provider-adapters.js';
import { QuotaUnit } from '../../services/quota/src/quota-dimensions.js';

function makeScopeInfo(overrides: Partial<ScopeInfo> = {}): ScopeInfo {
  return { keyId: 'key-123', modelId: 'test-model', ...overrides };
}

describe('adapter registry', () => {
  it('returns correct adapter for known providers', () => {
    expect(getProviderAdapter('gemini').providerId).toBe('gemini');
    expect(getProviderAdapter('groq').providerId).toBe('groq');
    expect(getProviderAdapter('cerebras').providerId).toBe('cerebras');
    expect(getProviderAdapter('sambanova').providerId).toBe('sambanova');
    expect(getProviderAdapter('openrouter').providerId).toBe('openrouter');
    expect(getProviderAdapter('mistral').providerId).toBe('mistral');
    expect(getProviderAdapter('cohere').providerId).toBe('cohere');
    expect(getProviderAdapter('cloudflare').providerId).toBe('cloudflare');
    expect(getProviderAdapter('huggingface').providerId).toBe('huggingface');
    expect(getProviderAdapter('nvidia').providerId).toBe('nvidia');
  });

  it('returns generic adapter for unknown providers', () => {
    const adapter = getProviderAdapter('unknown-provider-xyz');
    expect(adapter.providerId).toBe('generic');
  });

  it('reports hasProviderAdapter correctly', () => {
    expect(hasProviderAdapter('gemini')).toBe(true);
    expect(hasProviderAdapter('unknown')).toBe(false);
  });

  it('returns all registered providers', () => {
    const providers = getRegisteredProviders();
    expect(providers).toContain('gemini');
    expect(providers).toContain('groq');
    expect(providers).toContain('cloudflare');
    expect(providers).toContain('nvidia');
  });
});

describe('generic adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('unknown');
  });

  it('parses standard x-ratelimit-* headers', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '999',
      'x-ratelimit-limit-tokens': '100000',
      'x-ratelimit-remaining-tokens': '99999',
    }, makeScopeInfo());

    expect(dims.length).toBeGreaterThanOrEqual(2);
    expect(dims.some(d => d.unit === 'requests')).toBe(true);
    expect(dims.some(d => d.unit === 'total_tokens')).toBe(true);
  });

  it('classifies 429 as cooling_down', () => {
    const event = adapter.classifyError({ status: 429, message: 'Rate limited' });
    expect(event.state).toBe('cooling_down');
    expect(event.retryable).toBe(true);
  });

  it('classifies 401 as non-retryable', () => {
    const event = adapter.classifyError({ status: 401, message: 'Unauthorized' });
    expect(event.retryable).toBe(false);
  });

  it('classifies 400 as non-retryable', () => {
    const event = adapter.classifyError({ status: 400, message: 'Bad request' });
    expect(event.retryable).toBe(false);
  });
});

describe('gemini adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('gemini');
  });

  it('parses gemini headers with project scope', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '1500',
      'x-ratelimit-remaining-requests': '1400',
      'x-ratelimit-limit-tokens': '1000000',
      'x-ratelimit-remaining-tokens': '999000',
    }, makeScopeInfo({ projectId: 'proj-abc' }));

    expect(dims.some(d => d.scope === 'project')).toBe(true);
    expect(dims.some(d => d.scopeId === 'proj-abc')).toBe(true);
    const rpmDim = dims.find(d => d.unit === 'requests');
    expect(rpmDim).toBeDefined();
    expect(rpmDim!.remaining).toBe(1400);
  });

  it('classifies 429 as cooling_down with requests dimension', () => {
    const event = adapter.classifyError({ status: 429, message: 'Rate limited' });
    expect(event.state).toBe('cooling_down');
    expect(event.dimension).toBe('requests');
  });

  it('classifies 400 with API key message as auth failure', () => {
    const event = adapter.classifyError({ status: 400, message: 'API key invalid' });
    expect(event.retryable).toBe(false);
    expect(event.reason).toContain('key');
  });
});

describe('groq adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('groq');
  });

  it('parses groq headers', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '500',
      'x-ratelimit-reset-requests': '60',
      'x-ratelimit-limit-tokens': '100000',
      'x-ratelimit-remaining-tokens': '90000',
      'x-ratelimit-reset-tokens': '60',
    }, makeScopeInfo());

    expect(dims.some(d => d.unit === 'requests')).toBe(true);
    expect(dims.some(d => d.unit === 'total_tokens')).toBe(true);
    const tokDim = dims.find(d => d.unit === 'total_tokens');
    expect(tokDim!.replenishment).toBe('sliding_window');
  });
});

describe('cerebras adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('cerebras');
  });

  it('uses token_bucket replenishment', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '99',
    }, makeScopeInfo());

    expect(dims[0].replenishment).toBe('token_bucket');
  });
});

describe('sambanova adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('sambanova');
  });

  it('produces separate minute and daily dimensions', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '50',
      'x-ratelimit-remaining-requests': '45',
      'x-ratelimit-limit-requests-day': '1000',
      'x-ratelimit-remaining-requests-day': '950',
      'x-ratelimit-limit-tokens-day': '500000',
      'x-ratelimit-remaining-tokens-day': '499000',
    }, makeScopeInfo());

    const scopeIds = dims.map(d => d.scopeId);
    expect(scopeIds).toContain('key-123:daily');
    expect(dims.some(d => d.scopeId === 'key-123:daily')).toBe(true);
    expect(dims.some(d => d.replenishment === 'fixed_window')).toBe(true);
  });
});

describe('mistral adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('mistral');
  });

  it('parses minute-specific header names', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-req-minute': '50',
      'x-ratelimit-remaining-req-minute': '45',
      'x-ratelimit-limit-tokens-minute': '50000',
      'x-ratelimit-remaining-tokens-minute': '49000',
    }, makeScopeInfo());

    expect(dims.length).toBeGreaterThanOrEqual(2);
    expect(dims.some(d => d.unit === 'requests')).toBe(true);
    expect(dims.some(d => d.unit === 'total_tokens')).toBe(true);
  });
});

describe('cloudflare adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('cloudflare');
  });

  it('tracks neurons', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-neurons': '10000',
      'x-ratelimit-remaining-neurons': '9500',
    }, makeScopeInfo({ accountId: 'acct-1' }));

    expect(dims.some(d => d.unit === 'neurons')).toBe(true);
    expect(dims.some(d => d.scope === 'account')).toBe(true);
    const neuronDim = dims.find(d => d.unit === 'neurons');
    expect(neuronDim!.remaining).toBe(9500);
  });

  it('classifies 429 as neurons exhausted', () => {
    const event = adapter.classifyError({ status: 429 });
    expect(event.state).toBe('cooling_down');
    expect(event.reason).toContain('neurons');
  });
});

describe('openrouter adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('openrouter');
  });

  it('parses headers with account scope', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '50',
    }, makeScopeInfo());

    expect(dims.some(d => d.scope === 'account')).toBe(true);
  });

  it('classifies 402 as account exhausted', () => {
    const event = adapter.classifyError({ status: 402 });
    expect(event.state).toBe('exhausted');
    expect(event.retryable).toBe(false);
  });
});

describe('huggingface adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('huggingface');
  });

  it('classifies 402 as monthly credit exhausted', () => {
    const event = adapter.classifyError({ status: 402 });
    expect(event.state).toBe('exhausted');
    expect(event.reason).toContain('credit');
  });
});

describe('nvidia adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('nvidia');
  });

  it('parses headers with model scope', () => {
    const dims = adapter.parseHeaders({
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '95',
    }, makeScopeInfo());

    expect(dims.some(d => d.scope === 'model')).toBe(true);
  });
});

describe('cohere adapter', () => {
  let adapter: ProviderQuotaAdapter;

  beforeEach(() => {
    adapter = getProviderAdapter('cohere');
  });

  it('parses trial endpoint headers', () => {
    const dims = adapter.parseHeaders({
      'x-trial-endpoint-call-limit': '40',
      'x-trial-endpoint-call-remaining': '35',
    }, makeScopeInfo({ accountId: 'cohere-trial' }));

    expect(dims.length).toBeGreaterThanOrEqual(1);
    expect(dims.some(d => d.scope === 'account')).toBe(true);
    const reqDim = dims.find(d => d.unit === 'requests');
    expect(reqDim!.remaining).toBe(35);
    expect(reqDim!.limit).toBe(40);
  });

  it('classifies 402 as trial exhausted', () => {
    const event = adapter.classifyError({ status: 402 });
    expect(event.state).toBe('exhausted');
  });
});

describe('adapter behavior invariants', () => {
  it('parseHeaders never throws for empty headers', () => {
    const adapters = getRegisteredProviders();
    for (const provider of adapters) {
      const adapter = getProviderAdapter(provider);
      expect(() => adapter.parseHeaders({}, makeScopeInfo())).not.toThrow();
    }
  });

  it('classifyError never throws for null error', () => {
    const adapter = getProviderAdapter('gemini');
    expect(() => adapter.classifyError({})).not.toThrow();
  });

  it('estimateDemand returns reasonable defaults', () => {
    const adapter = getProviderAdapter('groq');
    const demand = adapter.estimateDemand({});
    expect(demand.requests).toBe(1);
    expect(demand.inputTokens).toBeGreaterThan(0);
    expect(demand.outputTokens).toBeGreaterThan(0);
    expect(demand.concurrency).toBe(1);
  });
});
