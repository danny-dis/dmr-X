# LifeOS + Fabric Learnings for DMR-X

## Capability contracts

DMR-X should treat reusable AI procedures as capability contracts, inspired by Fabric Patterns but independent of prompt files. A contract declares inputs, outputs, required modalities, quality, latency, cost, privacy, locality, permissions, risk and evidence requirements.

## Role-based routing

Callers request roles/capabilities rather than named models. Examples: reasoning, coding, OCR, vision, speech, forecasting, retrieval, verification, EEG inference and multimodal analysis. Providers and models are implementation details.

## Adaptive escalation

Routing should adapt as evidence arrives: start with an appropriate low-cost implementation, escalate when uncertainty/risk rises, invoke specialist non-LLM workers when required, and request independent verification when consequence warrants it.

## Composable pipelines

Fabric-style chaining becomes typed capability pipelines: preprocess → transform → reason → verify → format. Each stage produces a receipt and can be routed independently.

## Execution receipts

Every dispatch should expose what actually ran: capability, selected provider/model/worker, inputs/outputs references, policy decisions, latency/cost, errors and verification evidence. This prevents stale or assumed routing facts.

## Health states

Capabilities/providers should have explicit `LIVE`, `BROKEN`, `DECLINED`, `STALE` states. Declined means unavailable by policy or preference, not malfunctioning.

## Privacy-aware composition

DMR-X should support local preprocessing before remote inference, including redaction, OCR, classification and filtering, so sensitive data can be minimized before cloud execution.

## Non-LLM first-class workers

The same contract system must support OCR, CV, depth, tabular analysis, forecasting, retrieval, signal processing and neural/BCI workers as well as LLMs.
