# Dataset Factory licensing boundary — decision note

## Current repository context

The DMR-X root `LICENSE` is GNU GPL version 2 and `package.json` declares `GPL-2.0`. This note does not change the license of DMR-X or assert that any new component is already separately licensed.

## Can the Dataset Factory have a different license?

Potentially, yes, but a directory name or a second LICENSE file does not by itself establish a legally independent work. The answer depends on copyright ownership, existing contributions, how the code is derived from or combined with DMR-X, dependencies, and applicable law.

The project currently has contributors and third-party components to consider. The project owner cannot unilaterally relicense other contributors' copyrighted contributions unless the necessary rights have been granted.

## Recommended design if separate licensing is a real objective

1. **Keep the boundary real.** Implement the Dataset Factory as a separately buildable package/service with a documented, stable API. Prefer an independent process boundary (HTTP/gRPC/CLI/event contract) over source-level copying or tightly linked internals. A process boundary is useful architecture, not an automatic legal safe harbor.
2. **Keep it dependency-light.** Avoid importing GPL-covered DMR-X internals into the separately licensed component. Define a neutral event/schema package only after reviewing its own copyright and license.
3. **Use clean provenance.** Track authorship and origins for every file. Do not copy code into the new component unless its license permits the intended licensing.
4. **License the package explicitly.** If the code is wholly owned or all relevant rights are cleared, select a package-specific license and put a clear notice in the package README and source files. Keep the root GPL-2.0 notice for the existing DMR-X project.
5. **Audit dependencies.** Review direct and transitive dependency licenses and their distribution/linking conditions before publishing.
6. **Separate software from data.** Dataset content, schemas, generated datasets, model weights/adapters, and the Dataset Factory source code are different artifacts and may have different terms. Do not assume the software license automatically licenses collected data or trained weights.
7. **Document the contract.** State which directories/files are covered by which license and what the API boundary means. Include SPDX identifiers and a license inventory.
8. **Obtain legal review before release.** Confirm the intended structure under the project's actual facts and applicable law.

## License strategy options

- **Apache-2.0 for an independently licensed service/package:** permissive, includes an express patent grant, and is commonly used for commercial-friendly infrastructure. Only choose it if all included code can lawfully be distributed under it.
- **MIT for a small, independently owned component:** simple and permissive, but offers fewer explicit patent terms than Apache-2.0.
- **GPL-2.0 for the package:** keeps the component aligned with the current repository's license and avoids introducing a new licensing family.
- **Commercial dual licensing:** possible only if the licensor has sufficient rights to offer the same owned code under alternate terms; third-party contributions and dependencies require careful handling.

Do not choose a proprietary/custom license merely to prevent competitors from using the data or service. If the goal is to protect dataset contents, control access and terms for those datasets separately; if the goal is to monetize the software, choose a deliberate open-source or source-available strategy with legal advice.

## Decision requested

Before implementation, decide whether the Dataset Factory is intended to be:
- A first-party GPL-2.0 package inside DMR-X; or
- A separately maintained service/package with an explicit independent license and API boundary.

Until that decision and ownership/dependency review are complete, treat separate licensing as a design constraint to preserve—not a legal conclusion.
