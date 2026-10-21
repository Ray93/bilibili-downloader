# AGENTS.md

FluxDown plugin scaffolded from `fluxdown-plugin-sdk`. One runtime entry (`dist/main.js` ← `src/main.tsx`) that registers an activity-bar view (`dashboard`) and a command (`hello`).

## Toolchain

- **pnpm only.** The pnpm version is pinned by `mise.toml`; `pnpm-lock.yaml` (lockfile v9) is the only lockfile. Do not introduce npm/yarn lockfiles.
- `pnpm-workspace.yaml` holds pnpm settings (`allowBuilds` for esbuild), not workspace packages — there is a single package.
- Node >= 20 is required by the SDK's `engines` field.
- TypeScript 5.7, `strict`, `noEmit`; only `src/` is type-checked.

## Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Type-check | `pnpm typecheck` |
| Build bundle into `dist/` + validate | `pnpm build` |
| Validate existing `dist/` only | `pnpm validate` |
| Build + zip into `<identity>-<version>.fxplug` | `pnpm pack` |
| Watch + rebuild on save | `pnpm dev` |

Smallest verification loop:

1. `pnpm typecheck` for any `src/` change (no bundling, fastest signal).
2. `pnpm build` when the change affects the bundle or `manifest.json`; `build` also runs validation.
3. `pnpm validate` alone only inspects the existing `dist/` — run `pnpm build` first after editing `src/` or `manifest.json`, or it validates stale output.

There is no test framework and no linter/formatter configured. Do not claim tests pass; the gate is `pnpm typecheck` + `pnpm build`.

## Generated files — do not edit

- `dist/` — fully produced by `pnpm build` (`main.js`, `manifest.json`, copied assets). Never hand-edit `dist/main.js` or `dist/manifest.json`; edits are discarded on the next build.
- `*.fxplug` at the repo root (currently `ray93@bilibili-downloader-0.1.0.fxplug`) — `pnpm pack` artifact, a zip of `dist/`.
- Both are gitignored. Do not commit them.

## How the build works (non-obvious)

- `fluxdown-plugin.config.json` maps output names to sources (`entries`: `main.js` ← `src/main.tsx`). Only files listed there become top-level files in `dist/`; other modules are pulled in only by being imported. A new bundle, or any `desktop`/`assets` output, must be registered in this file.
- `entries` are bundled as classic ES2022 IIFE scripts: `import`/`export` do not survive in the output. The SDK runtime and JSX runtime are inlined, so `dist/` is self-contained and has no runtime `node_modules` dependency.
- The root `manifest.json` is the source of truth; `build` copies it to `dist/manifest.json` and validates it strictly.
- Strict validation rejects: unknown manifest fields, contributions whose referenced files are not in the package, and declarations missing their matching permission (`main.background` → `background`, `desktop` → `desktop`, `contributes.pageScripts` → `pageScripts`). `dist/manifest.json` must reference only files that were actually built. Validator messages are in Chinese.
- Valid permissions: `ffmpeg`, `ytdlp`, `auth`, `tasks`, `browserRules`, `desktop`, `background`, `intercept`, `pageScripts`.

## Constraints that bite

- `tsconfig.json` sets `"lib": ["ES2022"]` and `"types": []`, so no DOM or Node globals are typed — `window`, `document`, `console` are unavailable unless you add types. Use the host-injected `flux` object and `fluxdown-plugin-sdk` types.
- Views are JSX view nodes, not HTML: `jsxImportSource` is `fluxdown-plugin-sdk/ui`. `src/env.d.ts` (`/// <reference types="fluxdown-plugin-sdk" />`) is what provides JSX typing — keep it, and keep `src/` as the only `include` root.
- View event handlers compare `ev.node` against generated paths such as `"root/inc"` (see `src/main.tsx`); node `key` values change those paths.

## Conventions

- `manifest.json` `identity` and `version` determine the packed artifact name, so bumping `version` renames the `.fxplug`.
- Keep `manifest.json` (`contributes.views` / `contributes.commands` ids) and the registrations in `src/main.tsx` (`flux.ui.view("<id>", …)`, `flux.commands.register("<id>", …)`) in sync when adding views or commands.

## Authoritative references

- SDK + CLI behavior: `node_modules/fluxdown-plugin-sdk/README.md` (CLI commands, `fluxdown-plugin.config.json` schema, package exports).
- Online docs linked from that README: SDK/CLI, Views, Permissions (`https://fluxdown.com/docs/en/plugins/...`).

## Completion criteria

- `pnpm typecheck` passes.
- `pnpm build` succeeds and its validation reports no errors.
- No manual changes under `dist/` and no committed `.fxplug`.
- If views/commands/permissions changed, `manifest.json` and `src/main.tsx` agree and validation still passes.
