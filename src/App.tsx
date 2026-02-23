import { useEffect } from 'react';
import { PieMenu } from './components/PieMenu';
import './index.css';

function App() {
  // Prevent default context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
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
