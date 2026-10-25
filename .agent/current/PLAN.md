# Plan: Dev environment setup + dependency upgrades

## Status of environment setup (done, no repo changes)
- `pnpm install --frozen-lockfile` and `pnpm exec playwright install --with-deps chromium`.
- Baseline: `pnpm exec tsc --noEmit` clean; `pnpm run test` 201/201 passing.

## Upgrade steps
Each step is done by a fresh subagent, reviewed, then committed separately so it can be rolled back on its own.
Every step runs `pnpm exec tsc --noEmit` first. Steps that change runtime/test behaviour also run the full suite (`pnpm run test`) because dependency upgrades can affect everything (~1.2 min).

1. **TypeScript 6.0.3 -> 7.0.2**: adjust tsconfig only if TS 7 rejects or deprecates options; fix new type errors. Check: tsc only (esbuild does transpilation, so runtime is unaffected).
2. **Minor/patch updates within the current major**: AWS SDK packages, fontawesome, vanilla-extract (css + esbuild-plugin), idb-keyval, ignore, oidc-client-ts, react/react-dom 19.3, @types/react(-dom), smol-toml, @playwright/test 1.64 (+ reinstall Chromium). Check: tsc + full suite.
3. **Tooling majors**: esbuild 0.27 -> 0.28, c8 10 -> 12, asciidoctor 3 -> 4 (scripts/analyze_adoc.ts), @types/node ^24 (to match the Node v24 runtime). Check: tsc + `pnpm run build` + full suite.
4. **mobx 6 -> 7, mobx-react-lite 4 -> 5**: review changelogs for decorator/accessor changes. Check: tsc + full suite.
5. **monaco-editor 0.45 -> 0.57**: update worker entry paths in scripts/build.ts and any changed APIs. Check: tsc + `pnpm run build` + full suite.

Subagents stop and report rather than guess if an upgrade needs non-trivial source changes or a design decision.

## Decisions
- @types/node pinned to ^24 to match the Node v24 runtime.
- Commits go directly on main, one per step.
- Order: steps 1-3 first, then MobX (step 4), then Monaco (step 5), each as a separate step.
