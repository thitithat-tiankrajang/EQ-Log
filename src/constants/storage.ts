export const STORAGE_KEYS = {
  activeRoom: "amath-lab-active-room-v1",
  coffeeRoom: "amath-lab-coffee-room-v1",
  legacyGame: "amath-lab-board-state-v3",
  members: "amath-lab-members-v1",
  railSplit: "amath:right-rail-split",
  remoteCapabilities: "eq-lab:supabase-capabilities:v3",
  roomIndex: "amath-lab-rooms-index-v1",
} as const;

export const ROOM_STORAGE_PREFIX = "amath-lab-room-";
