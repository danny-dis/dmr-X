# DMR-X — Neural / EEG Capability Architecture

**Status:** Architecture addition
**Date:** 2026-09-07

## Purpose

DMR-X must treat neural/BCI processing as a first-class specialist capability family rather than treating every model as an LLM.

The goal is to route neural workloads by **capability and task**, using the best specialized model for the operation.

This does not imply mind-reading. Signal reconstruction, representation learning, brain-state decoding, and neural-to-language decoding are distinct capabilities and must remain explicitly separated.

## Capability taxonomy

### 1. Neural signal restoration

**ZUNA**

Use for:
- EEG denoising/reconstruction workflows where supported
- masked channel infilling
- signal super-resolution
- adaptation to varying electrode counts/positions

ZUNA is primarily a signal-quality and reconstruction specialist, not a semantic thought decoder.

### 2. General neural representation

Candidates include:
- INCEPT
- CBraMod
- LaBraM
- EEGPT
- EEGMamba
- CSBrain
- LUNA
- FEMBA

Use these for reusable EEG embeddings, representation extraction, downstream classification, state decoding and related signal-analysis workloads according to validated model capabilities.

### 3. Neural-to-language / semantic interfaces

Candidates include:
- NeuroLM
- Neuro-GPT

These belong downstream of signal preprocessing/representation when the workload requires alignment between EEG representations and language or semantic tasks.

### 4. Multimodal neural signals

**BrainOmni** and comparable models can be registered when they provide validated support for the required neural modalities such as EEG/MEG.

### 5. Intracranial neural signals

Candidates include:
- Brant
- BrainBERT
- BIOT

These must be capability-gated separately from non-invasive EEG models because signal characteristics, acquisition requirements and deployment assumptions differ.

## Routing contract

A neural request should expose structured requirements such as:

```yaml
modality: neural
signal_type: eeg
operation:
  - restore
  - represent
  - decode_state
  - neural_to_language
constraints:
  electrode_layout: arbitrary
  latency: low
  locality: local_preferred
privacy:
  class: highly_sensitive
```

The registry should represent models with a corresponding capability profile:

```yaml
model: zuna
modality: neural
signal_types: [eeg]
operations: [restore, channel_infill, super_resolution]
layout: arbitrary_electrode_positions
license: apache-2.0
```

The exact metadata must be validated from model documentation before a model becomes production-eligible.

## Routing examples

```text
Missing/noisy EEG channels
    -> ZUNA

Stable EEG representation
    -> INCEPT / CBraMod / LaBraM / EEGPT / EEGMamba / CSBrain / LUNA / FEMBA

EEG representation -> language/semantic task
    -> NeuroLM / Neuro-GPT

EEG + MEG multimodal task
    -> BrainOmni or validated equivalent

Intracranial neural signal task
    -> Brant / BrainBERT / BIOT
```

DMR-X should benchmark these models per task rather than assume one universal winner. Recent EEG foundation-model benchmarks and reviews show meaningful differences across tasks and datasets.

## Integration with NOESIS

NOESIS should consume neural processing outputs as **structured observations**, not raw model internals by default.

Example:

```text
EEG acquisition
   -> DMR-X neural routing
   -> signal restoration
   -> representation/decoder
   -> validated observation
   -> NOESIS
```

NOESIS can retain:
- timestamped neural-state observations
- provenance/model/version
- confidence and uncertainty
- acquisition metadata
- subject/session scope
- derived state labels or embeddings where policy permits
- longitudinal trends

Raw EEG remains a separate high-sensitivity data class with explicit retention and access policies.

## Integration with ATHENA

ATHENA should not become an EEG model host or neural-signal router.

Instead:

```text
ATHENA governance/lattice
        |
        | approved neural-analysis task
        v
      DMR-X
        |
        v
specialized neural model(s)
        |
        v
structured result
        |
        +--> NOESIS
        +--> ATHENA decision context
```

ATHENA can therefore reason over validated neural observations without embedding model-specific logic into its sovereign orchestration layer.

## Safety and privacy requirements

Neural data is highly sensitive. Production routing should support:
- explicit consent and policy context
- local-only routing where required
- strict retention controls
- encrypted transport/storage
- model/provider trust classification
- provenance and auditability
- separation of raw signals from derived observations
- uncertainty reporting
- prohibition on unsupported claims about thoughts, intentions or mental states

## Architectural principle

**DMR-X routes neural capabilities; NOESIS remembers validated observations; ATHENA governs and reasons over approved information.**
