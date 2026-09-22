import neuralArbor from './assets/neural-arbor.svg';

export default function WorkspaceLoader() {
  return (
    <div className="workspace-loader" aria-busy="true">
      <header className="workspace-loader-header">
        <div className="workspace-loader-brand">
          <span className="workspace-loader-brand-title">Open Labs</span>
          <span className="workspace-loader-brand-divider" aria-hidden="true">/</span>
          <span className="workspace-loader-brand-subtitle">Decoded Brain</span>
        </div>
      </header>

      <main className="workspace-loader-body">
        <div className="workspace-loader-visual">
          <img
            src={neuralArbor}
            alt=""
            aria-hidden="true"
            className="workspace-loader-arbor"
          />
        </div>

        <div className="workspace-loader-meta">
          <h1 className="workspace-loader-heading">Linking neurons together...</h1>
          <div className="workspace-loader-status-container">
            <span className="workspace-loader-dot" aria-hidden="true" />
            <p className="workspace-loader-status" role="status">
              Opening your workspace.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
