// The playtest's HTTP API: Connect-style middleware for the Vite dev server,
// equally usable on a bare node:http server (the tests). Local only.
//
//   GET  /api/levels                      the four levels, public facts only
//   POST /api/attempts         {levelId}  a fresh attempt from the exact takeover
//   GET  /api/attempts/:id                the attempt as the player sees it
//   POST /api/attempts/:id/move    {move} the human's move: place | exchange | pass
//   POST /api/attempts/:id/authur         Authur's reply (waits for the search)
//
// Every response body passes `assertPlayerSafe` before it is sent. The complete
// attempt, hidden tiles included, is written to out/playtest/attempts/ after
// every move and never served.
import { startAuthur } from "./authur.mjs";
import {
  OUT_DIR,
  PlaytestError,
  applyAuthur,
  assertPlayerSafe,
  authurRequest,
  createAttempt,
  humanMove,
  loadLevels,
  publicAttempt,
  publicLevel,
  saveAttempt,
  statusOf,
} from "./engine.mjs";

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new PlaytestError("request too large", 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PlaytestError("the request is not JSON");
  }
}

export async function createPlaytestApi({ runDir, ids, outDir = OUT_DIR, authurDir } = {}) {
  const levels = loadLevels({ runDir, ids });
  const authur = startAuthur({ authurDir });
  await authur.ready;
  const attempts = new Map();
  const thinking = new Map();

  const send = (res, status, body, attempt = null) => {
    let text;
    try {
      text = JSON.stringify(assertPlayerSafe(body, attempt));
    } catch (error) {
      console.error("[playtest] response blocked:", error.message);
      status = 500;
      text = JSON.stringify({ error: "the server blocked a response that held hidden information" });
    }
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(text);
  };
  const view = (attempt) => publicAttempt(attempt);

  async function route(req, res) {
    const url = new URL(req.url, "http://playtest.local");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/api/levels") {
      return send(res, 200, { levels: [...levels.values()].map(publicLevel) });
    }
    if (req.method === "POST" && url.pathname === "/api/attempts") {
      const { levelId } = await readJson(req);
      const level = levels.get(levelId);
      if (!level) throw new PlaytestError("unknown level", 404);
      const attempt = createAttempt(level);
      attempts.set(attempt.id, attempt);
      await saveAttempt(attempt, outDir);
      return send(res, 201, view(attempt), attempt);
    }
    if (parts[0] === "api" && parts[1] === "attempts" && parts[2]) {
      const attempt = attempts.get(parts[2]);
      if (!attempt) throw new PlaytestError("unknown attempt (the server may have restarted)", 404);
      if (req.method === "GET" && parts.length === 3) return send(res, 200, view(attempt), attempt);
      if (req.method === "POST" && parts[3] === "move" && parts.length === 4) {
        if (thinking.has(attempt.id)) throw new PlaytestError("Authur is thinking", 409);
        const { move } = await readJson(req);
        humanMove(attempt, move);
        await saveAttempt(attempt, outDir);
        return send(res, 200, view(attempt), attempt);
      }
      if (req.method === "POST" && parts[3] === "authur" && parts.length === 4) {
        let job = thinking.get(attempt.id);
        if (!job && statusOf(attempt) === "authur-to-move") {
          const request = authurRequest(attempt);
          job = authur
            .decide(request)
            .then(async (decision) => {
              applyAuthur(attempt, request, decision);
              await saveAttempt(attempt, outDir);
            })
            .finally(() => thinking.delete(attempt.id));
          thinking.set(attempt.id, job);
        }
        if (job) await job;
        return send(res, 200, view(attempt), attempt);
      }
    }
    throw new PlaytestError("not found", 404);
  }

  return {
    levels,
    attempts,
    middleware(req, res, next) {
      if (!req.url?.startsWith("/api/")) {
        if (next) next();
        else send(res, 404, { error: "not found" });
        return;
      }
      route(req, res).catch((error) => {
        if (error instanceof PlaytestError) send(res, error.status, { error: error.message });
        else {
          console.error("[playtest]", error);
          send(res, 500, { error: "server error (see the terminal)" });
        }
      });
    },
    close: () => authur.close(),
  };
}
