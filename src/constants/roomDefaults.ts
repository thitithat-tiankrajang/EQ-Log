import type { NewGameSettings } from "../game";
import { DEFAULT_TIMER_MINUTES } from "./gameRules";

export const DEFAULT_NEW_GAME_SETTINGS: NewGameSettings = {
  name: "Equation Lab",
  playerA: "",
  playerB: "",
  playerAMemberId: null,
  playerBMemberId: null,
  playerAEmail: null,
  playerBEmail: null,
  minutes: DEFAULT_TIMER_MINUTES,
  timerMinutes: { A: DEFAULT_TIMER_MINUTES, B: DEFAULT_TIMER_MINUTES },
  startingSide: "A",
  tileDrawMode: "manual",
  untimed: false,
};

