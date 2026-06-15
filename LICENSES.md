# License & Dependency Policy

DMR-X is licensed under **BSL-1.1** (Business Source License). The
following policy governs which licenses we accept in our dependency
tree and how we generate the Software Bill of Materials (SBOM) for
each release.

## Accepted licenses

| License | Use | Notes |
|---------|-----|-------|
| **MIT** | Most JS/TS packages | Default acceptable |
| **Apache-2.0** | Several server-side libs | Default acceptable |
| **BSD-2-Clause / BSD-3-Clause** | Some legacy packages | Default acceptable |
| **ISC** | Many small utility packages | Default acceptable |
| **MPL-2.0** | Mozilla Public License | Acceptable for file-level copyleft deps |
| **LGPL-2.1 / LGPL-3.0** | Weak copyleft | Only acceptable for dynamically linked libraries (not used directly in DMR-X) |
| **BSL-1.1 / BSL-compatible** | DMR-X's own license | We accept our own license |

## Disallowed licenses

| License | Reason |
|---------|--------|
| **GPL-2.0 / GPL-3.0** | Strong copyleft, incompatible with our distribution model |
| **AGPL-3.0** | Network copyleft, incompatible with our SaaS model |
| **SSPL** | Server Side Public License — restricts commercial use |
| **Commons Clause** | Adds commercial restrictions on top of permissive licenses |
| **Unlicense / Public Domain** | License ambiguity in some jurisdictions |

## License checking

License compliance is verified at release time via the SBOM
generation step (see `.github/workflows/release.yml`):

1. **Generate SBOM** — `anchore/sbom-action` produces a CycloneDX
   JSON document from the built container image.
2. **Scan licenses** — the SBOM is uploaded as a release artifact
   alongside the binaries.
3. **Manual review** — for any new dep with a license not in the
   accepted list, the release manager must add a justification to
   this file before merging.

To run a license check locally:

```sh
# Install license-checker
bun add -d license-checker

# Generate a license report
bun x license-checker --json --out licenses.json

# Print the report
cat licenses.json | jq -r 'to_entries[] | "\(.key): \(.value.licenses)"' | sort
```

## SBOM

Every release publishes a CycloneDX-format SBOM as a release asset.
The SBOM is consumed by:

- **Vulnerability scanners** (Trivy, Grype, Snyk) — match package
  hashes against CVE databases
- **Compliance teams** — verify all transitive deps have acceptable
  licenses
- **Procurement** — answer "what's in this binary?" without
  rebuilding from source

The SBOM is also available from the container registry:

```sh
# Pull the SBOM directly from ghcr
cosign download sbom ghcr.io/danny-dis/dmr-x:0.1.1

# Or via the release artifact
gh release download v0.1.1 --pattern 'sbom.cdx.json'
```

## Current dependency license summary

Last audit (manual, run with `license-checker`):

| License | Count | Examples |
|---------|-------|----------|
| MIT | 480+ | fastify, zod, @opentelemetry/api |
| Apache-2.0 | 80+ | @modelcontextprotocol/sdk, mcp-server |
| ISC | 30+ | chownr, ini, glob |
| BSD-3-Clause | 20+ | source-map, ieee754 |
| BSD-2-Clause | 10+ | esprima, css-select |
| MPL-2.0 | 5+ | source-map-js (only used at build time) |
| Unlicense | 1 | tslib |

All present licenses are in the accepted list. No GPL, AGPL, SSPL,
or Commons Clause deps are present.

## Adding a new dependency

Before adding a new direct dependency:

1. Check the license is in the accepted list (or has been approved
   by adding a row to this file)
2. Run `bun audit` to confirm no high or critical CVEs
3. Pin the exact version in `package.json` (no `^` or `~`)
4. Document it in the relevant package's README

For transitive dependencies, no action is required beyond the
weekly `bun audit` run in CI.
