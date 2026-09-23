# Jev Routing Integration Plan

## Purpose

Integrate Jev (TypeSafe AI's classifier model) as a routing preprocessor in DMR-X's request pipeline. Jev replaces keyword-based turn-type detection and static quality-target mapping with learned classification, and provides informed priors for the Thompson Sampling bandit.

This document is an implementation contract. It specifies the exact files to create/modify, the API contracts, and the verification criteria.

## Background

### What Jev Is

Jev is a "System One Model" — a pure classifier from TypeSafe AI (founded by Diogo Almeida, ChatGPT co-inventor). It does not generate text. Given an input and an output schema (questions + allowed answers), it returns a probability distribution over answers.

- **Latency**: ~200ms per query
- **Cost**: $0.04/M input tokens, $0.00 output tokens
- **Context**: 64,000 tokens
- **Capabilities**: Structured output only (no text generation, no tool calling, no reasoning)
- **Free tier**: `jev-1.13-free` on OpenCode Zen ($0.00/$0.00)

### Why Jev Fits DMR-X

DMR-X's routing pipeline has 4 classification stages that are currently rule-based:

1. **Turn-type detection** (`turn-type.ts`) — keyword matching
2. **Capability extraction** (`capability-extractor.ts`) — structural detection
3. **Quality target inference** (`task-classifier.ts`) — static mapping
4. **Thompson Sampling** (`thompson-sampler.ts`) — blind exploration

Jev improves all 4 by providing learned classification with confidence scores.

### Architecture

```
Request
  │
  ▼
┌─────────────────────────────────────┐
│  Jev Classifier (new)               │
│  - task_type: code_gen|q_a|...      │
│  - capabilities: vision|tool_use|.. │
│  - quality_tier: frontier|balanced| │
│  - confidence: 0.0-1.0              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Jev Prior Store (new)              │
│  - Persists classifications to DB   │
│  - Replays priors when Jev offline  │
│  - Learns from Jev, uses learning   │
│    even when Jev is unavailable     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Thompson Sampler (modified)        │
│  - Informed priors from Jev         │
│  - Still learns from real rewards   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Execute with Fallback              │
│  - Unchanged                        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Calculate Reward                   │
│  - Unchanged                        │
└─────────────────────────────────────┘
```

Jev is a **sidecar**, not a model replacement. It sits before the bandit, providing a prior. The bandit still learns from real rewards.

### Learning Persistence

Jev's classifications are persisted to the `jev_priors` table. When Jev is unavailable, the router replays stored priors for similar requests. This means:

- **Jev available**: Classify → save to DB → use for routing
- **Jev unavailable**: Hash request → look up DB → replay stored classification → use for routing

The system learns from Jev's classifications and retains that knowledge even when Jev is offline.

## Implementation Plan

### Phase 1: Jev Adapter Service

**Goal**: Create a Jev adapter that translates DMR-X's `UnifiedRequest` → Jev's input+schema format, and Jev's probability output → a structured `JevClassification` result.

#### New File: `services/router/src/classifier/jev-classifier.ts`

```typescript
import type { UnifiedRequest } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

export interface JevClassification {
  taskType: {
    value: string;
    confidence: number;
  };
  capabilities: Array<{
    value: string;
    confidence: number;
  }>;
  qualityTier: {
    value: 'frontier' | 'balanced' | 'economy';
    confidence: number;
  };
  latencyMs: number;
}

export interface JevConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  timeoutMs: number;
  enabled: boolean;
}

const TASK_TYPE_SCHEMA = {
  question: "What type of task is this request?",
  options: [
    "code_gen",
    "q_a",
    "creative",
    "summarization",
    "translation",
    "data_analysis",
    "tool_use",
    "general",
  ],
};

const CAPABILITY_SCHEMA = {
  question: "What capabilities does this request need?",
  options: [
    "vision",
    "tool_use",
    "json_mode",
    "reasoning",
    "long_context",
    "code",
  ],
};

const QUALITY_TIER_SCHEMA = {
  question: "What capability tier does this request require?",
  options: ["frontier", "balanced", "economy"],
};

export class JevClassifier {
  private config: JevConfig;

  constructor(config: JevConfig) {
    this.config = config;
  }

  async classify(request: UnifiedRequest): Promise<JevClassification | null> {
    if (!this.config.enabled) return null;

    const startTime = Date.now();

    try {
      const input = this.buildInput(request);

      const [taskType, capabilities, qualityTier] = await Promise.all([
        this.classifyField(input, TASK_TYPE_SCHEMA),
        this.classifyField(input, CAPABILITY_SCHEMA),
        this.classifyField(input, QUALITY_TIER_SCHEMA),
      ]);

      return {
        taskType,
        capabilities,
        qualityTier,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.warn({ err: error }, 'Jev classification failed, falling back to rule-based');
      return null;
    }
  }

  private buildInput(request: UnifiedRequest): string {
    const messages = request.messages ?? [];
    const userText = messages
      .filter((m) => m.role === "user")
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n");
        }
        return "";
      })
      .join("\n");

    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    return `System: ${systemText}\n\nUser: ${userText}`;
  }

  private async classifyField(
    input: string,
    schema: { question: string; options: string[] },
  ): Promise<{ value: string; confidence: number }> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelId,
        messages: [
          {
            role: "user",
            content: `${schema.question}\n\nInput: ${input}\n\nOptions: ${schema.options.join(", ")}`,
          },
        ],
        response_format: {
          type: "json_object",
          schema: {
            type: "object",
            properties: {
              answer: { type: "string", enum: schema.options },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["answer", "confidence"],
          },
        },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Jev API error: ${response.status}`);
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);

    return {
      value: content.answer,
      confidence: content.confidence ?? 0.5,
    };
  }
}
```

#### New File: `services/router/src/classifier/jev-config.ts`

```typescript
import type { JevConfig } from "./jev-classifier.js";

