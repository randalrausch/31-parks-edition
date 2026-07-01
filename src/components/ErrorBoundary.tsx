/**
 * Top-level error boundary. A render-time crash anywhere in the tree would
 * otherwise leave a blank page with no explanation; instead we show a clear,
 * self-contained recovery screen (no theme/CSS-var dependency, since the theme
 * provider may be the thing that's unmounted) and log the error for diagnosis.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { elog } from "../game/debug";
import { activeBackend } from "../game/backend";
import "./ErrorBoundary.css";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    elog("ui", "render crashed", error);
    if (info?.componentStack) console.error(info.componentStack);
    // Best-effort off-device report so a production crash isn't invisible. Only
    // when an online backend is configured; solo/pass-and-play stays local.
    try {
      activeBackend?.reportError?.({
        message: error.message,
        stack: error.stack,
        url: typeof location !== "undefined" ? location.href : undefined,
        context: "render-boundary",
      });
    } catch {
      /* the reporter must never worsen the crash */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="errbound">
        <div className="errbound__panel">
          <h1 className="errbound__title">Something went wrong</h1>
          <p className="errbound__msg">
            The game hit an unexpected error. Reloading usually fixes it — your saved games are
            unaffected.
          </p>
          <p className="errbound__detail">{this.state.error.message}</p>
          <button className="errbound__btn" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
