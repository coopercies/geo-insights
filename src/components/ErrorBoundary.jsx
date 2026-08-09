import { Component } from 'react';

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
          <p>
            The dashboard hit an error it couldn't recover from. Your data is only in
            this page's memory, so reloading starts over — but the details below are
            worth reporting.
          </p>
          <pre>{error.message}</pre>
          <div className="crash-actions">
            <button className="btn-primary" onClick={this.reset}>Try again</button>
            <button onClick={() => window.location.reload()}>Reload the page</button>
          </div>
        </div>
      </div>
    );
  }
}
