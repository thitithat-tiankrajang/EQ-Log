import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useRoute } from "../router";

const NonPlayApplication = lazy(() => import("./NonPlayApplication"));
const LegacyPlayApplication = lazy(() => import("../App"));

export function AppRoot() {
  const route = useRoute();
  const Application = route.kind === "play" ? LegacyPlayApplication : NonPlayApplication;

  useEffect(() => {
    document.body.dataset.route = route.kind;
    if (route.kind === "play") document.title = "Game · EQ Lab";
  }, [route.kind]);

  return (
    <ApplicationErrorBoundary>
      <Suspense fallback={<AppBootFallback />}>
        <Application />
      </Suspense>
    </ApplicationErrorBoundary>
  );
}

class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.dispatchEvent(
      new CustomEvent("eq-lab:error", {
        detail: { message: error.message, stack: info.componentStack },
      }),
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="eq-auth-shell">
        <section className="eq-auth-card" role="alert">
          <span className="eq-eyebrow">EQ Lab</span>
          <h1>Something went wrong</h1>
          <p className="eq-auth-sub">
            Your saved rooms are still safe. Reload the app to try again.
          </p>
          <button
            className="eq-button eq-button-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </section>
      </main>
    );
  }
}

function AppBootFallback() {
  return (
    <main className="eq-auth-shell">
      <div className="eq-auth-splash" role="status">
        Opening EQ Lab…
      </div>
    </main>
  );
}
