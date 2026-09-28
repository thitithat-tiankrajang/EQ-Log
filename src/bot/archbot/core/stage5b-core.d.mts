// Types for the part of the vendored Stage 5B core (stage5b-core.mjs) that
// ArchBot calls. Deliberately opaque where ArchBot only passes a value through:
// the core's own types live in the pinned amath-bot-lab source, which a clean
// clone of EQ-Lab does not have.

export type CoreSide = "A" | "B";

export type CoreManifest = {
  readonly tiles: readonly { readonly id: string; readonly kind: string }[];
  readonly kindOf: ReadonlyMap<string, string>;
};

export type CoreState = { readonly turnNumber: number; readonly __coreState: unique symbol };

export type CoreAction =
  | {
      type: "place";
      placements: readonly { cell: number; tileId: string; kind: string; face: string }[];
    }
  | { type: "exchange"; tileIds: readonly string[]; kinds: readonly string[] }
  | { type: "pass" };

export type CoreActionSet = {
  readonly place: readonly unknown[];
  readonly exchange: readonly unknown[];
  readonly pass: unknown | null;
  readonly truncated: boolean;
};

export type CoreCandidate = {
  readonly id: string;
  readonly family: "place" | "exchange" | "pass";
  readonly action: CoreAction;
  readonly immediateScore: number;
  readonly value: number;
  readonly deep: boolean;
  readonly components: readonly { readonly name: string; readonly points: number }[];
};

export type CoreDecision = {
  readonly chosen: CoreCandidate | null;
  readonly candidates: readonly CoreCandidate[];
  readonly trace: {
    readonly legal: { readonly place: number; readonly exchange: number; readonly pass: number };
    readonly generator: { readonly nodes: number };
    readonly timings: { readonly totalMs: number };
  };
};

export type CoreBotConfig = {
  readonly budget: { readonly deepTop: number; readonly keepCandidates: number };
  readonly [key: string]: unknown;
};

export type CoreValueModel = { readonly __coreValueModel: unique symbol };

export declare function createManifest(): CoreManifest;
export declare function decisionRandom(seed: number, side: CoreSide, ply: number): () => number;
export declare function envStateFrom(parts: {
  manifest: CoreManifest;
  board: ReadonlyArray<{
    tileId: string;
    kind: string;
    face: string;
    side: CoreSide;
    turn: number;
  } | null>;
  racks: Record<CoreSide, string[]>;
  bag: string[];
  scores: Record<CoreSide, number>;
  activeSide: CoreSide;
  turnNumber: number;
  noScoreTail: CoreSide[];
  hasPlacement: boolean;
  seed: number;
}): CoreState;
export declare function enumerateActions(state: CoreState): CoreActionSet;
export declare const DEFAULT_BOT_CONFIG: CoreBotConfig;
export declare function decide(
  context: {
    state: CoreState;
    legal: unknown[];
    actionSet: CoreActionSet;
    side: CoreSide;
    ply: number;
    turnNumber: number;
    random: () => number;
    history: unknown[];
  },
  options: { value: ValueHead; config: CoreBotConfig },
): CoreDecision;
export declare function loadValueModel(meta: unknown, bytes: ArrayBuffer): CoreValueModel;
export declare class ValueHead {
  constructor(model: CoreValueModel);
}
