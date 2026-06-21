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
  if (foreground) {
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
  if (!syncing) return null;
  return (
    <div className="network-activity" role="status" aria-live="polite">
      <strong>Saving changes...</strong>
      <LoadingTrack />
    </div>
  );
}

function LoadingTrack() {
  return (
    <span className="loading-track" aria-hidden="true">
      <span />
    </span>
  );
}

