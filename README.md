# Hue — Dynamic Marking Menu for Windows

Hue は、Windows 全体で使える **マーキングメニュー（Pie Menu）ランチャー** です。  
グローバルショートカット（デフォルト: `Alt + Space`）で円形メニューを開き、ジェスチャーでアプリ・フォルダ・スクリプトを起動できます。

- **リポジトリ**: [github.com/diny-hou/Hue](https://github.com/diny-hou/Hue)
- **ダウンロード**: [Releases](https://github.com/diny-hou/Hue/releases/latest) からインストーラ（`*-setup.exe`）を取得

Rust (Tauri v2) + React (TypeScript) で構築。軽量・常駐型。

## 主な機能

- **ジェスチャーランチャー** — 8 方向メインメニュー + 各スライスに最大 8 個のサブアイテム
- **グラスモーフィズム UI** — 色・透明度・ホバーアニメーション等を Preferences から変更
- **ドラッグ＆ドロップ登録** — `.exe` やショートカットをスライスへ DnD で登録
- **スクリプト起動** — `.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, URL 等
- **自動起動** — システムトレイ常駐、起動時自動実行に対応
- **アプリ内更新** — 起動時に新バージョンを確認し、ユーザーが選べばその場で更新（再インストール不要）

## インストール（ユーザー）

1. [Releases](https://github.com/diny-hou/Hue/releases/latest) から `Hue_*_x64-setup.exe` をダウンロードしてインストール
2. `Alt + Space` でメニューを表示
3. 以降、新しい **product** 版が出ると起動時に更新ダイアログが表示されます（Later / Install and restart）

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

（未定 — 公開時に LICENSE を追加してください）
