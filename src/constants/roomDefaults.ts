import type { NewGameSettings } from "../game";
import { DEFAULT_TIMER_MINUTES } from "./gameRules";

export const DEFAULT_NEW_GAME_SETTINGS: NewGameSettings = {
  // Blank on purpose: CreateRoomPage derives "A vs B" from the player names
  // at submit time, so every room gets a searchable, distinct name.
  name: "",
  gameMode: "versus",
  playerA: "",
  playerB: "",
  playerAMemberId: null,
  playerBMemberId: null,
  playerAEmail: null,
  playerBEmail: null,
  emailPlayMode: undefined,
  emailPlayersCanSeeOpponentRack: false,
  minutes: DEFAULT_TIMER_MINUTES,
  timerMinutes: { A: DEFAULT_TIMER_MINUTES, B: DEFAULT_TIMER_MINUTES },
  startingSide: "A",
  tileDrawMode: "manual",
  untimed: false,
};
