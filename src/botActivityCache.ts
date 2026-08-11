// The bot search lives on the server, but its progress card lives in React.
// A full page refresh destroys React before the new page can attach to that
// same search, so remember just enough UI state in this tab's sessionStorage to
// draw the old percentage immediately while the reconnect GET is opening.

import type { BotProgress } from "./bot/types";

export type BotActivity = {
  commitId: string;
  revision: number;
  progress: BotProgress | null;
};

const activities = new Map<string, BotActivity>();
const STORAGE_PREFIX = "eq-lab:bot-activity:v1:";

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function isProgress(value: unknown): value is BotProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<BotProgress>;
  return (
    (progress.phase === "movegen" || progress.phase === "sim" || progress.phase === "endgame") &&
    typeof progress.percent === "number" &&
    Number.isFinite(progress.percent) &&
    typeof progress.elapsedMs === "number" &&
    typeof progress.etaMs === "number" &&
    typeof progress.bestScore === "number" &&
    typeof progress.detail === "string"
  );
}

function hydrate(roomId: string): void {
  if (activities.has(roomId)) return;
  try {
    const raw = window.sessionStorage.getItem(storageKey(roomId));
    if (!raw) return;
    const activity = JSON.parse(raw) as Partial<BotActivity>;
    if (
      typeof activity.commitId !== "string" ||
      !Number.isInteger(activity.revision) ||
      (activity.progress !== null && !isProgress(activity.progress))
    ) {
      throw new Error("Invalid bot activity");
    }
    activities.set(roomId, activity as BotActivity);
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey(roomId));
    } catch {
      // Storage itself is unavailable.
    }
  }
}

export function remember(roomId: string, activity: BotActivity): void {
  activities.set(roomId, activity);
  try {
    window.sessionStorage.setItem(storageKey(roomId), JSON.stringify(activity));
  } catch {
    // The in-memory copy still preserves ordinary visibility reconnects.
  }
}

export function get(roomId: string): BotActivity | undefined {
  hydrate(roomId);
  return activities.get(roomId);
}

export function forget(roomId: string): void {
  activities.delete(roomId);
  try {
    window.sessionStorage.removeItem(storageKey(roomId));
  } catch {
    // Nothing else to clear.
  }
}
