# Jev Integration Specification

## Summary
Makes bounded decision models a first-class DMR-X workload category alongside generative, reasoning, multimodal, and non-LLM specialist models.

## Implementation
- Add model kind: decision.
- Define a typed DecisionModel interface supporting choice, score, multi-question outputs, confidence/calibration metadata, batch inference, streaming where supported, and structured errors.
- Add Jev provider/backend adapter behind the existing provider abstraction.
- Extend routing policy to select decision models for low-latency bounded tasks.
- Add decision-specific telemetry: p50/p95 latency, calibration, abstention/low-confidence rate, cost, fallback rate, and decision accuracy.
- Add policy-aware fallback chain: rules -> decision model -> specialist/LLM -> human/agent escalation.
- Add benchmark suites comparing Jev against small LLM classifiers for routing, safety, memory admission, and task classification.
- Ensure local/remote providers can host equivalent decision workloads where possible.
- Expose decision models through API/MCP without pretending they are chat models.

## Acceptance criteria
- DMR-X can register and route Jev as a model.
- Existing generative routing is unchanged.
- Decision workloads are observable and independently benchmarked.
- Consumers can require a typed output schema and confidence threshold.
