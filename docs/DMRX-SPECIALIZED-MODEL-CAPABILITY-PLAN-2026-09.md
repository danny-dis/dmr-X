# DMR-X Specialized Model Capability Integration Plan — September 2026

**Status:** Implementation plan / architecture extension
**Scope:** Non-LLM specialist models, multimodal inference, retrieval, perception, forecasting, evaluation, and local inference workers
**Applies to:** DMR-X itself; consumers include ATHENA, ARGUS, NOESIS, Ghost Factory, and DANNY

## 1. Executive decision

DMR-X should evolve from an LLM/provider router into a **heterogeneous AI execution gateway** while preserving its existing architectural boundary:

> DMR-X routes and executes capabilities; consuming systems own application governance, domain policy, memory, identity, and orchestration.

The existing codebase already has important primitives for this direction: unified routing, provider/model registries, adapters, dedicated embeddings/rerank/OCR routes, multimodal infrastructure, benchmarking, telemetry, policy, caching, and a local-first execution model. The next step is to make these specialist capabilities first-class in the same routing substrate rather than implementing them as provider-specific special cases.

The target is:

```text
Application / Agent / Coding Agent
                |
                v
             DMR-X
      +---------+----------+
      | Gateway + Router   |
      | Capability Registry|
      | Policy / Economics |
      | Evaluation         |
      +---------+----------+
                |
        +-------+--------+
        |                |
   Remote APIs       Local workers
        |                |
   specialist APIs   vLLM / Triton /
                     Python/Rust workers /
                     native runtimes
```

DMR-X must expose stable **capability contracts**, not force callers to know whether a capability is implemented by a Python process, Triton model, vLLM server, ONNX runtime, native Rust worker, external API, or another DMR-X instance.

## 2. Why the current architecture is ready

The current implementation already defines DMR-X as a universal AI gateway with capability-aware routing, model/provider profiles, modality handling, adaptive routing, policy, telemetry, benchmarking, and local-first execution. The canonical architecture explicitly includes embeddings, reranking, vision, audio, and specialist workloads as supported infrastructure.

The gateway already contains dedicated `/embeddings`, `/rerank`, and `/ocr` routes. Embeddings are routed through the normal `Router` and unified request path. OCR is also routed through the router using a dedicated `ocr` modality. The current rerank route, however, contains provider-specific Cohere logic and a lexical fallback rather than using the full model/provider routing plane. This is the main architectural inconsistency to remove.

The current adapter initialization already contains specialist/local endpoints including PaddleOCR, vLLM, Tesseract, Demucs, and generic OpenAI-compatible providers. Therefore the required work is primarily **normalization, capability modeling, adapter generalization, execution-worker contracts, and catalog/benchmark integration**, not a new parallel inference architecture.

## 3. Core architectural principle

### Do not create one special integration per model

Bad:

```text
PaddleOCR route
GLM-OCR route
Dots route
SAM route
Chronos route
TabPFN route
...
```

Good:

```text
Capability request
       |
       v
Requirement Vector
       |
       v
Capability Registry
       |
       v
Candidate workers/providers
       |
       v
DMR-X Router
       |
       v
Adapter / Worker
       |
       v
Normalized result
```

A model may implement several capabilities and a capability may have many interchangeable implementations.

## 4. Capability ontology

Add a normalized specialist capability namespace. Initial families:

### Document intelligence

- `document.ocr`
- `document.layout`
- `document.table_extract`
- `document.formula_extract`
- `document.chart_extract`
- `document.parse`
- `document.visual_embed`
- `document.visual_retrieve`
- `document.screen_parse`

### Vision

- `vision.classify`
- `vision.caption`
- `vision.vqa`
- `vision.detect`
- `vision.segment`
- `vision.track`
- `vision.depth`
- `vision.ground`
- `vision.count`

### Audio

- `audio.separate`
- `audio.source_isolation`

### Retrieval

- `embedding.text`
- `embedding.image`
- `embedding.multimodal`
- `retrieval.rerank`
- `retrieval.late_interaction`
- `retrieval.hallucination_eval`

### Structured prediction

- `tabular.classify`
- `tabular.regress`
- `tabular.predict`
- `timeseries.forecast`
- `timeseries.probabilistic_forecast`

### Evaluation

- `evaluation.groundedness`
- `evaluation.context_answer_consistency`
- `evaluation.structured_output`
- `evaluation.task_quality`

### Pipeline capabilities

