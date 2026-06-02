# Contributing to DMR-X

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b feature/your-feature`
5. Make your changes
6. Run tests: `bun run test`
7. Run build: `bun run build`
8. Commit and push
9. Open a pull request

## Branch Naming

- `feature/<topic>` — new features
- `fix/<topic>` — bug fixes
- `refactor/<topic>` — code refactoring
- `docs/<topic>` — documentation changes

## Before Opening a PR

- [ ] `bun run test` passes (all unit tests)
- [ ] `bun run build` succeeds (all packages + UI)
- [ ] No generated files committed (`.js`, `.d.ts`, `.js.map` in source directories)
- [ ] TypeScript compiles without errors
- [ ] Changes are behavior-preserving where possible

## Code Style

- **TypeScript ESM** — all packages use `"type": "module"`
- **No `.ts` extensions in imports** — TypeScript resolves `.js` to `.ts`
- **Package boundaries** — `packages/*` never depends on `services/*` or `apps/*`
- **Zod validation** — use Zod schemas for input validation on admin endpoints
- **Parameterized SQL** — never interpolate user input into SQL strings
- **Small commits** — prefer focused, atomic commits over large changes

## Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full monorepo layout and package dependency rules.

## Testing

See [docs/TESTING.md](docs/TESTING.md) for the testing guide.

## Documentation

When adding features or making changes:
- Update relevant documentation in `docs/`
- Keep `README.md` accurate if the change affects user-facing behavior
- Update `docs/CHANGELOG.md` with notable changes

## Contributor License Agreement

All contributors must sign the [Contributor License Agreement](CLA.md) before their contributions can be merged. See [CLA.md](CLA.md) for details.

## License

This project is licensed under the [Business Source License 1.1](LICENSE). By contributing, you agree that your contributions will be licensed under the same terms.
