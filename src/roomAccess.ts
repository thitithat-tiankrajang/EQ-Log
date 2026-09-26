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
  /**
   * May swap tiles the app dealt (see `gameplay/drawEdit.ts`). Only a gameplay HOST: the device
   * running a local game, the room owner, or an admin — never anyone in a direct room, which has
   * no host, and never in a game whose tiles come off a real bag.
   */
  canEditDraw: boolean;
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
    return { canAct: false, canInteract: false, canRefill: false, canEditDraw: false };
  }

  if (!remoteEnabled) {
    return {
      canAct: true,
      canInteract: true,
      canRefill: getTileDrawMode(game) === "manual",
      canEditDraw: getTileDrawMode(game) === "play",
    };
  }

  const emailMode: EmailPlayMode | null =
    emailPlayMode !== undefined
      ? emailPlayMode
      : game.playerUserIds?.A ||
          game.playerUserIds?.B ||
          game.playerEmails?.A ||
          game.playerEmails?.B
        ? game.emailPlayMode ?? "hosted"
        : null;
  // A direct email room has no gameplay host. Room ownership and admin status
  // must never grant access to the other player's turn or rack.
  if (isAdmin && emailMode !== "direct") {
    return {
      canAct: true,
      canInteract: true,
      canRefill: getTileDrawMode(game) === "manual",
      canEditDraw: getTileDrawMode(game) === "play",
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

  const canEditDraw = getTileDrawMode(game) === "play" && emailMode !== "direct" && isOwner;

  return { canAct, canInteract, canRefill, canEditDraw };
}
