# RFC: DMR-X Dataset Factory for Model Training

- Status: Proposed
- Type: Architecture / implementation plan
- Scope: DMR-X core platform; provider-neutral and model-neutral
- Initial consumer: Ghost Factory training and evaluation workflows
- First candidate: a privately fine-tuned Qwen-family model; no model is hard-coded into the design

## Summary

Add a Dataset Factory to DMR-X that converts permitted, useful operational evidence into versioned datasets for supervised fine-tuning (SFT), preference optimization, agent-trajectory learning, routing-policy evaluation, and future model training.

DMR-X owns capture integrations, provenance, consent/policy enforcement, normalization, quality gates, dataset versioning, and export APIs. Ghost Factory owns training orchestration, experiment design, benchmark execution, candidate comparison, and model promotion. DMR-X must not become a trainer or automatically deploy a model simply because a dataset was produced.

## Goals

1. Collect task and outcome evidence from DMR-X requests and explicitly integrated agents/tools.
2. Build reusable, composable datasets from approved records, rather than one undifferentiated dump.
3. Preserve provenance and enforce source-specific data-use permissions.
4. Support privacy-aware collection, redaction, deletion propagation, and auditable access.
5. Export interoperable formats for common training stacks without coupling to one framework.
6. Keep evaluation sets isolated from training data and track dataset/model/experiment lineage.
7. Support future models and modalities without redesigning the data model.
8. Make collection opt-in and policy-controlled; no raw prompt or response should be silently assumed trainable.

## Non-goals

- Training base models inside the gateway request path.
- Treating every model output as correct or as ground truth.
- Automatically training on provider outputs regardless of contractual terms.
- Replacing NOESIS as long-term personal/project memory.
- Replacing Ghost Factory's experimentation and training harness.
- Requiring a particular model, provider, vector database, or training framework.

## System boundaries

- **DMR-X Gateway:** emits minimal, policy-filtered task and execution events.
- **Capture adapters:** accept structured feedback and outcome events from agents, CI, tests, code review, and human annotations.
- **Dataset Factory:** validates, classifies, transforms, deduplicates, scores, and versions records.
- **Dataset Registry:** records manifests, schema versions, lineage, splits, rights, retention, and quality reports.
- **Export API/CLI:** provides authorized dataset snapshots to Ghost Factory or other approved consumers.
- **Ghost Factory:** trains candidates and runs independent evaluations; returns experiment results and candidate metadata.
- **Model registry/router:** deploys a candidate only through a separate, explicit approval and release path.

## Proposed pipeline

1. **Capture** a minimal event with stable IDs and source metadata.
2. **Authorize** the source and intended use before persisting training content. Deny by default when permission is unknown.
3. **Classify** sensitivity, data type, modality, tenant/owner, source provider, retention class, and training eligibility.
4. **Minimize and redact** secrets, credentials, tokens, unnecessary PII, and irrelevant context. Keep raw evidence in a separately protected store only when necessary and permitted.
5. **Normalize** into a versioned canonical schema while preserving references to source artifacts and immutable hashes.
6. **Validate** structure, licenses/terms, provenance completeness, duplicate content, contamination, and policy requirements.
7. **Label and score** using objective outcomes where possible: test results, CI, independent review, explicit user feedback, task success, latency/cost, and calibrated annotator confidence.
8. **Curate** task-specific datasets. Keep positive, negative, preference, trajectory, and evaluation records distinct.
9. **Split** train/validation/test sets by project, task family, time, or source lineage to reduce leakage. Evaluation sets are immutable and access-restricted.
10. **Version and export** a reproducible snapshot plus manifest, data card, quality report, exclusions, hashes, and source lineage.
11. **Evaluate downstream** in Ghost Factory against fixed baselines and regression suites.
12. **Promote or reject** the candidate. Record results; never auto-promote solely on a training loss improvement.

## Canonical record (initial schema proposal)

Each record should support fields equivalent to:

- `record_id`, `schema_version`, `created_at`
- `source_system`, `source_event_id`, `source_artifact_refs`, `content_hashes`
- `owner_or_tenant`, `data_classification`, `consent_or_authority_ref`
- `provider`, `model_id`, `model_version`, `prompt_template_version`, `tool_versions`
- `task_type`, `modality`, `input`, `candidate_output`, `accepted_output`
- `outcome_evidence`, `test_results`, `review_status`, `preference_label`, `quality_score`
- `training_eligibility`, `allowed_purposes`, `license_or_terms_ref`, `retention_policy`
- `redaction_status`, `dedup_group`, `split`, `dataset_versions`
- `deletion_state`, `audit_event_refs`