export function loadJevConfig(): JevConfig {
  return {
    baseUrl: process.env.JEV_BASE_URL ?? "https://opencode.ai/zen/v1",
    apiKey: process.env.JEV_API_KEY ?? "",
    modelId: process.env.JEV_MODEL_ID ?? "jev-1.13-free",
    timeoutMs: parseInt(process.env.JEV_TIMEOUT_MS ?? "5000", 10),
    enabled: process.env.JEV_ENABLED === "true",
  };
}
```

### Phase 2: Router Integration

**Goal**: Wire Jev into the router pipeline. Jev's classification feeds into the Thompson Sampler as informed priors.

#### Modified File: `services/router/src/router.service.ts`

Add Jev classification to the routing pipeline:

```typescript
import { JevClassifier, loadJevConfig } from "./classifier/jev-classifier.js";

// In Router class:
private jevClassifier: JevClassifier;

constructor(private readonly config: RouterConfig = {}) {
  // ... existing initialization
  this.jevClassifier = new JevClassifier(loadJevConfig());
}

// In the routing method (before Thompson Sampling):
async route(request: UnifiedRequest): Promise<UnifiedResponse> {
  // 1. Classify with Jev (if enabled)
  const jevClassification = await this.jevClassifier.classify(request);

  // 2. Build task profile (merge Jev + rule-based)
  const taskProfile = classifyTask(request, {
    path: request.path,
    qualityTarget: this.config.defaultQualityTarget,
  });

  // 3. Override with Jev's classification if confidence is high
  if (jevClassification) {
    if (jevClassification.taskType.confidence > 0.7) {
      taskProfile.turnType = jevClassification.taskType.value as any;
    }
    if (jevClassification.qualityTier.confidence > 0.7) {
      taskProfile.requiredCapabilityTier = jevClassification.qualityTier.value as any;
    }
    // Merge capabilities
    const jevCaps = jevClassification.capabilities
      .filter((c) => c.confidence > 0.6)
      .map((c) => c.value);
    taskProfile.capabilities = [...new Set([...taskProfile.capabilities, ...jevCaps])];
  }

  // 4. Select candidate using Thompson Sampling (informed by Jev)
  const candidate = this.thompsonSampler.select(
    this.candidates,
    taskProfile.qualityTarget,
    jevClassification, // NEW: pass Jev's classification as prior
  );

  // 5. Execute with fallback (unchanged)
  return this.executeWithFallback(candidate, request);
}
```

#### Modified File: `services/router/src/bandit/thompson-sampler.ts`

Add informed priors from Jev:

```typescript
import type { JevClassification } from "../classifier/jev-classifier.js";

