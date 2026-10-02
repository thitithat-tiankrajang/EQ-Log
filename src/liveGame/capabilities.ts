import type { GameState, Side } from "../game";

export type LocalTurnClaim = { token: string; side: Side; revision: number };
export type LiveAuthorityFacts = {
  ownerId: string;
  seats: Partial<Record<Side, string>>;
  mode: string;
  purpose: string;
  authorityProtocol: string;
  revision: number;
  localClaim?: LocalTurnClaim;
};
export type LiveCapabilities = {
  side: Side | null;
  physicalHost: boolean;
  localController: boolean;
  localHandoff: boolean;
  localConfirmed: boolean;
  administer: boolean;
  configure: boolean;
  editHistory: boolean;
};

/** Only stored facts and an authenticated actor enter this module. Roles add;
 * being seated never subtracts a Physical Host's current-rack permission. */
export function resolveLiveCapabilities(
  facts: LiveAuthorityFacts,
  game: GameState,
  actorId: string,
  handoffToken?: unknown,
  trustedBot = false,
): LiveCapabilities {
  const secure = facts.authorityProtocol === "server-v1";
  const owner = facts.ownerId === actorId && !trustedBot;
  const normal = facts.purpose !== "stage" && !game.botSide;
  const localHandoff = facts.mode === "local_versus" && normal && secure;
  const localController = localHandoff && owner;
  const localConfirmed = Boolean(
    localController &&
    facts.localClaim &&
    facts.localClaim.token === handoffToken &&
    facts.localClaim.revision === facts.revision &&
    facts.localClaim.side === game.activeSide,
  );
  const physicalHost = Boolean(
    secure && owner && normal && game.emailPlayMode === "hosted" && game.tileDrawMode === "manual",
  );
  // Undo/redo/continue restore stored positions, including the ordered bag, so a
  // replay repeats the same draws. Offer history editing only where that cannot
  // expose another party's hidden tiles or future draws: one-device Local/Solo,
  // Physical Hosted manual draws, the ArchBot practice exception, and bot games
  // whose history never held a bag (Stage endgames: every tile is public by count).
  const archBotPractice =
    facts.purpose === "normal" && facts.mode === "stage5b_standard" && game.botEngine === "stage5b";
  const bagless =
    game.tilebag.length === 0 && game.history.every((snapshot) => snapshot.tilebag.length === 0);
  const replaySafe = game.botSide
    ? archBotPractice || bagless
    : game.emailPlayMode === undefined ||
      (game.emailPlayMode === "hosted" && game.tileDrawMode === "manual");
  const side: Side | null = trustedBot
    ? facts.ownerId === actorId
      ? (game.botSide ?? null)
      : null
    : localHandoff
      ? localController && game.roomStage === "waiting"
        ? "A"
        : localConfirmed
          ? game.activeSide
          : null
      : facts.seats.A === actorId
        ? "A"
        : facts.seats.B === actorId
          ? "B"
          : null;
  return {
    side,
    physicalHost,
    localController,
    localHandoff,
    localConfirmed,
    administer: Boolean(
      secure &&
      owner &&
      normal &&
      (game.emailPlayMode === "hosted" || game.gameMode === "solo" || localController),
    ),
    configure: Boolean(secure && owner && game.roomStage === "waiting"),
    editHistory: Boolean(secure && owner && replaySafe),
  };
}
