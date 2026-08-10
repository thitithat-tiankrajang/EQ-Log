import { describe, expect, it } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { RACK_SIZE } from "../src/constants/gameRules";
import {
  createInitialTilebag,
  createNewGame,
  deepClone,
  type GameState,
  type TileInstance,
} from "../src/game";
import {
  CODEC_VERSION,
  LEGACY_TOKEN_TABLE,
  decodeGame,
  deserializeGame,
  encodeGame,
  serializeGame,
} from "../src/codec";
import { InventoryError } from "../src/domain/inventory";
import { TILE_COUNT, TILE_IDS, ordinalOfTileId } from "../src/domain/tiles";
import { inventoryFrom } from "../src/domain/projection";

function playGame(overrides: Partial<Parameters<typeof createNewGame>[0]> = {}): GameState {
  return createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play", ...overrides });
}

function allTiles(game: GameState): TileInstance[] {
  return [
    ...game.tilebag,
    ...game.rackA,
    ...game.rackB,
    ...(game.pendingExchangeReturnBySide?.A ?? []),
    ...(game.pendingExchangeReturnBySide?.B ?? []),
    ...game.board.flat().flatMap((cell) => (cell ? [cell.tile] : [])),
  ];
}

function identityMap(game: GameState): Map<string, string> {
  const map = new Map<string, string>();
  const record = (tile: TileInstance, where: string) => map.set(tile.id, where);
  game.tilebag.forEach((tile, index) => record(tile, `bag:${index}`));
  game.rackA.forEach((tile, index) => record(tile, `rackA:${index}`));
  game.rackB.forEach((tile, index) => record(tile, `rackB:${index}`));
  game.board.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell) record(cell.tile, `board:${r}:${c}`);
    }),
  );
  return map;
}

describe("a new game starts from the physical set", () => {
  it("deals exactly the 100 manifest tiles", () => {
    const bag = createInitialTilebag();
    expect(bag).toHaveLength(TILE_COUNT);
    expect(bag.map((tile) => tile.id).sort()).toEqual([...TILE_IDS].sort());
  });

  it("still accounts for all 100 after dealing both racks", () => {
    const game = playGame();
    expect(allTiles(game)).toHaveLength(TILE_COUNT);
    expect(game.rackA).toHaveLength(RACK_SIZE);
    expect(game.rackB).toHaveLength(RACK_SIZE);
    expect(() => inventoryFrom(game)).not.toThrow();
  });
});

describe("encoding preserves physical identity", () => {
  it("round-trips every tile to the same physical tile in the same place", () => {
    const game = playGame();
    const before = identityMap(game);
    const after = identityMap(decodeGame(encodeGame(game)));
    expect(after).toEqual(before);
  });

  it("round-trips repeatedly without identity drifting", () => {
    let game = playGame();
    const original = identityMap(game);
    for (let pass = 0; pass < 5; pass += 1) {
      game = decodeGame(encodeGame(game));
    }
    expect(identityMap(game)).toEqual(original);
  });

  it("gives two independent readers of one payload the same tiles", () => {
    const payload = serializeGame(playGame());
    const first = deserializeGame(payload)!;
    const second = deserializeGame(payload)!;
    expect(identityMap(first)).toEqual(identityMap(second));
    expect(first.rackA.map((tile) => tile.id)).toEqual(second.rackA.map((tile) => tile.id));
  });

  it("writes the ordinal format", () => {
    const encoded = encodeGame(playGame());
    expect(encoded.v).toBe(CODEC_VERSION);
    // A bag code is now a manifest ordinal, so it addresses one physical tile.
    const first = encoded.tilebag[0];
    const ordinal = typeof first === "number" ? first : first[0];
    expect(ordinal).toBeGreaterThanOrEqual(0);
    expect(ordinal).toBeLessThan(TILE_COUNT);
  });

  it("keeps a played blank's face without changing what the tile is", () => {
    // Manual draw leaves the whole set in the bag, so the blank is easy to find.
    const blankId = TILE_IDS[ordinalOfTileId("blank_1")];
    const withBlank: GameState = deepClone(
      createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "manual" }),
    );
    const blank = withBlank.tilebag.find((tile) => tile.id === blankId)!;
    withBlank.tilebag = withBlank.tilebag.filter((tile) => tile.id !== blankId);
    withBlank.board[7][7] = {
      tile: { ...blank, assignedToken: "7" },
      placedTurn: 1,
      side: "A",
    };
    const decoded = decodeGame(encodeGame(withBlank));
    const cell = decoded.board[7][7]!;
    expect(cell.tile.id).toBe(blankId);
    expect(cell.tile.token).toBe("?");
    expect(cell.tile.assignedToken).toBe("7");
  });
});

