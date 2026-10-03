/** `#/play/live-shell-fixture:<state>[:<viewer>]` — development-only visual fixtures. */
export function parseShellFixtureRoomId(roomId: string): { state: string; viewer: string } | null {
  const match = /^live-shell-fixture:([a-z-]+)(?::([a-z-]+))?$/.exec(roomId);
  return match ? { state: match[1], viewer: match[2] ?? "a" } : null;
}
