# DMR-X Compliance Layer

Runtime hardening implemented for bank-grade / regulated deployment. This file
documents which controls are **code** (shipped) vs **process** (operator-owned).

## Runtime controls (implemented)

### Option 2 — Database encryption at rest
- The gateway's on-disk sql.js database is encrypted with **AES-256-GCM** when
  `DMRX_ENCRYPTION_KEY` is set (required in production).
- Encrypted file: `<dataDir>/data.db.enc`. Plaintext `data.db` is removed once
  encryption is enabled.
- Key reuse: same `DMRX_ENCRYPTION_KEY` already used for secret encryption.
- **Limitation:** the in-memory sql.js database remains plaintext. Full
  transparent disk encryption (TDE) would require migrating to sqlcipher, which
  is a separate, larger change. At-rest file encryption closes the "disk
  stolen / backup leaked" threat but not "live process memory" compromise.

### Option 4 — Data-access audit trail
- Every subagent tool call records a signed, append-only entry to
  `<dataDir>/data-access-audit.log`.
- Tamper-evidence: each entry's HMAC-SHA256 covers the previous entry's HMAC,
  so editing/deleting/reordering any line breaks the chain
  (`verifyDataAccessLog()`).
- Secrets are never logged: argument values for keys matching
  `key|token|secret|password|authorization|apikey` are redacted, and file
  contents / large blobs are truncated.

### Option 5 — Transport + SIEM (runtime parts)
- **Mutual TLS (mTLS):** when `DMRX_TLS_CERT` + `DMRX_TLS_KEY` are set, the
  gateway terminates TLS. With `DMRX_TLS_CA` set it requests a client cert;
  `DMRX_TLS_REQUIRE_CLIENT_CERT` gates enforcement (observe-mode vs enforce).
- **SIEM forwarding:** when `DMRX_SIEM_URL` is set, every response is mirrored
  as a structured audit event, fire-and-forget (2s timeout, never blocks or
  throws). Disabled when unset.

## Operator-owned controls (NOT code — checklist)

These are required for a real bank deployment and live outside the codebase:

- [ ] **SBOM** generation (e.g. `syft`, `cyclonedx`) wired into CI.
- [ ] **Dependency / container scanning** (Trivy, Grype) in the pipeline.
- [ ] **External penetration test** of the gateway + sandbox.
- [ ] **SOC 2 Type II** / **ISO 27001** attestation.
- [ ] **PCI-DSS** scoping if cardholder data is in scope.
- [ ] **Secrets manager / HSM** for `DMRX_ENCRYPTION_KEY` (do not store in env
      files on disk in prod).
- [ ] **Egress allow-listing** for code execution (the sandbox still has full
      network egress — see SandboxBackend decision).
- [ ] **Sandbox isolation:** sandbox untrusted code via nsjail/gVisor/Firecracker
      with egress deny-by-default. (Tracked separately — not in this change.)

## Environment variables

| Var | Purpose |
|-----|---------|
| `DMRX_ENCRYPTION_KEY` | 64-hex-char key; enables DB encryption + audit HMAC + secret crypto |
| `DMRX_DATA_DIR` | base dir for `data.db.enc` + `data-access-audit.log` |
| `DMRX_TLS_CERT` / `DMRX_TLS_KEY` | enable HTTPS termination |
| `DMRX_TLS_CA` | enable client-cert request (mTLS) |
| `DMRX_TLS_REQUIRE_CLIENT_CERT` | enforce client cert (vs observe-only) |
| `DMRX_SIEM_URL` | enable fire-and-forget SIEM audit forwarding |
