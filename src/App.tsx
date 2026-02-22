import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PieMenu } from './components/PieMenu';
import { SliceEditorApp } from './components/SliceEditorApp';
import './index.css';

function App() {
  const [isEditor, setIsEditor] = useState<boolean | null>(null);

  useEffect(() => {
    setIsEditor(getCurrentWebviewWindow().label === 'editor');
  }, []);
  // Prevent default context menu
  useEffect(() => {
    if (isEditor) return; // Only attach listener if not editor
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Optional: hide menu on right click
      invoke('hide_menu').catch(console.error);
    };

    // Hide menu when window loses focus (already handled in Rust, but good for redundancy)
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [isEditor]); // Re-run effect if isEditor changes

  if (isEditor === null) return null; // Wait until isEditor is determined

  if (isEditor) {
    return <SliceEditorApp />;
  }

  return (
    <PieMenu />
  );
}

export default App;