- `document.understand`
- `document.search`
- `scene.analyze`
- `artifact.understand`

Pipeline capabilities must be represented as declarative compositions of primitive capabilities. They must not create a second router.

## 5. Unified specialist request contract

Extend `UnifiedRequest` so specialist workloads can carry typed inputs without abusing the chat schema.

Recommended conceptual shape:

```ts
interface SpecialistRequest {
  requestId: string;
  capability: SpecialistCapability;
  model?: string;
  inputs: SpecialistInput[];
  parameters?: Record<string, unknown>;
  constraints?: ExecutionConstraints;
  metadata?: RequestMetadata;
}
```

Inputs should support references rather than requiring every payload to be copied through the gateway:

- inline text
- URI
- data URL
- content-addressed artifact
- local file reference for trusted local workers
- stream reference

Constraints should reuse the existing routing requirements:

- quality target
- latency/TTFT target
- cost budget
- privacy class
- locality
- provider trust
- hardware requirements
- maximum memory/VRAM
- concurrency
- streaming
- deterministic execution

## 6. Normalized specialist response

Every specialist adapter should return a normalized response with:

```ts
interface SpecialistResponse {
  requestId: string;
  capability: string;
  modelId: string;
  providerId: string;
  result: unknown;
  artifacts?: ArtifactReference[];
  usage?: Usage;
  confidence?: number;
  latencyMs: number;
  warnings?: string[];
  traceId?: string;
}
```

Model-specific details remain inside `result` or typed capability-specific schemas.

## 7. Execution architecture

DMR-X should support four specialist execution modes.

### A. Remote specialist API

For hosted inference providers.

```text
DMR-X -> HTTPS -> specialist API
```

### B. OpenAI-compatible specialist server

Use for vLLM and compatible local/remote servers.

```text
DMR-X -> OpenAI-compatible adapter -> vLLM
```

This is immediately useful for models such as dots.ocr-1.5 where vLLM serving is documented.

### C. Native inference worker

For models whose runtime is not naturally represented by chat/completions.

```text
DMR-X -> worker protocol -> Python/Rust/native worker
```

Workers should be independently deployable and expose health, model metadata, capabilities, concurrency, resource requirements, and inference.

### D. Triton worker

Use Triton for high-throughput production serving of models/backends that benefit from batching, scheduling, metrics, model lifecycle management, and model ensembles. Triton supports HTTP/REST and gRPC inference, multiple backends, model repositories, dynamic batching, and model pipelines. Its ensemble mechanism is useful for encapsulating preprocessing -> inference -> postprocessing pipelines.

DMR-X should treat Triton as an execution backend, not as the routing authority.

## 8. Specialist worker registration

Introduce a worker/provider profile with fields such as:

```yaml
id: triton-local-01
kind: inference_worker
endpoint: http://...
protocol: triton
capabilities:
  - vision.detect
  - vision.segment
models:
  - id: sam2
    version: ...
    modality: video
resources:
  gpu: true
  vram_gb: 24
locality: local
privacy: private
concurrency: 4
health: healthy
```

The same model can therefore be registered at multiple locations with different execution characteristics.

## 9. Model registry changes

Extend the existing model registry so a model record can describe:

- model ID and version
- family
- owner/source
- license metadata
- modality
- capabilities
- input schema
- output schema
- supported runtimes
- supported protocols
- supported quantizations
- context/input limits
- GPU/CPU/NPU requirements
- minimum/typical VRAM
- batching support
- streaming support
- locality
- privacy class
- pricing
- free-tier status
- benchmark evidence
- known limitations
- license restrictions
- lifecycle status
- deployment references

A model must not become production-eligible merely because it appears in the catalog.

Lifecycle:

`discovered -> registered -> validated -> benchmarked -> eligible -> production -> degraded -> quarantined -> retired`

## 10. Model support matrix

The following models/frameworks from the September 2026 research set must be represented in the DMR-X catalog and capability test matrix.

### OCR / document vision