// In select() method, add jevClassification parameter:
select(
  candidates: CandidateSet,
  qualityTarget: QualityTarget,
  jevClassification?: JevClassification | null,
): ProviderModel {
  if (candidates.length === 0) {
    throw new Error("No candidates available");
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const samples = candidates.map((candidate) => {
    const armKey = this.getArmKey(candidate);
    const arm = this.getArm(armKey);
    let sample = this.sampleBeta(arm.alpha, arm.beta);

    // NEW: Apply Jev's informed prior
    if (jevClassification) {
      sample = this.applyJevPrior(sample, candidate, jevClassification);
    }

    const adjustedSample = this.adjustByQualityTarget(sample, candidate, qualityTarget);
    return { candidate, sample: adjustedSample };
  });

  samples.sort((a, b) => b.sample - a.sample);
  return samples[0].candidate;
}

private applyJevPrior(
  sample: number,
  candidate: ProviderModel,
  jev: JevClassification,
): number {
  // If Jev says this is a code_gen task with high confidence,
  // boost code-specialist models
  if (jev.taskType.confidence > 0.7) {
    const taskType = jev.taskType.value;
    const modelTags = candidate.tags ?? [];

    // Boost matching models
    if (
      (taskType === "code_gen" && modelTags.includes("code")) ||
      (taskType === "q_a" && modelTags.includes("fast")) ||
      (taskType === "summarization" && modelTags.includes("balanced"))
    ) {
      return sample * 1.2; // 20% boost
    }
  }

  // If Jev says this needs frontier quality, boost high-tier models
  if (jev.qualityTier.confidence > 0.7) {
    if (jev.qualityTier.value === "frontier" && candidate.qualityScore > 0.8) {
      return sample * 1.15;
    }
    if (jev.qualityTier.value === "economy" && candidate.costPerInputToken < 0.001) {
      return sample * 1.15;
    }
  }

  return sample;
}
```

### Phase 2.5: Jev Prior Store

**Goal**: Persist Jev's classifications to the database so they can be replayed when Jev is unavailable. This enables the system to learn from Jev and use that learning even when Jev is offline.

#### New File: `services/router/src/classifier/jev-prior-store.ts`

```typescript
import { getDb } from "@dmr-x/db";
import type { JevClassification } from "./jev-classifier.js";

export interface JevPriorRecord {
  id: string;
  requestHash: string;
  taskType: string;
  taskTypeConfidence: number;
  capabilities: string;
  qualityTier: string;
  qualityTierConfidence: number;
  createdAt: string;
}

export class JevPriorStore {
  private db = getDb();

  constructor() {
    this.initTable();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jev_priors (
        id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        task_type TEXT NOT NULL,
        task_type_confidence REAL NOT NULL,
        capabilities TEXT NOT NULL,
        quality_tier TEXT NOT NULL,
        quality_tier_confidence REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jev_priors_hash ON jev_priors(request_hash);
      CREATE INDEX IF NOT EXISTS idx_jev_priors_created ON jev_priors(created_at);
    `);
  }

  save(classification: JevClassification, requestHash: string): void {
    const id = `jev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO jev_priors
          (id, request_hash, task_type, task_type_confidence, capabilities, quality_tier, quality_tier_confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requestHash,
        classification.taskType.value,
        classification.taskType.confidence,
        JSON.stringify(classification.capabilities),
        classification.qualityTier.value,
        classification.qualityTier.confidence,
        new Date().toISOString(),
      );
  }

  findSimilar(requestHash: string, limit = 5): JevPriorRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM jev_priors
         WHERE request_hash = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(requestHash, limit) as JevPriorRecord[];
  }

  getRecent(limit = 100): JevPriorRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM jev_priors
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as JevPriorRecord[];
  }

  clearOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const result = this.db
      .prepare(`DELETE FROM jev_priors WHERE created_at < ?`)
      .run(cutoff);
    return result.changes;
  }
}
```

#### Modified File: `services/router/src/bandit/thompson-sampler.ts`

Add a method to replay Jev priors:

```typescript
import { JevPriorStore } from "../classifier/jev-prior-store.js";

