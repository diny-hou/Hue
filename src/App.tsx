import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PieMenu } from './components/PieMenu';
import './index.css';

function App() {
  // Prevent default context menu
  React.useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Optional: hide menu on right click
      invoke('hide_menu').catch(console.error);
    };

    // Hide menu when window loses focus (already handled in Rust, but good for redundancy)
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  return (
    <PieMenu />
  );
}

export default App;