| Model | Primary capabilities | Initial execution strategy |
|---|---|---|
| Dots.OCR 1.5 | document OCR, layout, tables, formulas, visual QA, grounding | vLLM/OpenAI-compatible worker; native Transformers fallback |
| GOT-OCR2.0 | OCR, tables, formulas, charts | Transformers/Python worker; generic specialist worker |
| GLM-OCR | document OCR/layout understanding | Transformers/vLLM or model-native worker depending runtime support |
| Florence-2 | OCR, detection, captioning, VQA, dense region tasks | Transformers/Python worker; ONNX/optimized backend where validated |
| PaddleOCR-VL | OCR, document parsing, layout, multilingual extraction | Existing PaddleOCR adapter/worker; normalize into specialist contract |
| PaddleOCR-VL-1.5 | same, with stronger distorted/irregular document parsing | PaddleOCR worker; benchmark separately from 1.0 |
| Moondream 0.5B | edge VQA, captioning, image inspection | Transformers/llama.cpp-compatible worker where supported |
| ColPali | visual document embeddings and late-interaction retrieval | dedicated embedding/late-interaction worker |
| EVIE | visual document retrieval | dedicated visual-retrieval worker; validate upstream implementation before production |

### Vision / spatial

| Model | Primary capabilities | Initial execution strategy |
|---|---|---|
| SAM | image segmentation | native/Triton worker |
| SAM 2 | image/video segmentation and tracking | native/Triton worker |
| SAM 3 | unified promptable image/video segmentation | native/Triton worker after runtime validation |
| EfficientSAM | lightweight segmentation | native/ONNX worker |
| MobileSAM | edge segmentation | ONNX/TensorRT/native worker |
| SAMURAI | video object tracking | Python/native worker built around SAM 2 |
| OMG-Seg | unified segmentation | native/Python worker; benchmark capability variants |
| Depth Anything | monocular depth | native/ONNX/Triton worker |
| Fine-tuned YOLO models | real-time object detection | ONNX/TensorRT/Triton worker |
| SAM-Audio | source isolation / audio segmentation | native/Python worker; validate runtime/API |

### Tabular / forecasting

| Model | Primary capabilities | Initial execution strategy |
|---|---|---|
| TabPFN | tabular classification/regression | Python specialist worker |
| Google TabFM | tabular classification/regression | Python/provider worker where supported |
| Amazon Chronos | time-series forecasting | Python specialist worker |
| TiRex | long-horizon time-series forecasting | Python specialist worker |

### Retrieval / evaluation

| Model | Primary capabilities | Initial execution strategy |
|---|---|---|
| TinyLettuce / LettuceDetect | groundedness/hallucination detection | local Python worker |
| Qwen3-Reranker-4B | cross-encoder reranking | Transformers/vLLM/local worker |
| Contextual AI Reranker v2 | cross-encoder reranking | provider/local worker |
| Chroma-4B / Context-1 | agentic search/retrieval | specialist search worker; validate exact upstream model identity before catalog eligibility |

## 11. Important model-catalog validation rule

The research list contains a mixture of mature projects, derivatives, provider services, community releases, and claims that require verification. DMR-X must not encode research prose as fact.

Every catalog entry must include:

- canonical source URL/repository
- exact model identifier
- version/date
- runtime compatibility evidence
- license
- benchmark source
- deployment status
- confidence in metadata

For example, dots.ocr-1.5 has a documented vLLM serving path and an unofficial/community Hugging Face mirror exists; DMR-X should prefer the canonical upstream artifact and record the provenance/license rather than treating mirrors as canonical.

## 12. Provider adapter strategy

### Replace special-case reranking

The current rerank route directly selects Cohere and falls back to a local lexical scorer. This should be migrated to the same router used by embeddings/OCR/chat.

Target:

```text
POST /v1/rerank
       |
       v
Unified specialist request
       |
       v
Router
       |
  capability filter
       |
  policy/privacy
       |
  health/cost/latency
       |
  benchmark score
       |
  selection
       |
Qwen3-Reranker / Cohere / Jina / local worker / ...
```

The lexical scorer can remain as a last-resort deterministic fallback, but it must be explicitly classified as a fallback implementation rather than a provider.

### Generic specialist adapter

Create a reusable adapter interface for non-chat workloads:

```ts
interface SpecialistAdapter {
  id: string;
  capabilities(): CapabilityProfile[];
  initialize(config: AdapterConfig): Promise<void>;
  health(): Promise<HealthStatus>;
  infer(request: SpecialistRequest): Promise<SpecialistResponse>;
  stream?(request: SpecialistRequest): AsyncIterable<SpecialistEvent>;
  close?(): Promise<void>;
}
```

Existing provider adapters can implement this directly or expose an adapter bridge.

## 13. API surface

Preserve existing APIs where possible and make them route through the common capability plane.

Initial public endpoints:

