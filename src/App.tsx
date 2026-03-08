import { useEffect, useState } from 'react';
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


  if (route === 'preferences') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <StandalonePreferences />
      </div>
    );
  }

  return (
    <PieMenu />
  );
}

export default App;
