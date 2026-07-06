# Security Policy

## Supported Versions

We currently only provide security updates for the latest version of DMR-X.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

We take the security of DMR-X seriously. If you believe you have found a security vulnerability, please do NOT open a public issue. Instead, please report it to us by emailing **security@dmr-x.io**.

Once you have submitted your report, we will:
1. Acknowledge receipt of your report within 48 hours.
2. Provide an estimated timeline for a fix.
3. Notify you once the vulnerability has been patched.

Please include as much detail as possible in your report, including:
- A description of the vulnerability.
- Steps to reproduce the issue.
- Potential impact.
- Any suggested mitigations.

Thank you for helping keep DMR-X secure!

## Security History

### v0.5.0 (2026-06-25)
- **Hardened admin key validation** — Admin API key now requires minimum 32 characters in production. Previous versions accepted weaker keys.
- **Fixed timing attack vulnerability** — Admin key comparison now uses fixed-length buffers to prevent timing side-channel attacks.
- **Replaced dynamic code execution** — Federation manager no longer uses `new Function()` constructor for optional module imports, eliminating a potential code injection vector.

### v0.4.0 (2026-06-20)
- **Fastify 4 → 5 upgrade** — Closed Content-Type tab-character bypass CVE present in Fastify 4.x.
- **Request logging** — Added durable per-request audit log table for security monitoring.

### v0.2.0 (2026-06-15)
- **Cross-tenant data leak patch** — Fixed isolation boundary that could leak data between tenants.
- **SSRF DNS-rebinding bypass patch** — Added protections against DNS rebinding attacks that could bypass network restrictions.
- **11 CVEs patched** — Addressed multiple known vulnerabilities in dependencies.
- **Hardened Dockerfile** — Multi-stage build with non-root user, tini as PID 1, HEALTHCHECK.
- **Banned-pattern CI gate** — Prevents hardcoded secrets and `@ts-nocheck` from being committed.
- **Admin key validation** — Production mode now requires strong admin API keys.
- **Encryption key validation** — AES-256-GCM encryption key must be exactly 64 hex characters.

### v0.1.1 (2026-06-12)
- **Response compression** — Added gzip/deflate/brotli compression with configurable threshold.

### v0.1.0 (2026-06-10)
- **Initial security hardening** — Body limits, request timeouts, connection timeouts, trust proxy configuration, CORS restrictions.
