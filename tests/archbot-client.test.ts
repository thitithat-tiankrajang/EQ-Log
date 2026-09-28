// @vitest-environment node
//
// ArchBot's worker protocol, its engine host and its model loader: one request in
// the worker at a time, answers only for the request asked, cancellation by
// termination, recovery from a dead worker, and a model that is verified before
// it is used — or not used at all.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchBotDecision, ArchBotRequest } from "../src/bot/archbot/decide";
import { ArchBotEngine, ArchBotError, type ArchBotWorkerLike } from "../src/bot/archbot/engine";
import { ARCHBOT_MODEL, archBotModelPath } from "../src/bot/archbot/identity";
import { ArchBotModelError, loadArchBotModel, valueHeadFromBytes } from "../src/bot/archbot/model";
import type { ArchBotFromWorker, ArchBotToWorker } from "../src/bot/archbot/protocol";
import { createArchBotWorkerHandler } from "../src/bot/archbot/workerHandler";
import { runArchBot, setArchBotEngineForTests } from "../src/bot/archbot/client";
import { createNewGame } from "../src/game";

const REQUEST = {
  board: [],
  rack: ["1"],
  bagCount: 1,
  oppRackCount: 0,
} as unknown as ArchBotRequest;
const DECISION = {
  type: "pass",
  placements: [],
  exchange: [],
  score: 0,
  stats: { nodes: 5 },
} as unknown as ArchBotDecision;

