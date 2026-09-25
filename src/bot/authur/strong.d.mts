type Side = "A" | "B";
type AuthurAction =
  | { type: "place"; placements: readonly { cell: number; tileId: string; kind: string; face: string }[] }
  | { type: "exchange"; tileIds: readonly string[]; kinds: readonly string[] }
  | { type: "pass" };

export type AuthurState = { readonly __authurState: unique symbol };
export type AuthurModels = { readonly __authurModels: unique symbol };
export type AuthurProgress = {
  phase: string;
  legalPlace: number;
  legalExchange: number;
  fraction: number | null;
  generationMs: number;
  strategyMs: number;
};
export type AuthurDecision = {
  action: AuthurAction;
  id: string;
  cancelled: boolean;
  trace: {
    totalMs: number;
    legalPlace: number;
    legalExchange: number;
    generationNodes: number;
    tier3Nodes: number;
    evaluations: number;
    chosenImmediateScore: number;
    generationComplete: boolean;
    spaceMapTruncated: boolean;
  };
  candidates: readonly {
    id: string;
    action: AuthurAction;
    immediateScore: number;
    q: number;
    adjusted: number;
    meanReply: number;
    meanNext: number;
    tier: number;
    chosen: boolean;
  }[];
  endgame?: { exact: boolean; selectedOptimalMargin: number; mode: string };
};
export function createManifest(): {
  tiles: readonly { id: string; kind: string }[];
  kindOf: ReadonlyMap<string, string>;
};
export function envStateFrom(parts: {
  manifest: ReturnType<typeof createManifest>;
  board: readonly ({ tileId: string; kind: string; face: string; side: Side; turn: number } | null)[];
  racks: Record<Side, readonly string[]>;
  pendingReturn: Record<Side, readonly string[]>;
  bag: readonly string[];
  scores: Record<Side, number>;
  activeSide: Side;
  turnNumber: number;
  noScoreTail: readonly Side[];
  hasPlacement: boolean;
  seed: number;
  rngStep: number;
}): AuthurState;
export function loadStrongModels(base: string): Promise<AuthurModels>;
export function decideStrong(
  state: AuthurState,
  seed: number,
  models: AuthurModels | null,
  options?: { signal?: AbortSignal; onProgress?: (progress: AuthurProgress) => void;
    config?: Partial<{ shortlist: number; worldsTier1: number; worldsTier2: number;
      finalists: number; worldsTier3: number; tier3Rounds: number }> },
): Promise<AuthurDecision>;