describe("damaged data fails loudly instead of being repaired", () => {
  it("refuses a payload that has lost a tile", () => {
    const encoded = encodeGame(playGame());
    encoded.tilebag = encoded.tilebag.slice(1);
    expect(() => decodeGame(encoded)).toThrow(InventoryError);
    expect(() => decodeGame(encoded)).toThrow(/in no location at all/);
  });

  it("refuses a payload that has duplicated a tile", () => {
    const encoded = encodeGame(playGame());
    encoded.tilebag = [encoded.tilebag[0], ...encoded.tilebag];
    expect(() => decodeGame(encoded)).toThrow(/is in both|does not describe/);
  });

  it("refuses to store a tile that is not part of the set", () => {
    const game = playGame();
    game.tilebag[0] = { id: "t9zzzz_1", token: game.tilebag[0].token };
    expect(() => encodeGame(game)).toThrow(/not a tile of the physical set/);
  });

  it("refuses to store a tile whose face contradicts its identity", () => {
    const game = playGame();
    game.tilebag[0] = { id: "n0_1", token: "=" };
    expect(() => encodeGame(game)).toThrow(/that tile is a "0"/);
  });

  it("returns null for unreadable text rather than throwing", () => {
    expect(deserializeGame("not json at all")).toBeNull();
  });
});

describe("games saved before revisions recover their identity canonically", () => {
  /** Rebuild a v2 payload: tile codes are face indices, as the old codec wrote. */
  function toLegacyV2(game: GameState) {
    const faceOf = (tile: TileInstance) => LEGACY_TOKEN_TABLE.indexOf(tile.token);
    const encoded = encodeGame(game) as unknown as Record<string, unknown>;
    const relabelTiles = (codes: unknown[], tiles: TileInstance[]) =>
      codes.map((code, index) =>
        Array.isArray(code) ? [faceOf(tiles[index]), code[1]] : faceOf(tiles[index]),
      );
    return {
      ...encoded,
      v: 2,
      tilebag: relabelTiles(encoded.tilebag as unknown[], game.tilebag),
      rackA: relabelTiles(encoded.rackA as unknown[], game.rackA),
      rackB: relabelTiles(encoded.rackB as unknown[], game.rackB),
      board: [],
      history: [],
      historyLogs: [],
      logs: [],
      historyIndex: 0,
    };
  }

  it("recovers a complete 100-tile set from face-only data", () => {
    const game = playGame();
    const decoded = decodeGame(toLegacyV2(game) as Parameters<typeof decodeGame>[0]);
    expect(allTiles(decoded)).toHaveLength(TILE_COUNT);
    expect(new Set(allTiles(decoded).map((tile) => tile.id)).size).toBe(TILE_COUNT);
    expect(() => inventoryFrom(decoded)).not.toThrow();
  });

  it("recovers the same assignment for every reader, every time", () => {
    const legacy = toLegacyV2(playGame()) as Parameters<typeof decodeGame>[0];
    const first = decodeGame(legacy);
    const second = decodeGame(legacy);
    expect(identityMap(first)).toEqual(identityMap(second));
    // And it is stable across a save in the new format.
    const resaved = decodeGame(encodeGame(first));
    expect(identityMap(resaved)).toEqual(identityMap(first));
  });

  it("preserves every tile's face while recovering identity", () => {
    const game = playGame();
    const decoded = decodeGame(toLegacyV2(game) as Parameters<typeof decodeGame>[0]);
    expect(decoded.rackA.map((tile) => tile.token)).toEqual(game.rackA.map((tile) => tile.token));
    expect(decoded.tilebag.map((tile) => tile.token)).toEqual(
      game.tilebag.map((tile) => tile.token),
    );
  });

  it("refuses face-only data that claims more copies than exist", () => {
    const game = playGame();
    const legacy = toLegacyV2(game) as Record<string, unknown>;
    const codes = legacy.tilebag as number[];
    legacy.tilebag = codes.map(() => LEGACY_TOKEN_TABLE.indexOf("="));
    expect(() => decodeGame(legacy as Parameters<typeof decodeGame>[0])).toThrow(
      /claims \d+ "=" tiles but the set has 11/,
    );
  });
});
