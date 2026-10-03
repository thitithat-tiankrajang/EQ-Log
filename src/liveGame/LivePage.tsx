import { navigate, useRoute } from "../router";
import { liveGameClient } from "./client";
import { LiveGameScreen } from "./shell/LiveGameScreen";
import { OPEN_ARCHIVE_REPLAY } from "./shell/terminalHold";

/** This online page never imports or decodes a complete live GameState. */
export default function LivePage({ roomId }: { roomId: string }) {
  const route = useRoute();
  return (
    <LiveGameScreen
      matchId={roomId}
      client={liveGameClient}
      ranked={false}
      onOpenReplay={() =>
        route.kind === "play"
          ? window.dispatchEvent(new CustomEvent(OPEN_ARCHIVE_REPLAY, { detail: roomId }))
          : navigate({ kind: "play", roomId })
      }
    />
  );
}
