# Hue — Dynamic Marking Menu for Windows

Hue は、Windows 向けの **マーキングメニュー（Pie Menu）ランチャー** です。  
グローバルショートカット（既定: `Alt + Space`）でカーソル位置に円形メニューを開き、ドラッグジェスチャーでアプリ・スクリプト・フォルダ・URL を起動します。  
親 8 スライス＋子・孫（各最大 8）の 3 階層、Auto フォルダ同期、見た目／ジェスチャーの細かいカスタム、トレイ常駐とアプリ内更新に対応。MIT・無料。

- **リポジトリ**: [github.com/diny-hou/Hue](https://github.com/diny-hou/Hue)
- **ダウンロード**: [Releases](https://github.com/diny-hou/Hue/releases/latest) からインストーラ（`*-setup.exe`）を取得

Rust (Tauri v2) + React (TypeScript)。軽量・常駐型。

## 主な機能

- **マーキングジェスチャー** — 押下で表示、ドラッグで親→子→孫へ渡り、離して起動（中央でキャンセル）
- **3 階層ラジアルメニュー** — メイン 8 スライス、各グループに最大 8 子・8 孫（ハイブリッド配置可）
- **起動ターゲット** — `.exe` / `.bat` / `.cmd` / `.ps1` / `.lnk` / URL / 設定 URI など
- **登録まわり** — スライスへ DnD、右クリック編集、Auto（フォルダ同期・タグ絞り込み・8 超はスパイラル）
- **カスタム UI** — 色・透明度・リングサイズ・開閉／ホバーアニメ・軌跡色など Preferences で調整
- **常駐** — システムトレイ、起動時自動実行、シングルインスタンス
- **アプリ内更新** — GitHub Releases からの署名付き更新（プログレス表示→再起動）

## インストール（ユーザー）

1. [Releases](https://github.com/diny-hou/Hue/releases/latest) から `Hue_*_x64-setup.exe` をダウンロードしてインストール
2. `Alt + Space` でメニューを表示
3. 以降、新しい **product** 版は Preferences → Advanced → **Check for updates** から更新できます

初回のみインストーラが必要です。2 回目以降はアプリ内更新で足ります。

## 開発

### 必要環境

- Node.js 20+
- Rust (stable)
- Windows（ビルドターゲット）

### ローカル起動

```bash
npm install
npm run tauri dev
```

Windows では `scripts/start_hue.bat` でも起動できます。

### ビルド

```bash
npm run tauri build
```

成果物: `src-tauri/target/release/bundle/nsis/`

署名なしのローカル exe のみ: `npm run build:exe`

## リリース運用（product / daybuild）

| ブランチ | 用途 | CI | ユーザーへの影響 |
|----------|------|-----|------------------|
| `main` | **product（本番）** | タグ `v*` を push → [release.yml](.github/workflows/release.yml) | `/releases/latest` + 自動更新 |
| `daybuild` | **開発・日次ビルド** | push → [daybuild.yml](.github/workflows/daybuild.yml) | **prerelease** のみ（本番更新チャネルには載らない） |

### product を出す手順

1. `main` で `package.json` / `tauri.conf.json` / `Cargo.toml` の version を揃える
2. コミットを push
3. `main` からタグを打つ: `git tag v0.1.1 && git push origin v0.1.1`
4. GitHub Actions が signed installer + `update.json` を Release にアップロード

### daybuild を出す手順

1. `daybuild` ブランチに push（または `workflow_dispatch`）
2. prerelease として `daybuild-YYYYMMDD-<sha>` タグの Release が作成される

詳細: [docs/UPDATER.md](docs/UPDATER.md)

## 公開前チェックリスト

- [ ] GitHub remote が `diny-hou/Hue`
- [ ] リポ Secrets: `TAURI_SIGNING_PRIVATE_KEY`（必要なら `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）
- [ ] `tauri.conf.json` の updater endpoint が `diny-hou/Hue`
- [ ] タグの version と manifest の version が一致

## 技術スタック

- **Backend**: Rust, Tauri v2
- **Frontend**: React, TypeScript, Vite
- **Plugins**: global-shortcut, autostart, dialog, updater, process

## ライセンス

[MIT](LICENSE) — 無料で利用・改変・再配布できます。
