import { ChevronDown, Clock3, Eye, Grid3X3, Shuffle, Users } from "lucide-react";
import { formatSeconds, getGameMode, getTileDrawMode, type GameState } from "../../../game";

export function RoomConfigCard({ game }: { game: GameState }) {
  const solo = getGameMode(game) === "solo";
  const timerA = game.timers.sideUntimed?.A ? "No timer" : formatSeconds(game.timers.initialSecondsBySide?.A ?? game.timers.A);
  const timerB = game.timers.sideUntimed?.B ? "No timer" : formatSeconds(game.timers.initialSecondsBySide?.B ?? game.timers.B);
  return (
    <details className="pregame-card config-card" open>
      <summary>
        <div>
          <span className="pregame-eyebrow">Configuration</span>
          <h2>Room settings</h2>
        </div>
        <ChevronDown size={18} />
      </summary>
      <div className="config-grid">
        <ConfigItem icon={<Grid3X3 size={17} />} label="Board mode" value={solo ? "Solo board" : "Two-side board"} />
        <ConfigItem
          icon={<Users size={17} />}
          label="Play mode"
          value={getPlayModeLabel(game)}
        />
        <ConfigItem
          icon={<Shuffle size={17} />}
          label="Tile draw"
          value={getTileDrawMode(game) === "play" ? "System draw" : game.emailPlayMode === "hosted" ? "Host picks tiles" : "Manual fill"}
        />
        <ConfigItem
          icon={<Clock3 size={17} />}
          label="Timer"
          value={solo ? timerA : `A ${timerA} / B ${timerB}`}
        />
        {!solo && game.playerEmails && (
          <ConfigItem
            icon={<Eye size={17} />}
            label="Opponent rack"
            value={game.emailPlayersCanSeeOpponentRack ? "Visible on opponent turn" : "Private"}
          />
        )}
        <ConfigItem
          icon={<Users size={17} />}
          label="Starting side"
          value={solo ? "Solo player" : `Side ${game.startingSide ?? "A"}`}
        />
      </div>
    </details>
  );
}

function ConfigItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="config-item">
      <span className="config-item-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function getPlayModeLabel(game: GameState): string {
  if (getGameMode(game) === "solo") return game.playerEmails?.A ? "Hosted solo" : "Play alone";
  if (game.emailPlayMode === "direct") return "Direct email";
  if (game.emailPlayMode === "hosted") return "Email with host";
  return "Hot-seat";
}
