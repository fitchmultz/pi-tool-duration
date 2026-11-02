# Adoption record — strict Oxlint/Oxfmt standard

This repository adopts the [Strict Oxlint/Oxfmt Engineering Guide](strict-oxlint-oxfmt-standard.md), version 5.1.2, as its quality standard. The adopted copy is a verbatim import formatted by the repository's formatter.

- Adopted copy SHA-256: `41b6d505b36007218ca56b7b3443fcbd96d994715da5a83aaca52b58af47d3d6`
- Source: `Strict-Oxlint-Oxfmt-Engineering-Guide-v5.1.2.md` (imported 2026-11-02)

## Repository and toolchain

- Repository: `pi-tool-duration` (npm package, Pi extension).
- Runtime and package manager: Node.js >= 24, npm with a committed lockfile resolving only from the public npm registry.
- Installed tool versions (devDependencies, exact pins): oxlint 1.90.0, oxlint-tsgolint 7.0.2005, oxfmt 0.75.0, TypeScript 7.0.2, @types/node 24.19.1, @earendil-works/pi-coding-agent 1.5.0 (development host; the peer dependency stays `*` and optional, and CI re-qualifies against the latest official and maintained-fork hosts).

## Configuration and acceptance paths

- Lint: `.oxlintrc.json` — Appendix A baseline plus the recorded adaptations: the test override also covers `test/fixtures/runtime-extension.ts`, and `typescript/no-floating-promises` carries the QX-001 safe-call allowance.
- Format: `.oxfmtrc.json` — §7.1 baseline. Oxfmt owns TypeScript, JavaScript, JSON, YAML, and Markdown, skipping `package-lock.json` and `node_modules/`.
- Compiler: `tsconfig.json` — single project including `extensions/`, `scripts/`, and `test/` with the §4.2 strict flags (`noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUncheckedSideEffectImports`, `forceConsistentCasingInFileNames`, `allowImportingTsExtensions`, checked JavaScript). `skipLibCheck` stays enabled because the repository has no handwritten declarations to check.
- Acceptance command: `npm run check` — runs every gate independently (`scripts/check.ts`): lint, format check, typecheck, and tests, aggregating failures so one failing gate cannot hide another.
- CI: `.github/workflows/quality.yml` runs lint, format, typecheck, and test as independent required jobs on pull requests and `main`; `pi-compatibility.yml` additionally runs `npm run check` and the runtime/restoration suites against the resolved official and maintained-fork hosts; `npm-release.yml` requires both workflows before publishing.

## Migration status

- All maintained handwritten sources are TypeScript inside the compiler project: `extensions/tool-duration/index.ts`, `scripts/check.ts`, and the seven files under `test/` (four suites, two policy suites, one fixture). The four `.mjs` test suites were converted to fully typed TypeScript with unchanged assertions and runtime behavior; `test/**/*.mjs` stays in the tsconfig include so any future checked JavaScript is covered.
- Lint findings were eliminated at the source rather than suppressed; the only inline directives are the recorded QX-002 and QX-003 exceptions below.
- Policy enforcement is automated in `test/enforcement.test.ts` (the six §6.4 no-floating-promises controls, directive inventory and attachment controls, unused-directive rejection, and config drift checks) and `test/coverage.test.ts` (§4.1 compiler-project membership for every maintained source).
- Migration finding budgets, diagnostic filtering, and incomplete-source exemptions: none present.

## Integrated verification

- Local verification on the `strict-oxlint-adoption` branch: `npm run check` passes all four gates (lint 0 findings, format clean, `tsc` 0 errors, 43/43 tests).
- Hosted acceptance: recorded by the `quality` and `Pi compatibility` workflow runs on the integrating revision; the release pipeline blocks publishing until both pass.

# Quality-exception records

## QX-001 — node:test registration allowance for no-floating-promises