```text
POST /v1/embeddings
POST /v1/rerank
POST /v1/ocr
POST /v1/vision/detect
POST /v1/vision/segment
POST /v1/vision/track
POST /v1/vision/depth
POST /v1/audio/separate
POST /v1/forecast
POST /v1/tabular/predict
POST /v1/evaluate/groundedness
POST /v1/documents/parse
POST /v1/documents/embed
POST /v1/documents/search
POST /v1/capabilities/execute
```

`/v1/capabilities/execute` is the generic escape hatch and should accept a typed capability plus schema-validated input. It must not become an untyped arbitrary-code execution endpoint.

## 14. Pipeline capabilities

Add a declarative pipeline representation.

Example:

```yaml
id: document.search
steps:
  - capability: document.parse
  - capability: embedding.multimodal
  - capability: retrieval.late_interaction
  - capability: retrieval.rerank
```

The pipeline executor executes declared capabilities. The DMR-X router chooses the implementation of each step.

For high-throughput local serving, a pipeline can optionally be compiled into a Triton ensemble or equivalent worker-native pipeline. DMR-X remains responsible for selecting the pipeline/worker and enforcing policy.

## 15. Artifact handling

Specialist workloads frequently exchange large images, videos, PDFs, audio and model outputs. Avoid copying large base64 payloads through every internal service.

Add content-addressed artifacts with:

- SHA-256 or equivalent content hash
- MIME type
- size
- tenant ownership
- sensitivity classification
- retention/expiration
- encryption metadata
- access policy
- provenance

Requests should be able to reference artifacts by ID.

## 16. Resource-aware routing

Specialist routing must include resource requirements that are more explicit than LLM token/context routing.

Track:

- CPU cores
- RAM
- GPU vendor
- GPU memory
- accelerator type
- batch capacity
- model residency
- cold-start time
- disk footprint
- power/edge constraints

Routing example:

```text
vision.segment
privacy=local
latency<100ms
image=1080p

-> MobileSAM on edge GPU

rather than

-> 3B VLM on shared GPU
```

## 17. Dynamic model loading

Do not require every specialist model to remain resident.

Workers should advertise:

- loaded models
- available models
- load/unload capability
- estimated cold-start
- VRAM required

The router can choose between:

- already-resident model
- cold-load candidate
- another worker

For high-throughput clusters, Triton model repositories and explicit model management provide a useful reference architecture.

## 18. Benchmarking strategy

Extend the existing benchmark service to specialist capability suites.

### OCR

- character/text accuracy
- layout fidelity
- table accuracy
- formula accuracy
- multilingual accuracy
- distorted-document robustness
- latency
- memory

### Vision

- mAP for detection
- IoU/mIoU for segmentation
- tracking metrics
- depth error
- FPS
- latency

### Retrieval

- Recall@K
- MRR
- nDCG
- reranker lift over baseline
- latency

### Forecasting

- MAE
- RMSE
- MASE
- probabilistic calibration/interval coverage
- horizon-specific accuracy

### Evaluation models

- precision/recall against curated groundedness sets
- false-positive rate
- false-negative rate
- calibration

Benchmarks must be capability-specific. Never assign a single global "intelligence" score to all specialist models.

## 19. Routing intelligence

Extend the existing Request Requirement Vector with specialist-specific fields:

```text
modality
capability
input_size
output_schema
accuracy_target
latency_target
batchability
resource_constraints
privacy
locality
license_constraints
model_residency
cold_start_tolerance
```

The candidate profile must expose corresponding evidence.

The router should prefer a resident, validated model when the quality difference is immaterial, but may select a cold model when quality requirements justify the load cost.

## 20. Privacy architecture

Specialist workloads often contain more sensitive raw data than text requests.

Examples:

- scanned identity documents
- CCTV frames
- personal photographs
- voice recordings
- source repositories
- private business PDFs

The privacy engine must therefore apply before payload egress.

Rules:

```text
sensitive document -> local/private workers only
camera stream -> explicit locality policy
private audio -> approved workers only
regulated data -> fail closed if no eligible worker
```

Specialist adapters must not bypass the existing privacy policy.

## 21. Caching

Cache by capability and input identity, not only by route name.

Safe cache dimensions include:

- tenant
- capability
- model/version
- input hash
- relevant parameters
- policy class
- privacy class
- freshness

Do not cache sensitive outputs across tenants.

## 22. Consumer integration

### ATHENA

ATHENA should request capabilities such as:

