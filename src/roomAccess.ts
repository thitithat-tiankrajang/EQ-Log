import {
  getTileDrawMode,
  type EmailPlayMode,
  type GameState,
  type Side,
} from "./game";

export type RoomActorCapabilities = {
  canAct: boolean;
  canInteract: boolean;
  canRefill: boolean;
};

export function getRoomActorCapabilities({
  game,
  emailPlayMode,
  invitedSides,
  isAdmin,
  isOwner,
  remoteEnabled,
}: {
  game: GameState | null;
  emailPlayMode?: EmailPlayMode | null;
  invitedSides: Side[];
  isAdmin: boolean;
  isOwner: boolean;
  remoteEnabled: boolean;
}): RoomActorCapabilities {
  if (!game || game.status !== "playing") {
    return { canAct: false, canInteract: false, canRefill: false };
  }

  if (!remoteEnabled) {
    return {
      canAct: true,
      canInteract: true,
      canRefill: getTileDrawMode(game) === "manual",
    };
  }

  const emailMode: EmailPlayMode | null =
    emailPlayMode !== undefined
      ? emailPlayMode
      : game.playerEmails?.A || game.playerEmails?.B
        ? game.emailPlayMode ?? "hosted"
        : null;
  // A direct email room has no gameplay host. Room ownership and admin status
  // must never grant access to the other player's turn or rack.
  if (isAdmin && emailMode !== "direct") {
    return {
      canAct: true,
      canInteract: true,
      canRefill: getTileDrawMode(game) === "manual",
    };
  }
  const assignedToActiveSide = invitedSides.includes(game.activeSide);
  const canAct = emailMode ? assignedToActiveSide : isOwner;
  const canRefill =
    getTileDrawMode(game) === "manual" &&
    (emailMode === "hosted"
      ? isOwner
      : emailMode === "direct"
        ? assignedToActiveSide
        : isOwner);
  const refillPhase = game.phase === "refill";
  const canInteract = refillPhase
    ? getTileDrawMode(game) === "play"
      ? canAct
      : canRefill
    : canAct;

  return { canAct, canInteract, canRefill };
}