const modelDir = resolve(__dirname, "../public", archBotModelPath("/").slice(1));
function modelBytes(name: string): ArrayBuffer {
  const buffer = readFileSync(`${modelDir}/${name}`);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ── the worker's logic ───────────────────────────────────────────────────────

describe("ArchBot worker handler", () => {
  function handler(overrides: Partial<Parameters<typeof createArchBotWorkerHandler>[0]> = {}) {
    const posted: ArchBotFromWorker[] = [];
    const loadModel = vi.fn(async () => ({}) as never);
    const decide = vi.fn(() => DECISION);
    const handle = createArchBotWorkerHandler({
      loadModel,
      decide,
      post: (message) => posted.push(message),
      now: () => 0,
      ...overrides,
    });
    return { handle, posted, loadModel, decide };
  }

  it("loads the model once and reuses it for every decision", async () => {
    const { handle, posted, loadModel } = handler();
    await handle({ type: "init", modelPath: "/m/" });
    await handle({ type: "decide", id: 1, modelPath: "/m/", request: REQUEST });
    await handle({ type: "decide", id: 2, modelPath: "/m/", request: REQUEST });
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(posted.map((message) => message.type)).toEqual(["ready", "decided", "decided"]);
    expect(posted[1]).toMatchObject({ type: "decided", id: 1 });
    expect(posted[2]).toMatchObject({ type: "decided", id: 2 });
  });

  it("reports a model that cannot load, and tries again on the next request", async () => {
    const loadModel = vi
      .fn()
      .mockRejectedValueOnce(new ArchBotModelError("model_integrity", "not the pinned weights"))
      .mockResolvedValue({});
    const { handle, posted } = handler({ loadModel });
    await handle({ type: "decide", id: 7, modelPath: "/m/", request: REQUEST });
    expect(posted[0]).toEqual({
      type: "failed",
      id: 7,
      code: "model_unavailable",
      modelCode: "model_integrity",
      message: "not the pinned weights",
    });
    await handle({ type: "decide", id: 8, modelPath: "/m/", request: REQUEST });
    expect(posted[1]).toMatchObject({ type: "decided", id: 8 });
    expect(loadModel).toHaveBeenCalledTimes(2);
  });

  it("reports a decision that throws as a computation failure for that request", async () => {
    const { handle, posted } = handler({
      decide: () => {
        throw new Error("unseen tile count does not match position");
      },
    });
    await handle({ type: "decide", id: 3, modelPath: "/m/", request: REQUEST });
    expect(posted).toEqual([
      {
        type: "failed",
        id: 3,
        code: "compute_failed",
        message: "unseen tile count does not match position",
      },
    ]);
  });

  it("reports an eager load failure without claiming a decision", async () => {
    const { handle, posted } = handler({
      loadModel: async () => {
        throw new ArchBotModelError("model_fetch_failed", "offline");
      },
    });
    await handle({ type: "init", modelPath: "/m/" });
    expect(posted).toEqual([
      { type: "model-error", code: "model_fetch_failed", message: "offline" },
    ]);
  });
});

// ── the host ─────────────────────────────────────────────────────────────────

class FakeWorker implements ArchBotWorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<ArchBotFromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  received: ArchBotToWorker[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: ArchBotToWorker) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  send(message: ArchBotFromWorker) {
    this.onmessage?.({ data: message } as MessageEvent<ArchBotFromWorker>);
  }
  crash(message = "out of memory") {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
  decides() {
    return this.received.filter(
      (m): m is Extract<ArchBotToWorker, { type: "decide" }> => m.type === "decide",
    );
  }
}

function makeEngine() {
  FakeWorker.all = [];
  return new ArchBotEngine({
    createWorker: () => new FakeWorker(),
    modelPath: "/models/archbot/x/",
  });
}

const key = (revision: number) => ({ roomId: "room-1", revision });

describe("ArchBot engine host", () => {
  it("keeps one request in the worker at a time and answers each with its own key", async () => {
    const engine = makeEngine();
    const first = engine.decide({ key: key(1), request: REQUEST });
    const second = engine.decide({ key: key(2), request: REQUEST });
    const worker = FakeWorker.all[0]!;
    expect(worker.received[0]).toEqual({ type: "init", modelPath: "/models/archbot/x/" });
    expect(worker.decides()).toHaveLength(1);
    worker.send({
      type: "decided",
      id: worker.decides()[0]!.id,
      decision: DECISION,
      wallMs: 5,
      modelMs: 9,
    });
    await expect(first).resolves.toMatchObject({ key: key(1), wallMs: 5 });
    expect(worker.decides()).toHaveLength(2);
    worker.send({
      type: "decided",
      id: worker.decides()[1]!.id,
      decision: DECISION,
      wallMs: 6,
      modelMs: 0,
    });
    await expect(second).resolves.toMatchObject({ key: key(2) });
    expect(FakeWorker.all).toHaveLength(1); // the same worker, the model kept
  });

  it("drops an answer that is not for the request in the worker", async () => {
    const engine = makeEngine();
    const pending = engine.decide({ key: key(1), request: REQUEST });
    const worker = FakeWorker.all[0]!;
    const id = worker.decides()[0]!.id;
    worker.send({ type: "decided", id: id + 99, decision: DECISION, wallMs: 1, modelMs: 0 });
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    worker.send({ type: "decided", id, decision: DECISION, wallMs: 1, modelMs: 0 });
    await expect(pending).resolves.toMatchObject({ key: key(1) });
  });

  it("cancels a queued request without it ever reaching the worker", async () => {
    const engine = makeEngine();
    void engine.decide({ key: key(1), request: REQUEST });
    const controller = new AbortController();
    const queued = engine.decide({ key: key(2), request: REQUEST, signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
    const worker = FakeWorker.all[0]!;
    worker.send({
      type: "decided",
      id: worker.decides()[0]!.id,
      decision: DECISION,
      wallMs: 1,
      modelMs: 0,
    });
    await Promise.resolve();
    expect(worker.decides()).toHaveLength(1);
  });

  it("cancels the running request by terminating the worker; the next request gets a new one", async () => {
    const engine = makeEngine();
    const controller = new AbortController();
    const running = engine.decide({ key: key(1), request: REQUEST, signal: controller.signal });
    const old = FakeWorker.all[0]!;
    const oldId = old.decides()[0]!.id;
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "cancelled" });
    expect(old.terminated).toBe(true);

    const next = engine.decide({ key: key(2), request: REQUEST });
    const fresh = FakeWorker.all[1]!;
    // A late answer from the terminated worker belongs to nobody.
    old.send({ type: "decided", id: oldId, decision: DECISION, wallMs: 1, modelMs: 0 });
    fresh.send({
      type: "decided",
      id: fresh.decides()[0]!.id,
      decision: DECISION,
      wallMs: 1,
      modelMs: 0,
    });
    await expect(next).resolves.toMatchObject({ key: key(2) });
  });

  it("fails the running request when the worker dies, and replaces the worker", async () => {
    const engine = makeEngine();
    const running = engine.decide({ key: key(1), request: REQUEST });
    const queued = engine.decide({ key: key(2), request: REQUEST });
    FakeWorker.all[0]!.crash("out of memory");
    await expect(running).rejects.toMatchObject({
      code: "compute_failed",
      message: "out of memory",
    });
    const fresh = FakeWorker.all[1]!;
    fresh.send({
      type: "decided",
      id: fresh.decides()[0]!.id,
      decision: DECISION,
      wallMs: 1,
      modelMs: 0,
    });
    await expect(queued).resolves.toMatchObject({ key: key(2) });
  });

  it("passes a model failure through as ArchBot being unavailable", async () => {
    const engine = makeEngine();
    const pending = engine.decide({ key: key(1), request: REQUEST });
    const worker = FakeWorker.all[0]!;
    worker.send({
      type: "failed",
      id: worker.decides()[0]!.id,
      code: "model_unavailable",
      modelCode: "model_fetch_failed",
      message: "offline",
    });
    await expect(pending).rejects.toMatchObject({
      code: "model_unavailable",
      modelCode: "model_fetch_failed",
    });
  });

  it("says when it is loading the model and when it is thinking", async () => {
    const engine = makeEngine();
    const phases: string[] = [];
    const pending = engine.decide({
      key: key(1),
      request: REQUEST,
      onPhase: (p) => phases.push(p),
    });
    const worker = FakeWorker.all[0]!;
    worker.send({ type: "ready", modelMs: 120 });
    worker.send({
      type: "decided",
      id: worker.decides()[0]!.id,
      decision: DECISION,
      wallMs: 1,
      modelMs: 120,
    });
    await pending;
    expect(phases).toEqual(["loading_model", "thinking"]);
    const later: string[] = [];
    const again = engine.decide({ key: key(2), request: REQUEST, onPhase: (p) => later.push(p) });
    worker.send({
      type: "decided",
      id: worker.decides()[1]!.id,
      decision: DECISION,
      wallMs: 1,
      modelMs: 0,
    });
    await again;
    expect(later).toEqual(["thinking"]);
  });

  it("retires the worker after a search over a huge move set, and keeps it otherwise", async () => {
    FakeWorker.all = [];
    const engine = new ArchBotEngine({
      createWorker: () => new FakeWorker(),
      modelPath: "/m/",
      recycleAfterMoves: 1000,
    });
    const answer = (moves: number) =>
      ({ ...DECISION, stats: { nodes: 1, moves } }) as unknown as ArchBotDecision;
    const small = engine.decide({ key: key(1), request: REQUEST });
    const worker = FakeWorker.all[0]!;
    worker.send({
      type: "decided",
      id: worker.decides()[0]!.id,
      decision: answer(999),
      wallMs: 1,
      modelMs: 0,
    });
    await small;
    expect(worker.terminated).toBe(false);
    const huge = engine.decide({ key: key(2), request: REQUEST });
    worker.send({
      type: "decided",
      id: worker.decides()[1]!.id,
      decision: answer(1000),
      wallMs: 1,
      modelMs: 0,
    });
    await expect(huge).resolves.toMatchObject({ key: key(2) });
    expect(worker.terminated).toBe(true);
    void engine.decide({ key: key(3), request: REQUEST });
    expect(FakeWorker.all).toHaveLength(2);
  });

  it("refuses immediately when asked with a signal that is already aborted", async () => {
    const engine = makeEngine();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.decide({ key: key(1), request: REQUEST, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ArchBotError);
    expect(FakeWorker.all).toHaveLength(0);
  });
});

// ── runArchBot ───────────────────────────────────────────────────────────────

describe("runArchBot", () => {
  afterEach(() => setArchBotEngineForTests(null));

  function archBotGame() {
    const game = createNewGame({
      name: "Player vs ArchBot",
      playerA: "Player",
      playerB: "ArchBot",
      startingSide: "B",
      botSide: "B",
      botEngine: "stage5b",
      botDifficulty: "stage5b64",
      tileDrawMode: "play",
    });
    game.activeSide = "B";
    return game;
  }

  it("refuses an answer about a different room or revision", async () => {
    vi.stubGlobal("Worker", class {});
    const liar = {
      decide: async () => ({
        key: { roomId: "room-1", revision: 99 },
        decision: DECISION,
        wallMs: 1,
        modelMs: 0,
      }),
      dispose: () => undefined,
    } as unknown as ArchBotEngine;
    setArchBotEngineForTests(liar);
    await expect(
      runArchBot({ game: archBotGame(), roomId: "room-1", revision: 4 }),
    ).rejects.toMatchObject({ code: "compute_failed" });
    vi.unstubAllGlobals();
  });

  it("reports a browser without workers as unsupported, and computes nothing", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(
      runArchBot({ game: archBotGame(), roomId: "room-1", revision: 4 }),
    ).rejects.toMatchObject({ code: "unsupported" });
    vi.unstubAllGlobals();
  });
});

// ── the model ────────────────────────────────────────────────────────────────

describe("ArchBot model loading", () => {
  it("ships exactly the pinned model", () => {
    const hash = (name: string) =>
      createHash("sha256")
        .update(Buffer.from(modelBytes(name)))
        .digest("hex");
    expect(hash("model.json")).toBe(ARCHBOT_MODEL.modelJsonSha256);
    expect(hash("weights.bin")).toBe(ARCHBOT_MODEL.weightsSha256);
    expect(archBotModelPath("/")).toBe(`/models/archbot/${ARCHBOT_MODEL.version}/`);
    expect(ARCHBOT_MODEL.weightsSha256.startsWith(ARCHBOT_MODEL.version)).toBe(true);
  });

  it("loads the pinned bytes", async () => {
    await expect(
      valueHeadFromBytes(modelBytes("model.json"), modelBytes("weights.bin")),
    ).resolves.toBeDefined();
  });

  it("refuses weights that differ by one byte", async () => {
    const tampered = modelBytes("weights.bin").slice(0);
    new Uint8Array(tampered)[1234] ^= 1;
    await expect(valueHeadFromBytes(modelBytes("model.json"), tampered)).rejects.toMatchObject({
      code: "model_integrity",
    });
  });

  it("refuses a model description that is not the pinned one", async () => {
    const meta = new TextEncoder().encode(
      new TextDecoder().decode(modelBytes("model.json")).replace("{", "{ "),
    );
    await expect(
      valueHeadFromBytes(meta.buffer as ArrayBuffer, modelBytes("weights.bin")),
    ).rejects.toMatchObject({ code: "model_integrity" });
  });

  it("reports a download failure and a missing file as fetch failures", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadArchBotModel("/m/", offline as unknown as typeof fetch)).rejects.toMatchObject(
      {
        code: "model_fetch_failed",
      },
    );
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(loadArchBotModel("/m/", missing as unknown as typeof fetch)).rejects.toMatchObject(
      {
        code: "model_fetch_failed",
      },
    );
  });

  it("downloads both files from the versioned path", async () => {
    const served = vi.fn(
      async (url: string) =>
        new Response(
          url.endsWith("model.json") ? modelBytes("model.json") : modelBytes("weights.bin"),
        ),
    );
    await loadArchBotModel("/models/archbot/95ba8c0d/", served as unknown as typeof fetch);
    expect(served.mock.calls.map(([url]) => url).sort()).toEqual([
      "/models/archbot/95ba8c0d/model.json",
      "/models/archbot/95ba8c0d/weights.bin",
    ]);
  });
});
