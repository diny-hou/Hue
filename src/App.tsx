import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PieMenu } from './components/PieMenu';
import { StandalonePreferences } from './components/Preferences';
import './index.css';

function App() {
  const [route, setRoute] = useState<'main' | 'preferences' | 'loading'>('loading');

  useEffect(() => {
    try {
      const label = getCurrentWindow().label;
      console.log("Window Label detected as:", label);
      if (label === 'preferences') {
        setRoute('preferences');
      } else {
        setRoute('main');
      }
    } catch (e) {
      console.error("Failed to get window label", e);
      // Fallback to URL in case Tauri API fails
      if (window.location.href.includes('preferences')) {
        setRoute('preferences');
      } else {
        setRoute('main');
      }
    }
  }, []);

  // Prevent default context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  if (route === 'loading') {
    return <div style={{ width: '100vw', height: '100vh', background: 'rgba(20, 20, 20, 0.9)', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>Initializing route...</div>;
  }

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