// In ThompsonSampler class:
private jevPriorStore: JevPriorStore;

constructor(private readonly config: RouterConfig = {}) {
  // ... existing initialization
  this.jevPriorStore = new JevPriorStore();
}

/**
 * Replay Jev priors for a request hash.
 * Called when Jev is unavailable but we have stored priors for similar requests.
 */
replayJevPriors(requestHash: string): JevClassification | null {
  const priors = this.jevPriorStore.findSimilar(requestHash);
  if (priors.length === 0) return null;

  // Use the most recent prior
  const prior = priors[0];

  return {
    taskType: {
      value: prior.task_type,
      confidence: prior.task_type_confidence,
    },
    capabilities: JSON.parse(prior.capabilities),
    qualityTier: {
      value: prior.quality_tier as "frontier" | "balanced" | "economy",
      confidence: prior.quality_tier_confidence,
    },
    latencyMs: 0, // Replayed, not live
  };
}
```

#### Modified File: `services/router/src/router.service.ts`

Use the prior store when Jev is unavailable:

```typescript
// In the routing method:
async route(request: UnifiedRequest): Promise<UnifiedResponse> {
  // 1. Try live Jev classification
  let jevClassification = await this.jevClassifier.classify(request);

  // 2. If Jev unavailable, try replaying stored priors
  if (!jevClassification) {
    const requestHash = this.hashRequest(request);
    jevClassification = this.thompsonSampler.replayJevPriors(requestHash);
  }

  // 3. If we have a classification (live or replayed), save it for future use
  if (jevClassification && jevClassification.latencyMs > 0) {
    // Only save live classifications, not replayed ones
    const requestHash = this.hashRequest(request);
    this.jevPriorStore.save(jevClassification, requestHash);
  }

  // ... rest of routing logic unchanged
}

private hashRequest(request: UnifiedRequest): string {
  const userText = request.messages
    ?.filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  // Simple hash for lookup
  return Buffer.from(userText).toString("base64").slice(0, 16);
}
```

#### Storage Considerations

- Each prior record is ~200 bytes
- 10,000 unique request patterns = ~2MB
- Add a cleanup job to remove priors older than 30 days
- Index on `request_hash` for fast lookup

### Phase 3: Configuration

**Goal**: Add Jev configuration to `.env` and the config schema.

#### Modified File: `.env.example`

Add:

```bash
# Jev Classifier (TypeSafe AI)
# Enable Jev routing preprocessor
JEV_ENABLED=false
# OpenCode Zen endpoint (default: https://opencode.ai/zen/v1)
JEV_BASE_URL=https://opencode.ai/zen/v1
# API key for Jev (get from OpenCode Zen)
JEV_API_KEY=
# Model ID (free tier: jev-1.13-free, paid: jev-latest)
JEV_MODEL_ID=jev-1.13-free
# Timeout in ms (default: 5000)
JEV_TIMEOUT_MS=5000
```

#### Modified File: `apps/gateway/src/config.ts`

Add Jev config to the startup config validation:

```typescript
export interface GatewayConfig {
  // ... existing fields
  jev: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    timeoutMs: number;
  };
}

export function loadConfig(): GatewayConfig {
  return {
    // ... existing fields
    jev: {
      enabled: process.env.JEV_ENABLED === "true",
      baseUrl: process.env.JEV_BASE_URL ?? "https://opencode.ai/zen/v1",
      apiKey: process.env.JEV_API_KEY ?? "",
      modelId: process.env.JEV_MODEL_ID ?? "jev-1.13-free",
      timeoutMs: parseInt(process.env.JEV_TIMEOUT_MS ?? "5000", 10),
    },
  };
}
```

### Phase 4: Telemetry

**Goal**: Track Jev's classification accuracy and latency.

#### New File: `services/router/src/classifier/jev-telemetry.ts`

```typescript
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("dmr-x-gateway", "0.5.0");

