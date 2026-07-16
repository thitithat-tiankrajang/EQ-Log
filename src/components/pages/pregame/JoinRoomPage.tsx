import { Link, LogIn } from "lucide-react";
import { useState } from "react";
import { PreGameShell } from "./PreGameShell";

export function JoinRoomPage({
  busy,
  error,
  onBack,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onJoin: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <PreGameShell
      eyebrow="Room access"
      title="Join room"
      subtitle="Enter a room code or paste a shared room link."
      onBack={onBack}
    >
      <section className="pregame-card join-card">
        <div className="join-card-icon" aria-hidden="true">
          <Link size={22} />
        </div>
        <label className="pregame-field">
          <span>Room code or shared link</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus
            value={value}
            placeholder="AB12CD34"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim()) onJoin(value);
            }}
          />
        </label>
        {error && <p className="join-error">{error}</p>}
        <button
          className="pregame-primary"
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => onJoin(value)}
        >
          <LogIn size={18} />
          {busy ? "Opening room..." : "Join room"}
        </button>
      </section>
    </PreGameShell>
  );
}
