#!/usr/bin/env bun
// Benchmark runner for DMR-X
// Runs a quick performance benchmark against the gateway

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47116';

interface BenchmarkResult {
  name: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

async function benchmarkEndpoint(
  name: string,
  method: string,
  path: string,
  body?: any,
): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const latencyMs = Date.now() - start;
    const data = await res.json().catch(() => null);
    return {
      name,
      latencyMs,
      success: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      name,
      latencyMs: Date.now() - start,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runBenchmarks() {
  console.log('🚀 DMR-X Performance Benchmark\n');
  const results: BenchmarkResult[] = [];

  // Health check
  results.push(await benchmarkEndpoint('Health', 'GET', '/health'));

  // List agents
  results.push(await benchmarkEndpoint('List Agents', 'GET', '/v1/agents?limit=10'));

  // List agents with search
  results.push(await benchmarkEndpoint('Search Agents', 'GET', '/v1/agents?search=test'));

  // Marketplace browse
  results.push(await benchmarkEndpoint('Browse Marketplace', 'GET', '/v1/marketplace'));

  // Marketplace search
  results.push(await benchmarkEndpoint('Search Marketplace', 'GET', '/v1/marketplace?search=workflow'));

  // Get instances
  results.push(await benchmarkEndpoint('List Instances', 'GET', '/v1/agents/instances?status=active&limit=10'));

  // Chat completion (simple) - may fail if no provider has credits
  results.push(
    await benchmarkEndpoint('Chat Completion', 'POST', '/v1/chat/completions', {
      model: 'auto',
      messages: [{ role: 'user', content: 'Say hello in one word' }],
      max_tokens: 10,
      stream: false,
    }),
  );

  // Print results
  console.log('Results:');
  console.log('-'.repeat(60));
  let totalLatency = 0;
  let successCount = 0;
  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.name.padEnd(25)} ${r.latencyMs.toString().padStart(6)}ms ${r.error || ''}`);
    totalLatency += r.latencyMs;
    if (r.success) successCount++;
  }
  console.log('-'.repeat(60));
  console.log(
    `Summary: ${successCount}/${results.length} passed | Avg: ${Math.round(totalLatency / results.length)}ms | Total: ${totalLatency}ms`,
  );

  if (successCount < results.length) {
    process.exit(1);
  }
}

runBenchmarks().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