export async function trackJevClassification<T>(
  fn: () => Promise<T>,
  labels: Record<string, string>,
): Promise<T> {
  return tracer.startActiveSpan(
    "jev.classify",
    {
      attributes: {
        "jev.task_type": labels.taskType ?? "unknown",
        "jev.confidence": labels.confidence ?? 0,
        ...labels,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
```

### Phase 5: Testing

**Goal**: Verify Jev integration works end-to-end.

#### New File: `services/router/src/classifier/jev-classifier.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JevClassifier } from "./jev-classifier.js";

describe("JevClassifier", () => {
  let classifier: JevClassifier;

  beforeEach(() => {
    classifier = new JevClassifier({
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "test-key",
      modelId: "jev-1.13-free",
      timeoutMs: 5000,
      enabled: true,
    });
  });

  it("should classify a code generation request", async () => {
    const request = {
      messages: [
        { role: "user", content: "Write a function to sort an array in TypeScript" },
      ],
    };

    const result = await classifier.classify(request as any);

    expect(result).not.toBeNull();
    expect(result?.taskType.value).toBe("code_gen");
    expect(result?.taskType.confidence).toBeGreaterThan(0.5);
  });

  it("should classify a Q&A request", async () => {
    const request = {
      messages: [{ role: "user", content: "What is the capital of France?" }],
    };

    const result = await classifier.classify(request as any);

    expect(result).not.toBeNull();
    expect(result?.taskType.value).toBe("q_a");
  });

  it("should return null when Jev is disabled", async () => {
    const disabledClassifier = new JevClassifier({
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "test-key",
      modelId: "jev-1.13-free",
      timeoutMs: 5000,
      enabled: false,
    });

    const request = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = await disabledClassifier.classify(request as any);
    expect(result).toBeNull();
  });

  it("should handle API errors gracefully", async () => {
    // Mock fetch to throw
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const request = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = await classifier.classify(request as any);
    expect(result).toBeNull();
  });
});
```

#### New File: `services/router/src/bandit/thompson-sampler.jev.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { ThompsonSampler } from "./thompson-sampler.js";
import type { JevClassification } from "../classifier/jev-classifier.js";

describe("ThompsonSampler with Jev priors", () => {
  let sampler: ThompsonSampler;

  beforeEach(() => {
    sampler = new ThompsonSampler();
  });

  it("should boost code-specialist models for code_gen tasks", () => {
    const candidates = [
      {
        providerId: "openai",
        modelId: "gpt-4",
        qualityScore: 0.9,
        costPerInputToken: 0.01,
        avgLatencyMs: 1000,
        tags: ["code", "reasoning"],
      },
      {
        providerId: "google",
        modelId: "gemini-flash",
        qualityScore: 0.7,
        costPerInputToken: 0.001,
        avgLatencyMs: 500,
        tags: ["fast"],
      },
    ] as any;

    const jevClassification: JevClassification = {
      taskType: { value: "code_gen", confidence: 0.9 },
      capabilities: [{ value: "code", confidence: 0.85 }],
      qualityTier: { value: "frontier", confidence: 0.8 },
      latencyMs: 200,
    };

    // Run multiple times to account for Thompson sampling randomness
    const results: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const selected = sampler.select(candidates, "balanced", jevClassification);
      results[selected.modelId] = (results[selected.modelId] ?? 0) + 1;
    }

    // GPT-4 (code specialist) should be selected more often
    expect(results["gpt-4"]).toBeGreaterThan(results["gemini-flash"]);
  });

  it("should work without Jev classification (backward compatible)", () => {
    const candidates = [
      {
        providerId: "openai",
        modelId: "gpt-4",
        qualityScore: 0.9,
        costPerInputToken: 0.01,
        avgLatencyMs: 1000,
        tags: [],
      },
    ] as any;

    const selected = sampler.select(candidates, "balanced", null);
    expect(selected.modelId).toBe("gpt-4");
  });
});
```

### Phase 6: Verification

**Goal**: Verify the integration works in production.

#### Manual Verification Steps

1. **Enable Jev in `.env`**:
   ```bash
   JEV_ENABLED=true
   JEV_API_KEY=<your-opencode-zen-key>
   JEV_MODEL_ID=jev-1.13-free
   ```

2. **Restart the gateway**:
   ```bash
   cd apps/gateway && bun --env-file=../../.env run start
   ```

3. **Send test requests**:
   ```bash
   # Code generation
   curl -X POST http://localhost:47113/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"Write a function to sort an array"}]}'

   # Q&A
   curl -X POST http://localhost:47113/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"What is the capital of France?"}]}'
   ```

4. **Check logs for Jev classification**:
   ```bash
   tail -f /tmp/dmrx_runner.log | grep -i jev
   ```

5. **Check telemetry**:
   ```bash
   curl http://localhost:47113/v1/admin/telemetry | jq '.jev'
   ```

#### Success Criteria

| Metric | Target |
|--------|--------|
| Jev classification latency | < 500ms (p95) |
| Jev classification accuracy | > 85% (manual review of 100 samples) |
| Router fallback on Jev failure | 100% (graceful degradation) |
| Thompson Sampling convergence | < 10 pulls (vs. ~50 without Jev) |
| End-to-end latency overhead | < 300ms (Jev + routing) |

## Rollout Plan

### Stage 1: Shadow Mode (Week 1)

- Deploy Jev classifier alongside existing rule-based classification
- Log Jev's classifications but don't use them for routing
- Compare Jev's accuracy vs. rule-based accuracy
- Measure latency overhead

### Stage 2: Assisted Mode (Week 2)

- Use Jev's classification for telemetry and monitoring only
- Show Jev's confidence scores in the admin UI
- Still use rule-based classification for actual routing

### Stage 3: Active Mode (Week 3)

- Enable Jev for turn-type detection and quality-target inference
- Keep Thompson Sampling unchanged (no informed priors yet)
- Monitor routing accuracy and latency

### Stage 4: Full Integration (Week 4)

- Enable Jev's informed priors in Thompson Sampling
- A/B test routing decisions with and without Jev
- Measure convergence speed and final model quality

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Jev API is down | Graceful fallback to rule-based classification (already implemented) |
| Jev classification is wrong | Confidence threshold (0.7) prevents low-confidence overrides |
| Jev adds too much latency | Timeout (5s) + async classification in parallel with other routing steps |
| Jev costs too much | Free tier (`jev-1.13-free`) is $0.00; paid tier is $0.04/M input tokens |
| Jev's schema changes | Version the schema in the adapter; pin to `jev-1.13-free` |

## Files to Create/Modify

### New Files

- `services/router/src/classifier/jev-classifier.ts`
- `services/router/src/classifier/jev-config.ts`
- `services/router/src/classifier/jev-prior-store.ts`
- `services/router/src/classifier/jev-telemetry.ts`
- `services/router/src/classifier/jev-classifier.test.ts`
- `services/router/src/bandit/thompson-sampler.jev.test.ts`

### Modified Files

- `services/router/src/router.service.ts`
- `services/router/src/bandit/thompson-sampler.ts`
- `apps/gateway/src/config.ts`
- `.env.example`
- `docs/plans/JEV_ROUTING_INTEGRATION_PLAN.md` (this file)

## Dependencies

- OpenCode Zen account (for Jev API key)
- `jev-1.13-free` model (free tier)
- No new npm packages required (uses native `fetch`)

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Jev Adapter | 2 days | `jev-classifier.ts` + tests |
| Phase 2: Router Integration | 2 days | Modified `router.service.ts` + `thompson-sampler.ts` |
| Phase 2.5: Jev Prior Store | 1 day | `jev-prior-store.ts` + replay logic |
| Phase 3: Configuration | 1 day | `.env.example` + `config.ts` |
| Phase 4: Telemetry | 1 day | `jev-telemetry.ts` |
| Phase 5: Testing | 2 days | Test suite + verification |
| Phase 6: Verification | 2 days | Production verification |
| **Total** | **11 days** | Full integration |

## References

- [Jev model documentation](https://models.dev/models/typesafe/jev-latest/)
- [OpenCode Zen pricing](https://opencode.ai/docs/zen/)
- [DMR-X router architecture](../ARCHITECTURE.md)
- [DMR-X roadmap](../DMRX-ROADMAP-2026-09.md)
