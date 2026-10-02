import { RankedMatchPage } from "../components/pages/ranked/RankedMatchPage";
import { liveGameClient } from "./client";

/** This online page never imports or decodes a complete live GameState. */
export default function LivePage({ roomId }: { roomId: string }) {
  return (
    <RankedMatchPage matchId={roomId} client={liveGameClient} title="Live game" ranked={false} />
  );
}
