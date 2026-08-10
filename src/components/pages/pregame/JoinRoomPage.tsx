import { ClipboardPaste, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { FieldRow } from "../../ui/FieldRow";
import { ActionDock } from "../../ui/ActionDock";
import { PreGameShell } from "./PreGameShell";
import type { RoomVisibility } from "../../../roomScope";

export function JoinRoomPage({
  busy,
  error,
  visibility,
  regionName,
  initialCode,
  onBack,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  visibility: RoomVisibility;
  regionName: string | null;
  initialCode?: string;
  onBack: () => void;
  onJoin: (value: string) => void;
}) {
  const [value, setValue] = useState(initialCode ?? "");
  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

  useEffect(() => {
    if (initialCode) setValue(initialCode);
  }, [initialCode]);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setValue(text.trim());
    } catch {
      // Clipboard permission denied — typing still works.
    }
  }

  return (
    <PreGameShell
      eyebrow={visibility === "public" ? "Public" : (regionName ?? "Region")}
      title="Join with a code"
      subtitle={
        visibility === "public"
          ? "Enter a code for a public room."
          : `Enter a code for a room inside ${regionName ?? "your region"}.`
      }
      onBack={onBack}
      visibility={visibility}
      regionName={regionName}
      variant="join"
      visual="glass"
    >
      <section className="pregame-card join-card">
        <FieldRow
          controlId="join-room-code"
          label="Room code or link"
          error={error ? "Room not found — check the code with the person who shared it." : null}
        >
          <div className="join-input-row">
            <input
              id="join-room-code"
              aria-describedby={error ? "join-room-code-message" : undefined}
              className="join-code-input"
              autoCapitalize="characters"
              autoComplete="off"
              value={value}
              placeholder="AB12CD34EF56"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && value.trim()) onJoin(value);
              }}
            />
            {canPaste && (
              <button
                type="button"
                className="join-paste-button"
                onClick={() => void pasteFromClipboard()}
              >
                <ClipboardPaste size={16} />
                Paste
              </button>
            )}
          </div>
        </FieldRow>
      </section>

      <ActionDock>
        <button
          className="ui-button-primary"
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => onJoin(value)}
        >
          <LogIn size={17} />
          {busy ? "Opening room…" : "Join room"}
        </button>
      </ActionDock>
    </PreGameShell>
  );
}
