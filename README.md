# Hue - Marking Menu Launcher

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19.0-blue.svg)](https://reactjs.org/)

Hue は、マウスの移動だけで全てを完結させるための放射状（Pie Menu）アプリケーションランチャーです。

## Features

- **Global Hotkey Interaction**: Summon with one key, select with mouse, release to launch.
- **Dynamic Slices**: Configure up to 8 slots for your favorite tools and folders.
- **Auto-Fill from Selection**: Select multiple files to populate your group slices instantly.
- **Modern UI/UX**: Customizable glassmorphism, HSL themes, and smooth micro-animations.
- **Background Mode**: Stays in the System Tray and supports Auto-Start on Windows.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Structure

- `src/`: React source code (UI & Interactivity)
- `src-tauri/`: Rust source code (Backend, Windowing, OS APIs)
- `src/components/PieMenu.tsx`: Core radial menu logic
- `src/components/SliceEditor.tsx`: Configuration and reordering UI

---
Developed as a high-performance productivity tool for Windows.
