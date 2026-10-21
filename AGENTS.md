# AGENTS.md

FluxDown plugin `fluxdown@bilibili-downloader`: a Bilibili bangumi resolver plus subscription provider with QR login. `resolve.js` lists episodes and resolves per-quality DASH URLs in two stages, `auth.js` runs the QR login, and `main.js` renders the activity-bar status panel.

## Toolchain

- **pnpm only.** The pnpm version is pinned by `mise.toml`; `pnpm-lock.yaml` (lockfile v9) is the only lockfile. Do not introduce npm/yarn lockfiles.
- `pnpm-workspace.yaml` holds pnpm settings (`allowBuilds` for esbuild, `minimumReleaseAgeExclude`), not workspace packages — there is a single package.
- Node >= 20 is required by the SDK's `engines` field.
- TypeScript 5.7, `strict`, `noEmit`; `tsc` covers `src/` (tests included; `node_modules/` and `dist/` excluded).

## Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Type-check | `pnpm typecheck` |
| Unit tests (vitest) | `pnpm test` |
| Build bundles into `dist/` + validate | `pnpm build` |
| Validate existing `dist/` only | `pnpm validate` |
| Build + zip into `<identity>-<version>.fxplug` | `pnpm run pack` (plain `pnpm pack` is pnpm's built-in npm-pack and produces a `.tgz`) |
| Watch + rebuild on save | `pnpm dev` |

Smallest verification loop:

1. `pnpm typecheck` for any `src/` change (fastest signal, includes tests).
2. `pnpm test` for logic changes (pure helpers, parsing, naming, selection).
3. `pnpm build` when the change affects a bundle or `manifest.json`; `build` also runs strict validation.
4. `pnpm validate` alone only inspects the existing `dist/` — run `pnpm build` first after editing `src/` or `manifest.json`, or it validates stale output.

There is no linter/formatter configured; do not claim a lint step exists.

## Generated files — do not edit

- `dist/` — produced entirely by `pnpm build` (`main.js`, `resolve.js`, `auth.js`, `manifest.json`). Hand edits are discarded on the next build. `LICENSE` is also copied into `dist/` by `build`: it comes from the `assets` array in `fluxdown-plugin.config.json`, not from a manifest entry.
- `*.fxplug` at the repo root — `pnpm run pack` artifact (zip of `dist/`). Currently `fluxdown@bilibili-downloader-{version}.fxplug`; the name comes from `manifest.json` `identity` + `version`, so a version bump renames the artifact.
- Both are gitignored. Do not commit them.

## How the build works (non-obvious)

- `fluxdown-plugin.config.json` maps output names to sources: `main.js` ← `src/main.tsx`, `resolve.js` ← `src/resolve.ts`, `auth.js` ← `src/auth.ts`. Only listed files become top-level files in `dist/`; everything else must be imported from an entry. `assets` (`LICENSE`) are copied verbatim into `dist/` and shipped in the `.fxplug`.
- `entries` are bundled as classic ES2022 IIFE scripts with the SDK and JSX runtime inlined: no `import`/`export` survives in `dist/`, and there is no runtime `node_modules` dependency.
- `resolve.js` registers **both** `globalThis.resolve` and `globalThis.subscribe` (`defineResolver` + `defineSubscription`); `auth.js` registers `globalThis.authenticate`; `main.js` registers the view via `defineMain`.
- The root `manifest.json` is the source of truth; `build` copies it to `dist/manifest.json` and validates it strictly.
- Strict validation rejects: unknown manifest fields, non three-part `version`/`minAppVersion`, entries that were not built, and declarations missing their permission. `auth.entry` requires `permissions: ["auth"]`. Valid permissions: `ffmpeg`, `ytdlp`, `auth`, `tasks`, `browserRules`, `desktop`, `background`, `intercept`, `pageScripts`.
- The validator only permits one resolver and one subscription provider per plugin; `providerId` must be a lowercase slug and cannot use the built-in RSS id.

## Architecture conventions

- Resolver/auth logic lives in `src/bilibili/` — `shared/` (constants, types, text, ids, naming, crypto), `http/` (client, cookies, wbi), `media/` (quality, episodes, season, video), `bangumi/` (resolve, subscribe), `video/` (resolve: `/video/` links → page × quality manifest), `uploader/` (videos, resolve, subscribe) and the provider dispatcher `subscribe.ts` — plus `src/auth/session.ts`. Every module takes an explicit `PluginHost` (`src/host.ts`) — only `src/main.tsx`, `src/resolve.ts`, `src/auth.ts` touch the SDK runtime or the `flux` global.
- Source comments are written in Chinese; identifiers, API field names and user-facing/error strings keep their existing form.
- Keep new logic host-injected and pure where possible: `src/tests/` covers these modules with a fake host (`src/tests/fake-host.ts`). Tests live under `src/` on purpose — the project include covers them, and esbuild never bundles them because they are not reachable from an entry.
- `hostFromFlux(flux)` is cheap: re-adapt it per read in `main.tsx` instead of caching, because `flux.settings` may be a snapshot.

## Compatibility contracts (do not change casually)

- Resolver items: `ep:<epId>`, `ep:<epId>@q:<qualityId|h<height>>`, `video:<bvid>:cid:<cid>[@q:...]`; parse via `src/bilibili/shared/ids.ts` and keep the existing Chinese error messages. `video:` items now come from both UP 主 subscriptions and single `/video/BV...` / `/video/av...` links; the av ↔ BV conversion is not done locally — the first stage reads `bvid` from the view API (`?aid=` with an HTML fallback) so item ids stay bvid-based.
- Manifest item ids (`ep:<id>@q:<qualityKey>`), item names (`<名> [<quality-tag>].<container>`), `path` for extras, and the flat item layout (the host UI has no nested variants). Single-video manifests reuse the same naming: `<title> [<tag>].mp4` for one page, `P<n> <part> [<tag>].mp4` for multi-page videos (the title lives in the manifest group name, and the host manifest row truncates without a tooltip) — the second stage rebuilds that name through `videoPageBaseName` so the list name and the saved file name agree.
- Resolve results keep `ephemeral: true`, `rangeSupported: true`, and `extraHeaders` (Cookie/Referer/UA) so the download stage can fetch the temporary URLs.
- Subscription `providerId` is `bilibili-bangumi` (user-visible in the wizard) and subscription `guid`/`resolverItem` reuse the same item id formats.
- Settings keys (`cookies`, `reuseStoredSession`, `includeExtras`, `highestQualityOnly`, `quality`) are read through `settingString`/`settingBool`; manifest boolean defaults arrive as `"true"`/`"false"` strings, so never use `Boolean(...)` on a setting.

## Constraints that bite

- `tsconfig.json` uses `"lib": ["ES2022"]` and `"types": []`: no DOM or Node globals. The SDK declares a `console` global, but resolve/auth code logs through `flux.logger`; never log cookie values.
- `setTimeout` is not in the ES2022 lib. Use `delay()` from `src/bilibili/shared/text.ts`, which resolves it through `globalThis`.
- Views are JSX view nodes, not HTML (`jsxImportSource: fluxdown-plugin-sdk/ui`). `src/env.d.ts` provides the JSX types — keep it.
- View event node paths are derived from `key`s (`"root/<key>"`); `src/main.tsx` matches the last path segment, so new controls need unique keys.
- The FNV/QuickJS host only gets text bodies from `flux.fetch`; handle API JSON defensively with the helpers in `src/bilibili/shared/text.ts`.
- `/x/player/playurl` DASH entries carry no `size`/`filesize` field, only `bandwidth`; `streamBytes()` therefore falls back to `bandwidth × 时长 / 8` (measured within ~0.02% of the CDN `Content-Length`), so manifest item sizes are near-exact estimates, and explicit `size` always wins when the API provides one.

## Security and trust

- Cookies and auth profiles are user secrets: write them only to `flux.storage` / `flux.auth`; never render, log, or commit them.
- Everything the host executes is built from `src/` into `dist/`; do not add externally sourced JS to the package, and treat any pasted third-party code as untrusted.

## Authoritative references

- SDK + CLI behavior: `node_modules/fluxdown-plugin-sdk/README.md` (CLI, config schema, exports) and `node_modules/fluxdown-plugin-sdk/dist/manifest.d.ts` + `types/flux.d.ts` (the manifest rules and `flux` API this repo is coded against).
- Executable spec for naming/selection and parsing rules: `src/tests/`.
- User-facing docs for this plugin: `README.md`.
- Online plugin docs: `https://fluxdown.com/docs/zh/plugins/overview/` (Views, Permissions, SDK/CLI).

## Completion criteria

- `pnpm typecheck` and `pnpm test` pass.
- `pnpm build` succeeds (it runs strict manifest validation) and `pnpm validate` reports `valid`.
- No manual edits under `dist/`, no committed `.fxplug`, no cookie material in the repo.
- If views, settings or entries changed, `manifest.json`, `fluxdown-plugin.config.json` and the entries agree, and validation still passes.
- Behavior-changing resolver/subscription work is checked in FluxDown against a dev-directory install of `dist/` (resolve → second stage → subscription → QR login → panel).