```text
ID and title: QX-001 — unawaited node:test registrations
Rule, option, or threshold; installed tool versions: typescript/no-floating-promises, allowForKnownSafeCalls; oxlint 1.90.0, oxlint-tsgolint 7.0.2005
Scope: unawaited top-level test registrations in test/*.test.ts using the repository's single registration form, `import { test as nodeTest } from "node:test"`
Directive selectors/inventory and optional duplication bounds: none (configuration-level allowance; no site directives)
Diagnostic and required contract: node:test's runner model registers tests synchronously and executes them later; awaiting a registration can alter module-evaluation and hook timing (standard §6.4), so the unawaited call is the intended contract, not an oversight
Actual compliant alternative and demonstrated quality cost: awaiting every registration or collecting Promise results changes the timing semantics the runner defines and is explicitly called out by the standard as a mass-conversion anti-pattern; no behavioral benefit exists because the runner already owns the promises
Chosen adjustment and why its scope is appropriate: one allowForKnownSafeCalls entry pinned to the actual node:test declaration origin and the distinct local alias `nodeTest`; it cannot match context subtests, local functions, or foreign imports
Structural comparison or unsafe-type evidence, where applicable: n/a
Verification commands, relevant tests, and results: test/enforcement.test.ts — control 1 (top-level and loop registrations) passes with zero diagnostics; controls 2-6 (t.test context subtest, same-named local function, same-named foreign import, in-body floating promise, unrelated call) each fail with typescript(no-floating-promises); config drift test pins the exact allowance entry
Retained protection, lost detection, and established assumptions: all other floating promises still fail; detection limit recorded per §6.4 — an imported registration invoked inside a running test could create a subtest while matching the allowance, which the repository avoids by using context methods only where subtests are intended
Review and revisit trigger: adding any new registration form (describe/it/suite aliases) or upgrading oxlint/oxlint-tsgolint requires re-running the six controls
```

## QX-002 — session_before_compact preparation in-place mutation

```text
ID and title: QX-002 — Pi compaction preparation arrays are mutated in place
Rule, option, or threshold; installed tool versions: eslint/no-param-reassign (props: true); oxlint 1.90.0
Scope: extensions/tool-duration/index.ts, session_before_compact handler — exactly two property assignments on the borrowed preparation object: preparation.messagesToSummarize and preparation.turnPrefixMessages
Directive selectors/inventory and optional duplication bounds: two oxlint-disable-next-line directives, one per authorized assignment, each identified QX-002; test/enforcement.test.ts pins the count and attachment
Diagnostic and required contract: Pi passes a preparation object into session_before_compact and reads the same arrays back from that object after handlers return; returning a replacement object is not part of the handler contract
Actual compliant alternative and demonstrated quality cost: returning a new preparation object is ignored by the host (summaries silently not applied); mutating copied arrays still requires property writes on the borrowed object, which the rule equally flags, while adding allocations and obscuring the real data flow
Chosen adjustment and why its scope is appropriate: site directives at exactly the two assignments the Pi contract requires; no file-wide or rule-wide disable
Structural comparison or unsafe-type evidence, where applicable: n/a
Verification commands, relevant tests, and results: test/enforcement.test.ts relocation control — moving one directive to another operation re-exposes eslint(no-param-reassign) on the `preparation` assignment and reports the relocated directive as unused; runtime compaction tests pass on both hosts
Retained protection, lost detection, and established assumptions: every other parameter mutation still fails lint
Review and revisit trigger: changes to Pi's compaction handler contract or any new preparation mutation site
```

## QX-003 — deliberate non-conforming tool result in the runtime fixture

```text
ID and title: QX-003 — fixture returns an intentionally non-conforming tool result
Rule, option, or threshold; installed tool versions: typescript/no-unsafe-type-assertion and typescript/consistent-type-assertions; oxlint 1.90.0, oxlint-tsgolint 7.0.2005
Scope: test/fixtures/runtime-extension.ts, the `no_content` fixture action — the single `return {} as never` that exercises the host's normalization of missing tool content
Directive selectors/inventory and optional duplication bounds: one oxlint-disable-next-line directive covering both rules, identified QX-003; test/enforcement.test.ts pins the count and attachment
Diagnostic and required contract: the fixture must violate the ToolResult type contract on purpose so the runtime test verifies Pi normalizes missing tool content before the duration annotation
Actual compliant alternative and demonstrated quality cost: a type-conforming result with empty content removes the exact condition under test and would silently stop covering the host's non-conforming-result path
Chosen adjustment and why its scope is appropriate: one directive at the single authorized return; the fixture is otherwise fully typed and lint-clean
Structural comparison or unsafe-type evidence, where applicable: the assertion is to `never`, the narrowest type, making the violation explicit and unambiguous rather than an accidental `any`
Verification commands, relevant tests, and results: test/enforcement.test.ts relocation control — moving the directive re-exposes both typescript(no-unsafe-type-assertion) and typescript(consistent-type-assertions) and reports the directive as unused; the "normalizes missing tool content" runtime test passes on both hosts
Retained protection, lost detection, and established assumptions: every other type assertion in maintained sources still fails lint
Review and revisit trigger: changes to Pi's tool-result normalization or removal of the no_content fixture action
```
