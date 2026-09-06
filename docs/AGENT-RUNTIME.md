# DMR-X Agent Runtime

**Status:** Canonical runtime specification  
**Updated:** 2026-09-06

## Purpose

The DMR-X Agent Runtime is reusable execution infrastructure for AI agents. It is optional: DMR-X remains a useful model gateway/router without it.

The Runtime exists so applications, coding agents and agent ecosystems can create and operate isolated agents without implementing process, workspace, session, scheduling, resource, lifecycle and recovery infrastructure themselves.

## Boundary

**Runtime:** creates and runs agents.  
**DMR-X Gateway:** serves model inference and selects providers.  
**Calling application:** owns business authorization.  
**ATHENA/other systems:** may impose additional governance externally.

The Runtime must never silently become a sovereign governance layer.

## Agent classes

- persistent agent
- ephemeral task agent
- subagent
- scheduled agent
- batch worker
- interactive agent

## Lifecycle

```text
registered
  -> provisioned
  -> ready
  -> running
  -> paused
  -> draining
  -> stopped
  -> retired
```

Every transition should be explicit, observable and auditable.

## Ephemeral agents

A caller can request a temporary agent for a narrowly scoped task.

Required controls:

- task ID
- parent/request ID
- tenant ID
- capability allowlist
- tool allowlist
- model/routing policy
- workspace
- browser profile if required
- credentials
- network policy
- CPU/RAM/GPU limits
- maximum concurrency
- timeout
- TTL
- spend budget
- artifact policy
- termination policy

Example:

```text
create_agent
  type=ephemeral
  purpose=web_research
  ttl=10m
  budget=$0.00
  routing=free_first
  tools=[web.fetch]
  network=allowlist
  workspace=isolated
```

After completion, the execution environment is destroyed unless retention is explicitly requested by policy.

## Isolation levels

The Runtime should support progressive isolation:

1. directory/process isolation for lightweight local jobs;
2. container isolation for stronger separation;
3. microVM/VM isolation for untrusted workloads;
4. dedicated worker/node isolation for high-risk workloads.

Isolation selection should be policy-driven.

## Resources

The scheduler should understand:

- CPU
- RAM
- GPU/VRAM
- disk
- network bandwidth
- browser capacity
- provider/API concurrency
- execution time
- monetary budget

Agents should not be admitted when their resource requirements cannot be satisfied safely.

## Model routing

The Runtime **does not implement a second model router**.

It submits inference requests to the DMR-X Gateway with an explicit routing policy, for example:

```json
{
  "objective": "quality_per_dollar",
  "free_tier": "prioritize",
  "max_cost_usd": 0,
  "privacy": "local_or_trusted"
}
```

DMR-X then selects the actual model/provider.

## Durable execution

Runtime executions should survive process and worker failures where the workload permits it.

Required mechanisms:

- checkpoints
- durable session state
- leases
- heartbeats
- retry policy
- cancellation
- resume
- idempotency keys
- artifact persistence
- execution event log

Distributed execution must prevent two workers from owning the same active execution unintentionally.

## Skills

Skills are versioned capabilities, not arbitrary mutable prompt fragments.

Lifecycle:

`discovered -> candidate -> tested -> approved -> production -> deprecated`

Auto-captured skills must enter the candidate state first. Production promotion requires validation against regression tests and compatibility requirements.

Skill manifests should declare:

- name/version
- capabilities
- dependencies
- tools
- required permissions
- supported runtime versions
- input/output contract
- tests
- provenance
- trust/signature metadata where applicable

## Evaluation

Every execution should emit metrics such as:

- success/failure
- quality score where available
- latency
- model/provider used
- token usage
- cost
- tool calls
- retries
- resource usage
- failure category
- artifact count

These metrics feed runtime scheduling and DMR-X routing intelligence without coupling the two systems into one brain.

## Agent portability

An agent package should be exportable and importable with:

- identity
- system instructions
- skill references
- tool requirements
- capability requirements
- runtime requirements
- resource limits
- security policy
- routing policy
- version metadata

Secrets must never be embedded in portable agent packages.

## Security

- least-privilege credentials;
- isolated filesystem/workspace;
- explicit network egress policy;
- browser isolation;
- secret redaction;
- tool allowlists;
- tenant isolation;
- signed/trusted agent packages where appropriate;
- immutable audit events for security-sensitive operations.

## Governance interaction

The Runtime can execute an approved action but cannot create authority.

For example:

```text
ATHENA/application policy
        |
        | authorized task
        v
DMR-X Runtime
        |
        +--> temporary agent
        |
        +--> DMR-X Gateway
        |       |
        |       +--> model/provider
        |
        +--> result/artifacts
        |
        +--> destroy
```

If the caller has explicitly prohibited the action, DMR-X Runtime must not be usable as a bypass.

## Runtime roadmap

### P0

- formal lifecycle manager;
- stronger workspace/process isolation;
- per-agent credentials and egress controls;
- TTL and spend budgets;
- checkpoint/resume;
- idempotent execution;
- execution telemetry.

### P1

- container/microVM isolation;
- distributed worker leases;
- resource-aware scheduler;
- versioned skill promotion pipeline;
- portable agent packages;
- evaluation-driven scheduling.

### P2

- migration/live handoff;
- hardware-aware placement;
- predictive resource scheduling;
- reusable execution pools;
- stronger artifact/content-addressed storage.
