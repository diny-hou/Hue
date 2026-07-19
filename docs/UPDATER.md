# Hue — Auto-updater (Tauri v2)

Production updates are served from **[diny-hou/Hue](https://github.com/diny-hou/Hue)**:

```text
https://github.com/diny-hou/Hue/releases/latest/download/update.json
```

Installed apps call this URL on startup (production builds only). **Daybuild** prereleases do not replace `latest`.

## Branches and CI

| Branch | Workflow | Release type | Auto-update |
|--------|----------|--------------|-------------|
| `main` + tag `v*` | [release.yml](../.github/workflows/release.yml) | Stable | Yes |
| `daybuild` | [daybuild.yml](../.github/workflows/daybuild.yml) | Prerelease | No |

**Rule:** Tag `v*` only from `main` after bumping version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

## Directory layout

| Path | Purpose |
|------|---------|
| [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) | `bundle.createUpdaterArtifacts`, `plugins.updater.pubkey`, `plugins.updater.endpoints` |
| [`src-tauri/tauri.updater-local.json`](../src-tauri/tauri.updater-local.json) | Merge config for **local HTTP** testing |
| [`src-tauri/capabilities/updater.json`](../src-tauri/capabilities/updater.json) | `updater:default` + `process:default` on **`main`** window only |
| [`src-tauri/.keys/`](../src-tauri/.keys/) | **Gitignored** — signing keys (never commit) |
| [`src/components/UpdateDialog.tsx`](../src/components/UpdateDialog.tsx) | Download progress modal (Preferences, production builds only) |

## 1. Generate signing keys

From the repo root:

```bash
set CI=true
npm run tauri signer generate -w src-tauri/.keys/hue.key -f
```

- **Private key**: `src-tauri/.keys/hue.key` — store in GitHub Actions **Secrets** for CI.
- **Public key**: paste the **entire** `.pub` file into `plugins.updater.pubkey` in `tauri.conf.json`.

Build-time env vars (not read from `.env` by Tauri CLI):

| Variable | Meaning |
|----------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Private key string or path |
| `TAURI_SIGNING_PRIVATE_KEY_PATH` | Path to private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password, if any |

Local signed build — `tauri build` reads **`TAURI_SIGNING_PRIVATE_KEY`** (file path or key string).  
`TAURI_SIGNING_PRIVATE_KEY_PATH` is only for `tauri signer sign`, not for `tauri build`.

```bat
REM easiest (cmd):
scripts\build-local-updater.bat

REM or manually:
set TAURI_SIGNING_PRIVATE_KEY=%CD%\src-tauri\.keys\hue.key
npm run tauri -- build --config src-tauri/tauri.updater-local.json
```

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$PWD\src-tauri\.keys\hue.key"
npm run tauri -- build --config src-tauri/tauri.updater-local.json
```

## 2. GitHub Secrets (diny-hou/Hue)

Repository → Settings → Secrets and variables → Actions:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

## 3. Ship a product release (recommended)

One command from the repo root (bump patch → incremental build → sign → GitHub Release):

```bat
npm run release
npm run release -- 1.2.5
```

Requires `src-tauri/.keys/hue.key` (password `hue`) and `gh` auth.

This is **much faster on the 2nd+ run** because Cargo stays incremental — do **not** `cargo clean` unless you must.

Tauri’s updater still downloads the full installer (not a binary diff). The win is release automation + incremental compile, not delta patches.

### Manual / CI alternative

```bash
# on main, versions aligned
git tag v0.1.1
git push origin v0.1.1
```

CI uploads `Hue_*_x64-setup.exe`, `.sig`, and `update.json` when signing secrets match the app pubkey.

## 4. Daybuild (preview only)

```bash
git checkout daybuild
git merge main   # or commit directly
git push origin daybuild
```

Creates a **prerelease** tagged `daybuild-YYYYMMDD-<sha>`. Does not change `latest` or the production updater manifest.

## 5. Local updater testing

Single menu (`npm run update`):

| # | Action |
|---|--------|
| 1 | Product build → `dist-update/product/` (port 8080) |
| 2 | Daily build → `dist-update/daily/` (port 8081) |
| 3 | Update installed app (product) |
| 4 | Update installed app (daily) |

```bat
npm run update
npm run update -- 1
npm run update -- 4
```

Daily builds auto-version as `{package.json version}-daily.{YYYYMMDD}.{n}`.

Installed app must use the **same channel** as the update (product ↔ product, daily ↔ daily).

## 6. Frontend behavior

- Preferences → **Advanced** → **Check for updates** runs `check()` only when `import.meta.env.PROD` is true.
- If an update exists: progress modal → `downloadAndInstall` → automatic `relaunch()`.
- If already current: inline “You are on the latest version.”

## Checklist before first public release

- [ ] Remote: `https://github.com/diny-hou/Hue.git`
- [ ] Secrets configured on diny-hou/Hue
- [ ] Endpoint in `tauri.conf.json` points to diny-hou/Hue
- [ ] Version aligned across manifest files
- [ ] First install via Releases setup.exe; updates via in-app prompt thereafter
