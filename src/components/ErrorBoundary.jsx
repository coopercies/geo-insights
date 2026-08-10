import { Component } from 'react';
import { clearSession } from '../lib/session.js';

/**
 * A thrown render error unmounts the whole React tree, which looks to the user
 * like the site went blank. Catch it and say what happened instead.
 *
 * Note this cannot catch an out-of-memory tab kill — the process is gone before
 * any JS runs. That case is prevented in ingest.js by refusing oversized files.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[geo-insights] render error:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="crash">
        <div className="crash-card">
          <h2>Something broke while rendering</h2>
          <p>The dashboard hit an error it couldn't recover from.</p>
          <pre>{error.message}</pre>
          <p>
            Your dashboard is saved as you work, so reloading brings it back. If the
            same error returns immediately, the saved dashboard is what triggers it —
            start fresh to discard it.
          </p>
          <div className="crash-actions">
            <button className="btn-primary" onClick={this.reset}>Try again</button>
            <button onClick={() => window.location.reload()}>Reload the page</button>
            <button onClick={async () => { await clearSession(); window.location.reload(); }}>
              Start fresh
            </button>
          </div>
        </div>
      </div>
    );
  }
}