Do not put secrets or raw sensitive data in manifests, logs, or identifiers. Large payloads should live in controlled object storage with short-lived access grants; metadata can live in the registry database.

## Dataset families

### SFT: verified task/answer examples
Store the task, permitted context, accepted answer or patch, and supporting evidence. For coding records, include repository revision, diff, test commands/results, relevant environment, and review disposition where licensed and permitted.

### Preference pairs
Store two or more candidate answers, a preference label, the evaluator/source, rationale where available, and evidence. Do not infer preference solely from which model answered last or which output is longer.

### Agent trajectories
Represent tool actions and outcomes as structured steps. Strip credentials, session tokens, irrelevant personal data, and provider-specific hidden/internal reasoning. Preserve observable action/result traces and concise, task-relevant explanations rather than attempting to capture private chain-of-thought.

### Routing and systems evaluation
Store workload characteristics and permitted measurements such as model/provider, capability, latency, token counts, cost, retries, error class, user-visible outcome, and benchmark score. Do not treat this telemetry alone as SFT examples; it is primarily for routing policies, model selection, and evaluation.

### Evaluation suites
Maintain public, internal, project-specific, privacy-sensitive, and canary suites with explicit access rules. Never train on held-out test answers. Track known contamination and rotate or retire compromised tests.

### Multimodal
Design the schema for text, code, image, audio, video, and future modalities, but ship text/code first. Store references and modality metadata rather than forcing binary payloads into JSONL.

## Initial source integrations

- DMR-X gateway events: task metadata and permitted performance telemetry; content capture off unless a policy explicitly allows it.
- Human feedback: explicit accept/reject, correction, ranking, or annotation.
- Ghost Factory: task specs, patches, test results, lint/type-check/security results, review feedback, and build outcomes.
- CI/test systems: machine-verifiable outcomes with tool/version provenance.
- Other ecosystem agents: opt-in adapters using a documented event contract.
- External model providers: source-specific allow/deny rules for training use; do not assume provider output rights from API access alone.

## Policy and privacy requirements

- Default to no training capture until an administrator/owner enables a source and purpose.
- Separate operational telemetry from content capture.
- Enforce purpose limitation, tenant isolation, least privilege, encryption in transit/at rest, audit logs, retention windows, and deletion workflows.
- Apply secret scanning and PII minimization before any export.
- Support source revocation and propagate deletion/exclusion to future snapshots; document that data already used in a trained model may require retraining or other mitigation rather than simple row deletion.
- Do not ingest personal or third-party data without a valid basis and appropriate permissions.
- Provider terms, open-source licenses, dataset licenses, customer contracts, and local law must be checked independently.
- Prevent cross-tenant training by default; any pooled learning must be explicit, authorized, and auditable.
- Keep a restricted raw-evidence store separate from curated training data.
- Fail closed when provenance, authority, or license status is missing or ambiguous.

## Quality and anti-poisoning controls

- Treat all incoming content as untrusted, including tool output and repository text.
- Detect duplicate/near-duplicate examples and train/eval leakage.
- Score objective evidence separately from model-generated judges.
- Use independent evaluators and human review for high-impact or ambiguous labels.
- Detect malicious instructions, prompt injection, poisoned examples, test gaming, and reward hacking.
- Keep rejection reasons and low-confidence records out of default training exports.
- Balance data by task, project, source, difficulty, language, and model family to avoid overfitting to the loudest source.
- Keep a clean, fixed evaluation suite and a rotating challenge set.

## Dataset versioning and reproducibility

Every release should include:
- immutable dataset ID and semantic version;
- schema and transformation pipeline versions;
- included/excluded record counts and reasons;
- source and rights manifest;
- redaction/quality/deduplication reports;
- split strategy and contamination checks;
- content hashes and reproducible export parameters;
- known limitations and intended uses;
- parent dataset versions and change summary.

A dataset release is immutable. Corrections create a new version. Support lineage queries from a trained adapter/checkpoint back to dataset releases and permitted source records.

## API/CLI proposal

Names are illustrative; align them with existing DMR-X conventions during implementation.

