import { useState } from "react";
import { FolderKanban } from "lucide-react";
import { useAuth } from "../../auth";
import { BotStatsPanel } from "./BotStatsPanel";

// Lobby header button for admins; opens the bot-stat folders panel. Mirrors the
// AdminButton gating so it only appears for admin accounts.
export function BotStatsButton() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);

  if (!profile?.is_admin) return null;

  return (
    <>
      <button className="icon-button admin-open" type="button" onClick={() => setOpen(true)}>
        <FolderKanban size={16} />
        <span className="admin-open-label">Bot stats</span>
      </button>
      {open && <BotStatsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
