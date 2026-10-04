# Four Reference Systems — DMR-X Integration Mining

Status: architecture input; complements docs/DMRX-ADAPTIVE-INFERENCE.md
Date: 2026-10-05

## Boundary
DMR-X is the ecosystem's adaptive inference fabric. It chooses models/runtimes and inference strategies. It is not the workflow orchestrator, memory OS, software factory or governance system.

## 1. Inferstep ATLAS — primary source

Promote existing ideas into first-class contracts: WorkloadProfile, DifficultyEstimate, InferenceStrategy, Candidate, CandidateFamily, Verifier, VerificationResult, RepairPlan, InferenceRun and PatternEvidence.

Core pipeline:
Request -> Intent/Capability Gate -> Difficulty -> Strategy Compilation -> Candidate Plan -> Execution -> Verification -> Repair -> Result

Strategy primitives include PlanSearch, diverse sampling, adaptive budgets, repair and bounded refinement.

Verifier registry should support compiler/test runner, schema validation, static analysis, deterministic calculators, image/audio validators, benchmarks, policy engines, model judges and human approval.

Hard policy failures cannot be overridden by scores.

## 2. ATLAS·OS — strategy compilation

Mine only the state-to-plan idea. Convert WorkloadProfile + Difficulty + Policy + Registry into an inspectable InferencePlan.

InferencePlan can specify candidate count, model/runtime diversity, tool sequence, verifier sequence, repair budget, timeout, token/compute/money budgets and confidence target.

Do not import ATLAS·OS's PRD/story/release workflow.

## 3. Pacifio Atlas — adaptive-run provenance

Every adaptive run should emit an append-only provenance stream covering strategy, models/workers, candidates, verifiers, repairs, cost, latency, outcomes and failure classes.

Support stable correlation IDs so callers can connect mission -> inference run -> candidate -> verifier -> result.

Long T2-T4 runs may emit checkpoint markers. NOESIS may later ingest permitted records, but DMR-X does not become NOESIS.

## 4. iamvikshan Atlas — capability and intent discipline

Before compute is spent, validate modality, capability, context class, consequence, privacy, deadline, hard budgets, verifier requirements and tool-use permissions.

Routing is capability-first: coding.reasoning, vision.reasoning, audio.analysis, ocr, bci.classification, and similar contracts rather than vendor names.

Impossible or under-specified requests should be rejected or escalated before expensive candidate generation.

## Strategy object targets

InferenceStrategy: strategy_id, version, objective, capability_requirements, candidate_policy, diversity_policy, budget_policy, verifier_policy, repair_policy, security_policy, expiry.

Candidate: candidate_id, run_id, family, producer, inputs_hash, output_ref, strategy_variant, lineage, status.

VerificationResult: verifier_id, candidate_id, status, score, confidence, failures, artifacts, duration, resource_usage.

RepairPlan: failure_refs, changed_assumptions, changed_model_or_worker, changed_tools, changed_prompt_strategy, retry_budget.

## Provenance events

RunStarted, PlanCompiled, CandidateProduced, VerifierStarted, VerifierCompleted, RepairStarted, CandidateRejected, ResultAccepted and RunFailed.

Candidate output must never overwrite previous attempts.

## Registry extensions

Registry metadata should describe model capabilities, tool capabilities, verifier capabilities, modality support, privacy/locality, cost/latency, known failure classes and strategy compatibility.

## Security invariants

- candidates cannot modify evaluators or holdouts;
- verification is capability-scoped;
- strategy changes are auditable;
- pattern-cache entries carry provenance and expiry;
- providers cannot raise permissions;
- experimental strategies are isolated until promoted.

## Tests

State-machine tests for candidate lineage, verifier independence, budget exhaustion, repair termination, deterministic gating, malformed requests, provider failure, multimodal runs and telemetry completeness.

## Do not import

ATLAS·OS TUI, Pacifio long-term memory, Inferstep's specific local inference server, or iamvikshan's editor-specific hierarchy.

## Result

DMR-X becomes a reusable adaptive inference substrate: callers specify goals and constraints; DMR-X decides how much inference effort, diversity, repair and verification should surround execution.