- `POST /v1/data/events` — submit a structured capture event.
- `POST /v1/data/feedback` — submit human or machine outcome labels.
- `POST /v1/datasets` — create a dataset definition from authorized filters.
- `GET /v1/datasets/:id` — inspect dataset metadata and quality state.
- `POST /v1/datasets/:id/validate` — run policy, provenance, schema, and leakage checks.
- `POST /v1/datasets/:id/releases` — create an immutable release.
- `GET /v1/datasets/:id/releases/:version/manifest` — fetch manifest and data card.
- `POST /v1/datasets/:id/exports` — request an authorized, audited export.
- `POST /v1/data/deletion-requests` — revoke or delete eligible source records and rebuild affected future releases.
- `GET /v1/lineage/models/:modelVersion` — inspect dataset/experiment lineage.
- CLI equivalents for ingest, validate, curate, release, export, and lineage.

All endpoints require authentication, authorization, quotas, audit events, and tenant scoping. Large exports should be asynchronous and use expiring signed URLs or equivalent protected transfer.

## First implementation phases

### Phase 0 — repo fit and threat model
Map current telemetry, storage, policy, auth, audit, provider metadata, and evaluation abstractions. Decide canonical event contracts and storage boundaries before adding new infrastructure.

### Phase 1 — schema and opt-in capture
Add typed schemas, policy checks, minimal gateway metadata events, feedback/outcome ingestion, and tests proving disabled capture does not persist content.

### Phase 2 — registry and curated text/code datasets
Add dataset definitions, manifests, lineage, immutable versions, deduplication, redaction hooks, and export to JSONL/ChatML-like formats where supported.

### Phase 3 — Ghost Factory integration
Provide a documented API/CLI adapter to export snapshots and import experiment results. Training remains outside DMR-X's request-serving path.

### Phase 4 — quality and evaluation
Add split management, contamination detection, independent benchmark reports, data cards, regression gates, and dataset release checks.

### Phase 5 — production hardening
Add retention/deletion propagation, encryption/access review, tenant isolation tests, quotas, metrics, backup/restore, and operational runbooks.

### Phase 6 — modality expansion
Add image/audio/video/code-specialized payload references and modality-specific validation only after the text/code pipeline is stable.

## Acceptance criteria

- Content capture is disabled by default and controlled per source, tenant, and purpose.
- Unknown or disallowed provenance blocks training export.
- A record can be traced to its source, policy decision, transformations, and dataset releases.
- Secrets and configured sensitive fields are excluded from exports by automated tests.
- Duplicate records and train/eval leakage are detected and reported.
- Evaluation splits cannot be silently included in training exports.
- Dataset releases are immutable, reproducible, and carry manifests/data cards.
- An authorized consumer can export a snapshot without accessing unrelated tenants or raw evidence.
- Deletion/revocation changes future exports and records the impact on derived datasets.
- Ghost Factory can associate each experiment and candidate adapter with exact dataset versions.
- Model promotion remains separate and requires independent evaluation and explicit approval.
- No claim of quality improvement is made without benchmark evidence.

## Key risks and mitigations

- **Logging everything:** opt-in capture, data minimization, separate telemetry/content controls.
- **Training on wrong answers:** outcome-backed labels, review gates, clean evaluation.
- **Provider or license violations:** source-specific eligibility and fail-closed export.
- **Privacy leakage:** classification, redaction, isolation, retention/deletion controls.
- **Evaluation contamination:** immutable holdouts, lineage, duplicate checks, challenge sets.
- **Model collapse/overfitting:** balanced data, held-out evaluation, small adapter experiments, rollback.
- **Unbounded storage cost:** retention tiers, sampling, compression, quotas, dataset TTLs.
- **Scope creep in the gateway:** keep training and expensive transformations asynchronous and out of the inference critical path.

## Open decisions for implementation

1. Reuse existing DMR-X event and storage abstractions where sound; do not introduce a second policy system.
2. Choose the initial metadata store and payload store based on the current repository architecture.
3. Define whether capture is configured per workspace, project, provider, and event type.
4. Agree a minimum data card and provenance contract before first export.
5. Determine the cleanest process boundary and license for a potentially separately licensed Dataset Factory package before code is placed in the repository.
6. Review the repository's current GPL-2.0 obligations and contributor ownership before choosing a different license.

## Success metric

The feature succeeds when it can produce a reproducible, permission-cleared dataset whose use measurably improves a downstream model or routing policy on held-out evaluations, while preserving provenance, privacy, and rollback—not merely when it collects a large volume of logs.
