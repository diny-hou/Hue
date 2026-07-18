import { useEffect, useLayoutEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PieMenu } from './components/PieMenu';
import { StandalonePreferences } from './components/Preferences';
import './index.css';

function App() {
  const [route] = useState<'main' | 'preferences'>(() => {
    try {
      const label = getCurrentWindow().label;
      return label === 'preferences' ? 'preferences' : 'main';
    } catch (e) {
      console.error("Failed to get window label", e);
      return window.location.href.includes('preferences') ? 'preferences' : 'main';
    }
  });

  // Prevent default context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // Preferences runs in its own webview: solid background + non-pass-through root (main stays transparent)
  useLayoutEffect(() => {
    if (route !== 'preferences') return;
    document.documentElement.classList.add('hue-preferences-window');
    return () => document.documentElement.classList.remove('hue-preferences-window');
  }, [route]);


  if (route === 'preferences') {
    return (
      <div className="preferences-app-root">
        <StandalonePreferences />
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', pointerEvents: 'none' }}>
      <PieMenu />
    </div>
  );
}

export default App;