- `timeseries.forecast`
- `tabular.predict`
- `evaluation.groundedness`
- `document.understand`

DMR-X returns evidence-bearing results. ATHENA remains responsible for governance and orchestration.

### ARGUS

ARGUS should request:

- `vision.detect`
- `vision.segment`
- `vision.track`
- `vision.depth`
- `document.ocr`
- `audio.separate`

ARGUS remains the observation/intelligence domain; DMR-X provides the computational capability.

### NOESIS

NOESIS should request:

- `embedding.*`
- `document.visual_embed`
- `retrieval.late_interaction`
- `retrieval.rerank`
- `document.parse`
- `evaluation.groundedness`

NOESIS remains the memory system and owns its memory semantics/storage policy.

### Ghost Factory

Ghost Factory should request:

- `document.parse`
- `document.ocr`
- `vision.*`
- `artifact.understand`
- `retrieval.rerank`
- `tabular.predict`
- `evaluation.*`

Ghost Factory remains responsible for software transformation/verification workflows.

### DANNY

DANNY should request:

- visual retrieval
- OCR/document understanding
- multimodal embeddings
- reranking
- forecasting
- groundedness evaluation

DANNY remains the digital-self model; DMR-X provides the computational capabilities without owning DANNY's identity or memory.

## 23. API compatibility

Where a standard API exists, support it directly or through a compatibility adapter:

- OpenAI-compatible embeddings
- common reranking APIs
- KServe/Triton inference APIs
- vLLM OpenAI-compatible serving
- native provider APIs where necessary

The DMR-X internal contract remains canonical. Compatibility formats are adapters, not the internal architecture.

## 24. Security requirements

Specialist workers are untrusted execution boundaries unless explicitly classified otherwise.

Require:

- authenticated worker registration
- signed/verified model metadata where possible
- SSRF-safe endpoints
- network egress policy
- artifact authorization
- tenant isolation
- resource limits
- worker health checks
- request size limits
- timeout/cancellation
- audit events
- license/provenance metadata

Do not allow a model manifest to grant arbitrary filesystem, network, or process permissions.

## 25. Implementation phases

### Phase 0 — Contract and inventory

1. Audit all existing specialist routes, adapters and model records.
2. Define specialist request/response contracts.
3. Extend capability ontology.
4. Extend model/provider profiles.
5. Add model provenance/license fields.
6. Define specialist benchmark schema.

**Exit:** all existing specialist routes can be mapped to normalized capabilities.

### Phase 1 — Unify existing capabilities

1. Move rerank onto the router.
2. Normalize OCR through the common adapter interface.
3. Normalize embeddings.
4. Add specialist execution traces.
5. Add specialist-specific routing constraints.
6. Preserve existing public APIs.

**Exit:** embeddings, rerank, OCR and existing multimodal routes use the same policy/routing/telemetry plane.

### Phase 2 — Worker protocol

1. Implement `SpecialistAdapter`.
2. Implement remote HTTP worker adapter.
3. Implement OpenAI-compatible worker adapter.
4. Implement Triton adapter.
5. Implement local Python worker adapter.
6. Add worker health/resource discovery.
7. Add artifact references.

**Exit:** DMR-X can route the same capability between remote API, vLLM-compatible server, local worker and Triton worker.

### Phase 3 — Catalog and first specialist fleet

Prioritize:

1. PaddleOCR-VL / 1.5
2. Dots.OCR 1.5
3. Qwen3-Reranker
4. ColPali
5. Florence-2
6. SAM 2
7. YOLO
8. Depth Anything
9. Chronos
10. TabPFN
11. TinyLettuce/LettuceDetect

Then add the remaining research models after runtime validation.

**Exit:** each priority model has a catalog record, capability mapping, deployment recipe, health check, benchmark suite, and routing test.

### Phase 4 — Specialist pipelines

1. `document.search`
2. `document.understand`
3. `scene.analyze`
4. `artifact.understand`
5. declarative capability pipelines
6. optional Triton pipeline compilation

**Exit:** multi-model specialist workflows are routable without hard-coded application integrations.

### Phase 5 — Self-improving specialist routing

1. Specialist outcome attribution.
2. Capability-specific tournaments.
3. Contextual performance profiles.
4. Cold-start cost prediction.
5. Resource-aware routing.
6. Automatic promotion/demotion.

**Exit:** DMR-X learns which specialist implementation is best for each capability/context/resource class without contaminating unrelated routing decisions.

