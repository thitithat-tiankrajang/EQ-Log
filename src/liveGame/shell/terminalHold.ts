/**
 * Completion deletes a game's live row, so after the final commit any read
 * fails and the play route would swap the Result for the archive Replay. Games
 * whose Result is on screen are held here; the route leaves them alone until
 * the player leaves the Result or asks for the Replay.
 *
 * Kept free of other imports: the play route loads it eagerly.
 */
export const heldTerminals = new Set<string>();

/**
 * Games whose live screen is mounted with a loaded game. Such a screen turns a
 * completion it did not receive into its own Result (see completion.ts), so
 * the route must not swap it for the Replay underneath the player.
 */
export const activeLiveScreens = new Set<string>();

/** Dispatched with the game ID when the player opens the Replay from a Result. */
export const OPEN_ARCHIVE_REPLAY = "eq-lab:open-archive-replay";
