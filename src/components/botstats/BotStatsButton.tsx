import { useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
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
      <button
        className="eq-utility-button eq-utility-botstats"
        type="button"
        aria-label="Open bot statistics"
        onClick={() => setOpen(true)}
      >
        <span className="eq-utility-icon">
          <ChartNoAxesCombined size={16} />
        </span>
        <span className="eq-utility-label">Bot stats</span>
      </button>
      {open && <BotStatsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