## 26. Test plan

### Unit tests

- capability matching
- input/output schema validation
- worker registration
- worker health
- resource filtering
- privacy filtering
- license filtering
- specialist fallback
- artifact authorization
- cache isolation

### Integration tests

- DMR-X -> vLLM specialist
- DMR-X -> Triton
- DMR-X -> Python worker
- DMR-X -> remote specialist API
- model load/unload
- streaming/cancellation
- large artifact transfer

### Routing tests

- local-only document routes never select remote workers
- low-latency vision routes prefer edge models
- high-quality OCR can select larger model when budget permits
- reranking never bypasses tenant policy
- failed worker is removed from candidate set
- cold-start penalty affects selection
- exhausted GPU memory causes safe fallback

### End-to-end ecosystem tests

Create contract fixtures for ATHENA, ARGUS, NOESIS, Ghost Factory and DANNY. These must test that consumers request capabilities rather than concrete model/provider names.

## 27. Observability

Specialist telemetry must record:

- capability
- model/version
- worker/provider
- input size
- output size
- queue time
- cold-start time
- inference time
- total latency
- GPU/CPU utilization where available
- memory/VRAM
- error type
- retry/fallback
- benchmark quality reference
- artifact IDs, not raw sensitive payloads

The routing trace must answer:

> Why did DMR-X select this specialist model instead of the alternatives?

## 28. Documentation changes

Update the canonical docs after implementation begins:

- `DMRX-PRODUCT-AND-ARCHITECTURE.md`
- `DMRX-ROADMAP-2026-09.md`
- `ARCHITECTURE.md`
- `AI_PROVIDER_REFERENCE.md`
- `API_USAGE_GUIDE.md`
- `CONFIGURATION.md`
- `DMRX-DOCS-INDEX.md`

Do not create parallel competing architecture or roadmap documents.

This document is the detailed implementation plan for the specialist capability expansion.

## 29. What not to do

Do not:

- make DMR-X dependent on ATHENA, ARGUS, NOESIS, Ghost Factory or DANNY;
- turn DMR-X into NOESIS memory;
- put ATHENA governance into DMR-X;
- create separate routers for OCR, vision, forecasting, retrieval, etc.;
- hard-code one model as permanently preferred;
- assume every specialist model is an LLM;
- force every model behind chat/completions semantics;
- copy large media through JSON when artifacts can be referenced;
- allow model metadata to bypass security policy;
- treat unverified community mirrors as canonical model sources.

## 30. Target end state

```text
                         DMR-X
                           |
             +-------------+-------------+
             |             |             |
          Gateway       Router        Runtime
             |             |             |
             +-------------+-------------+
                           |
                  Capability Registry
                           |
          +----------------+----------------+
          |                |                |
      LLM models     Specialist models   Tools/services
          |                |                |
          |      +---------+---------+      |
          |      |         |         |      |
          |     OCR      Vision   Forecast  |
          |     RAG      Audio    Tabular   |
          |                |                |
          +----------------+----------------+
                           |
              +------------+------------+
              |            |            |
             vLLM       Triton     Native workers
              |            |            |
          CPU/GPU/NPU/edge/remote/federated
```

The end result is not a larger LLM gateway. It is a **model-agnostic heterogeneous intelligence gateway** in which LLMs, vision models, OCR engines, embedding models, rerankers, forecasting models, tabular models, audio models, evaluators, and classical specialist implementations are all routable through the same policy, economics, reliability, telemetry, benchmarking, and lifecycle machinery.

## 31. Research basis

The design is informed by current inference-serving patterns and model documentation:

- NVIDIA Triton provides HTTP/REST and gRPC inference, model repositories, multiple backends, scheduling, metrics, and model ensembles, making it a strong execution substrate for production specialist fleets.
- Superlinked SIE demonstrates the practical value of exposing heterogeneous retrieval/document models through a unified inference service rather than maintaining a separate server for every model family.
- dots.ocr-1.5 documents local Transformers use and vLLM serving, validating the OpenAI-compatible specialist-worker path for multimodal OCR.
- PaddleOCR-VL-1.5 is a current compact document-VLM candidate and should be benchmarked as a first-class OCR implementation rather than treated as a generic chat model.
- ColPali-style late interaction preserves page-level visual structure and is particularly appropriate for visually rich document retrieval.

External research should be revalidated at implementation time because model versions, runtimes, licenses, benchmarks, and serving APIs change.
