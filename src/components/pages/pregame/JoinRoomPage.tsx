import { ClipboardPaste, LogIn } from "lucide-react";
import { useState } from "react";
import { FieldRow } from "../../ui/FieldRow";
import { ActionDock } from "../../ui/ActionDock";
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
  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

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
      eyebrow="Join"
      title="Join with a code"
      subtitle="Codes and links come from the person who created the room."
      onBack={onBack}
      visual="glass"
    >
      <section className="pregame-card join-card">
        <FieldRow
          label="Room code or link"
          error={
            error
              ? "Room not found — check the code with the person who shared it."
              : null
          }
        >
          <div className="join-input-row">
            <input
              className="join-code-input"
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
