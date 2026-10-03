import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Turn attention outside the board: one short "your turn" cue, the tab title
 * and favicon while the tab is hidden. Nothing here carries game content — no
 * tile, rack or score ever reaches the title, the favicon or a sound.
 */

export const SOUND_KEY = "eq-lab:live-sound:v1";

export function readSoundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeSoundOn(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
}

let audio: AudioContext | null = null;
let unlockInstalled = false;

/** Browsers start audio suspended until a gesture; the first press unlocks it. */
function installUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    try {
      audio ??= new AudioContext();
      if (audio.state === "suspended") void audio.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

let lastCue = 0;
/** A soft two-note rise, ~0.25 s. At most one cue per 400 ms. */
export function playTurnCue(now = Date.now()) {
  if (now - lastCue < 400) return false;
  lastCue = now;
  if (!audio || audio.state !== "running") return false;
  const start = audio.currentTime;
  [660, 880].forEach((frequency, index) => {
    const oscillator = audio!.createOscillator();
    const gain = audio!.createGain();
    const at = start + index * 0.09;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    oscillator.connect(gain);
    gain.connect(audio!.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.17);
  });
  return true;
}

export function useSoundPreference() {
  const [on, setOn] = useState(readSoundOn);
  useEffect(installUnlock, []);
  const toggle = useCallback(() => {
    setOn((current) => {
      writeSoundOn(!current);
      return !current;
    });
  }, []);
  return { on, toggle };
}

const DOT_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#3157c8"/><text x="16" y="22" font-family="Arial" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">EQ</text><circle cx="26" cy="6" r="6" fill="#ea4335"/></svg>',
  );

/**
 * While `yourTurn` is true and the tab is hidden, the title and favicon say so.
 * Both are restored as soon as the tab is visible or the turn passes.
 */
export function useBackgroundTurnSignal(yourTurn: boolean, title: string) {
  const original = useRef<{ title: string; icon: string | null } | null>(null);
  useEffect(() => {
    const icon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const restore = () => {
      if (!original.current) return;
      document.title = original.current.title;
      const link = icon();
      if (link && original.current.icon) link.href = original.current.icon;
      original.current = null;
    };
    const apply = () => {
      if (!yourTurn || document.visibilityState !== "hidden") return restore();
      if (!original.current)
        original.current = { title: document.title, icon: icon()?.href ?? null };
      document.title = `● ${title}`;
      const link = icon();
      if (link) link.href = DOT_ICON;
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      restore();
    };
  }, [yourTurn, title]);
}
