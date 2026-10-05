# DMR-X — Mining Open Research, OR-Agent and HEC Open Research

DMR-X should turn the mined experimentation mechanisms into a disciplined routing benchmark/evolution layer.

## Adopt from OR-Agent

Treat routing policies as candidate strategies:
~~~text
candidate router A
candidate router B
candidate router C
...
same workload suite
→ evaluate quality/cost/latency/reliability/privacy
→ rank
→ expand promising candidates
→ prune weak/stagnant candidates
~~~

Maintain independent populations for quality-first, cost-first, latency-first, local-first, privacy-first and multimodal/specialist routing. This reduces premature convergence.

Allocate validation budget where evidence is useful:
- promising candidates get deeper tests;
- weak candidates get cheap confirmation;
- repeated failures reduce allocation;
- stagnation triggers a new strategy/model family.

Separate per-request routing observations from durable routing lessons.

## Adopt from Open Research

Use structured benchmark evidence and context-targeted retrieval for model/provider performance records. A model should be discoverable through factual capabilities and measured outcomes, not just a name.

## Adopt from HEC

Make benchmark runs durable, resumable and event-driven. Persist workload, candidate strategy, provider/model versions, configuration, results and resource consumption.

## Safety and authority

DMR-X owns routing and inference economics, not application governance. Calling applications remain authoritative for their own policy. Benchmarks/evaluators must be protected from candidates under test.

## Implementation targets

Extend the benchmark subsystem with StrategyCandidate, StrategyPopulation/Island, ExperimentRun, EvaluationVector, BenchmarkVersion, CandidateLineage, routing lesson storage, bounded strategy search, reproducible replay and promotion/canary metadata.

Use multi-objective evaluation rather than one global router score.