import { expect, it } from "vitest";
import { decodeGame, encodeGame } from "../src/codec";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createWaitingGame, startWaitingGame } from "../src/pregame";

it("shares the launch deadline across saved room state and clears it when play begins", () => {
  const waiting = createWaitingGame(DEFAULT_NEW_GAME_SETTINGS);
  const launchAt = new Date(Date.now() + 3_000).toISOString();
  const received = decodeGame(encodeGame({ ...waiting, lobbyLaunchAt: launchAt }));

  expect(received.roomStage).toBe("waiting");
  expect(received.timers.paused).toBe(true);
  expect(received.lobbyLaunchAt).toBe(launchAt);

  const started = startWaitingGame(received);
  expect(started.roomStage).toBe("playing");
  expect(started.timers.paused).toBe(false);
  expect(started.lobbyLaunchAt).toBeUndefined();
  expect(started.history[0].lobbyLaunchAt).toBeUndefined();
});
