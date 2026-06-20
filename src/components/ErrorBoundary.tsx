/**
 * ErrorBoundary — last line of defense against a render throw becoming a blank
 * white screen (especially bad in the iOS/Android webview where there's no
 * reload button). Shows a friendly recovery card with a reload action.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { track } from '../utils/analytics';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a console trail for dev/crash reports; no PII is logged.
    console.error('Unhandled UI error:', error, info.componentStack);
    track('runtime_error', {
      surface: 'react_boundary',
      reason_category: 'render_error',
      has_component_stack: Boolean(info.componentStack),
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__msg">
            The game hit an unexpected snag. Reloading usually fixes it — your
            progress is saved to your account.
          </p>
          <button
            type="button"
            className="error-boundary__btn"
            onClick={() => window.location.reload()}
          >
            Reload Elector
          </button>
        </div>
      </div>
    );
  }
}
