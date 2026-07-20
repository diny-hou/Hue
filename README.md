# Hue — Dynamic Marking Menu for Windows

Hue は、Windows 全体で使える **マーキングメニュー（Pie Menu）ランチャー** です。  
グローバルショートカット（デフォルト: `Alt + Space`）でカーソル位置に円形メニューを開き、ドラッグ操作でアプリやフォルダ、スクリプト、URL などを起動できます。

メニューは最大 3 階層（親 8 方向、各方向に子・孫を最大 8 個まで）です。フォルダの内容を自動で取り込む Auto、見た目やジェスチャーのカスタマイズ、トレイ常駐、アプリ内更新にも対応しています。MIT ライセンスで無料です。

- **リポジトリ**: [github.com/diny-hou/Hue](https://github.com/diny-hou/Hue)
- **ダウンロード**: [Releases](https://github.com/diny-hou/Hue/releases/latest) からインストーラ（`*-setup.exe`）を取得

Rust (Tauri v2) + React (TypeScript) で構築した、軽量な常駐アプリです。

## 主な機能

- **マーキングジェスチャー** — ショートカットを押すとメニューを表示。ドラッグで親 → 子 → 孫へ進み、離すと起動。中央に戻すとキャンセル
- **3 階層の円形メニュー** — 親・子・孫の分割数をそれぞれ 1〜8 で設定可能。起動先とサブメニューの両方を持てます
- **起動できるもの** — `.exe`、`.bat`、`.cmd`、`.ps1`、`.lnk`、URL、Windows の設定画面など
- **かんたん登録** — スライスへのドラッグ＆ドロップ、右クリック編集。Auto でフォルダを同期（タグで絞り込み、9 件以上はスパイラル表示）
- **見た目のカスタマイズ** — 色、透明度、リングの大きさ、開くときのアニメ、ホバー効果、軌跡の色などを Preferences で変更
- **トレイ常駐** — システムトレイに常駐。Windows 起動時の自動起動、多重起動防止に対応
- **ワークスペース** — テーマ・メニュー構成などを `.hue`（JSON）で保存／読み込み。中央からミドルドラッグで遠景プリセットを選んで適用
- **アプリ内更新** — Preferences タイトルバーから更新を確認。GitHub Releases の署名付き更新に対応

## インストール

1. [Releases](https://github.com/diny-hou/Hue/releases/latest) から `Hue_*_x64-setup.exe` をダウンロードしてインストールします
2. `Alt + Space` でメニューを表示します
3. 以降の更新は、Preferences → Advanced → **Check for updates** から確認できます

初回だけインストーラが必要です。2 回目以降はアプリ内更新で対応できます。

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
