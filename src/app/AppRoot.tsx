import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useRoute } from "../router";
import { supabase } from "../supabaseClient";
import type { SafeArchiveReplay } from "../completedGame/archiveRead";

const NonPlayApplication = lazy(() => import("./NonPlayApplication"));
const LegacyPlayApplication = lazy(() => import("../App"));
const ArchiveReplayPage = lazy(() => import("../components/pages/ArchiveReplayPage"));

function PlayApplication() {
  const route = useRoute();
  const roomId = route.kind === "play" ? route.roomId : "";
  const [room, setRoom] = useState<{
    id: string;
    live: boolean;
    replay?: SafeArchiveReplay;
  } | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const onArchiveReady = (event: Event) => {
      const replay = (event as CustomEvent<SafeArchiveReplay>).detail;
      if (active && replay?.archive.gameId === roomId) setRoom({ id: roomId, live: false, replay });
    };
    window.addEventListener("eq-lab:archive-replay-ready", onArchiveReady);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("room_live")
          .select("room_id")
          .eq("room_id", roomId)
          .maybeSingle();
        if (active)
          setRoom((current) =>
            current?.id === roomId && current.replay
              ? current
              : { id: roomId, live: !error && Boolean(data) },
          );
      } catch {
        if (active) setRoom({ id: roomId, live: false });
      }
    })();
    return () => {
      active = false;
      window.removeEventListener("eq-lab:archive-replay-ready", onArchiveReady);
    };
  }, [roomId]);
  if (!supabase) return <LegacyPlayApplication />;
  if (!room || room.id !== roomId) return <AppBootFallback />;
  return room.live ? <LegacyPlayApplication /> : <ArchiveReplayPage initialReplay={room.replay} />;
}

export function AppRoot() {
  const route = useRoute();
  const Application = route.kind === "play" ? PlayApplication : NonPlayApplication;

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
