import { useEffect, useRef, useState } from 'react';
import { startConnectingIdeas } from './connectingIdeas';
import { readDarkTheme } from './theme';
import decodedBrainLogo from './assets/decoded-brain-logo.svg';

export default function WorkspaceLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dark] = useState(readDarkTheme);

  useEffect(() => {
    if (!canvasRef.current) return;
    return startConnectingIdeas(canvasRef.current, dark);
  }, [dark]);

  return (
    <div className={`workspace-loader ${dark ? 'workspace-loader--dark' : 'workspace-loader--light'}`}>
      <canvas ref={canvasRef} className="workspace-loader-canvas" aria-hidden="true" />
      <header className="workspace-loader-header">
        <img src={decodedBrainLogo} alt="" aria-hidden="true" className="workspace-loader-logo" />
        <strong className="workspace-loader-brand-title">OPEN LABS</strong>
        <span className="workspace-loader-brand-subtitle">DECODED BRAIN</span>
      </header>
      <div className="workspace-loader-status" role="status" aria-live="polite">
        <h1 className="workspace-loader-heading">Linking neurons together...</h1>
        <p className="workspace-loader-subheading">Opening your workspace.</p>
        <div className="workspace-loader-track" aria-hidden="true" />
      </div>
    </div>
  );
}
