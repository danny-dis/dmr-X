# DMR-X Adaptive Inference — Inferstep ATLAS Mining

Status: architecture target.
Source: inferstep/ATLAS.

## Decision
DMR-X should absorb Inferstep ATLAS's surrounding-system intelligence: PlanSearch, diverse candidate sampling, adaptive reasoning budgets, repair, refinement loops, candidate scoring, per-step intervention, pattern reuse, and sandbox verification.

DMR-X must generalize this beyond coding and beyond one local model.

Core concept:

**Inference Strategy = a policy-controlled execution plan for obtaining a high-quality result, not a model selection.**

## 1. Extended DMR-X pipeline
Current:
workload -> capability/provider/model/runtime

Target:
workload -> difficulty -> strategy -> candidates -> execution -> evaluation -> repair/refinement -> result

Model routing happens inside the selected strategy.

## 2. Inference Strategy contract
An InferenceRequest carries capability, modality, task, context, constraints, consequence, latency budget, compute budget, money budget, privacy, verification requirements and output contract.

Strategy execution is:
DifficultyEstimator -> StrategySelector -> InferencePlan -> candidate generation -> evaluator/verifier -> accept OR repair/refine -> verified result

## 3. Strategy primitives
### PlanSearch
Generate several structural plans for difficult architecture, research, coding, automation and multimodal tasks.

### DivSampling
Generate meaningfully different candidates across model, provider, temperature, prompt strategy, decomposition, tool sequence and modality specialist. Candidate lineage must be recorded.

### Budget Forcing
Initial policy:
- T0: direct single-pass.
- T1: single candidate plus deterministic check.
- T2: 2-3 candidates plus targeted evaluation.
- T3: plan search plus candidates plus repair.
- T4: independent strategies plus strong verification and adversarial evaluation.

These are policy tiers, not fixed model sizes.

### Repair
Every failed candidate creates structured repair context containing candidate, failure, evidence, attempted strategy and resources consumed. A retry should be allowed to change model, prompt, decomposition, tools, candidate family or verifier.

### Refinement
Bounded generate -> verify -> diagnose -> repair -> verify loops with hard iteration, time and cost limits.

## 4. Verification registry
Generalize Inferstep's sandbox into a DMR-X verifier registry:
- compiler
- test runner
- schema validator
- static analyzer
- deterministic calculator
- image validator
- audio evaluator
- benchmark
- policy engine
- model judge
- human approval

Verifier output is structured: status, score, confidence, failures, artifacts and metrics.

Hard policy failures cannot be overridden by model scores.

## 5. Scoring
DMR-X should support deterministic scoring, learned scoring, model judges and optional geometric/embedding scoring inspired by Inferstep's Geometric Lens.

Geometric Lens is a plugin, not a DMR-X dependency.

Composite scoring may combine quality, correctness, evidence, latency, cost and reliability subject to hard constraints.

## 6. Pattern cache
Cache successful strategy evidence using task fingerprint, capability, strategy, model/runtime, verifier, result, score, cost, latency and failure history.

The cache is evidence, not authority. Entries decay or expire as models, providers and workloads change.

## 7. Difficulty estimation
Combine deterministic and learned signals: task size, dependency count, historical failure rate, artifact count, ambiguity, consequence, required modalities, verification cost, previous retries and context size.

Difficulty selects a budget/strategy tier, not a vendor.

## 8. Ghost Research
Ghost Research becomes the controlled experimentation layer for inference strategies.

Example tournament:
- Strategy A: one strong model.
- Strategy B: cheap model plus repair.
- Strategy C: three candidates plus verifier.
- Strategy D: plan search plus diversity plus repair.

Measure success, quality, cost, latency, compute, tokens, retries, verifier strength, failure classes and variance.

Ghost Research publishes strategy evidence. DMR-X decides whether evidence is sufficient to change production routing.

## 9. Ecosystem consumers
### ATHENA
Requests higher adaptive depth when uncertainty, consequence or conflict is high. ATHENA retains authorization, governance and final action authority.

### ZOEY
Uses T0 for ordinary conversation, T1/T2 for planning, T2/T3 for difficult workflows and stronger verification for consequential tasks.

### DANNY
Uses adaptive inference for conflicting self-model evidence, difficult reasoning, anticipation and strategy generation. Persistent self-state changes remain governed by DANNY and grounded by NOESIS.

### Ghost Factory
Uses adaptive strategies for architecture, implementation candidates, repair, tests, migration, debugging and adversarial review. Ghost Factory owns the software-production workflow; DMR-X supplies inference strategy.

### Ghost Research
Uses the fabric to test the fabric. Experimental runs are isolated from production policy until explicitly promoted.

### TABBY
Uses latency-first strategies for interactive coding and escalates after repeated failures, multi-file debugging, architecture requests or expensive verification.

## 10. Modality neutrality
The strategy layer must not assume text/code. Candidate generation may use LLMs, VLMs, OCR, speech, video analysis, image generation, EEG/BCI models, classical ML or deterministic programs.

## 11. Resource controls
Every adaptive run receives maximum candidates, retries, wall time, token budget, compute budget, monetary budget and concurrency limits.

When a budget is exhausted, DMR-X returns the best verified result plus evidence and an explicit incomplete/uncertain status.

## 12. Security boundaries
1. Candidates cannot modify their evaluator.
2. Candidates cannot modify holdouts.
3. Scoring cannot bypass policy.
4. Verification tools are capability-scoped.
5. Sensitive contexts inherit privacy policy.
6. Adaptive routing cannot silently escalate permissions.
7. Strategy transitions are auditable.
8. Pattern-cache entries carry provenance and expiry.
9. Experimental strategies are isolated from production policy until promoted.

## 13. Implementation mapping
Existing DMR-X areas map naturally:

services/router/ -> strategy selection, difficulty estimation, route planning
services/benchmark/ -> candidate evaluation, verifier adapters, strategy tournaments
services/telemetry/ -> candidate lineage, strategy traces, cost/latency/evidence
services/policy/ -> adaptive-run constraints, budgets and capability gates
services/agent-runtime/ -> isolated repair/refinement workers
services/registry/ -> model, verifier and strategy capability metadata

Suggested future packages:
services/inference-strategy/
services/inference-evaluator/
services/inference-verifier/
services/inference-lineage/
services/inference-cache/

## Result
DMR-X evolves from a model router into an adaptive inference fabric. It chooses not only which model should answer, but how much intelligence, diversity, verification and repair should surround that model for the workload.