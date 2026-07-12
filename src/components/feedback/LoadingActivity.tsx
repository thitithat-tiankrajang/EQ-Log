import { useEffect, useState } from "react";

export function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="loading-screen" aria-busy="true">
      <div className="loading-panel" role="status" aria-live="polite">
        <span className="loading-kicker">Equation Board</span>
        <strong>{message}</strong>
        <LoadingTrack />
      </div>
    </main>
  );
}

export function GlobalActivity({
  error,
  foreground,
  syncing,
}: {
  error?: string | null;
  foreground: string | null;
  syncing: boolean;
}) {
  // Fast background writes are the normal case. Showing a toast for every
  // tap makes the interface flash and feel slower than it is, so routine
  // activity stays silent and only genuinely slow work becomes visible.
  const foregroundVisible = useDelayedVisibility(Boolean(foreground), 220);
  const syncingVisible = useDelayedVisibility(syncing, 1_000);

  if (foreground) {
    if (!foregroundVisible) return null;
    return (
      <div className="loading-overlay" aria-busy="true">
        <div className="loading-panel" role="status" aria-live="polite">
          <span className="loading-kicker">Please wait</span>
          <strong>{foreground}</strong>
          <LoadingTrack />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="network-activity error" role="alert">
        <strong>Sync failed</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!syncing || !syncingVisible) return null;
  return (
    <div className="network-activity" role="status" aria-live="polite">
      <strong>Saving changes...</strong>
      <LoadingTrack />
    </div>
  );
}

function useDelayedVisibility(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timerId = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timerId);
  }, [active, delayMs]);

  return active && visible;
}

function LoadingTrack() {
  return (
    <span className="loading-track" aria-hidden="true">
      <span />
    </span>
  );
}
