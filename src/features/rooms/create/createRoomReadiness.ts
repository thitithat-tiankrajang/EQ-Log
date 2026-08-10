import type { NewGameSettings } from "../../../game";

export type CreatePlayMode = "hotseat" | "solo" | "hosted_email" | "hosted_solo" | "direct_email";

export type CreateRoomReadiness = { ready: true; reason: null } | { ready: false; reason: string };

export function getCreateRoomReadiness({
  mode,
  settings,
  userId,
}: {
  mode: CreatePlayMode;
  settings: NewGameSettings;
  userId: string | null;
}): CreateRoomReadiness {
  const online = mode === "hosted_email" || mode === "hosted_solo" || mode === "direct_email";
  if (!online) return { ready: true, reason: null };
  if (!userId) return { ready: false, reason: "Sign in first to create an online room." };

  const playerAId = settings.playerAUserId?.trim() || null;
  const playerBId = settings.playerBUserId?.trim() || null;
  if (playerAId && playerAId === playerBId) {
    return {
      ready: false,
      reason: "Side A and Side B must use different registered accounts.",
    };
  }

  const creatorAssigned = playerAId === userId || playerBId === userId;
  if (mode === "direct_email") {
    if (!creatorAssigned) return { ready: false, reason: "Choose which side uses your account." };
    if (!playerAId || !playerBId) return { ready: false, reason: "Choose your opponent." };
    return { ready: true, reason: null };
  }

  if (creatorAssigned) {
    return {
      ready: false,
      reason: "As host you can't also be a player — choose another registered user.",
    };
  }
  if (!playerAId) {
    return {
      ready: false,
      reason:
        mode === "hosted_solo" ? "Choose the solo player." : "Choose both registered players.",
    };
  }
  if (mode === "hosted_email" && !playerBId) {
    return { ready: false, reason: "Choose both registered players." };
  }
  return { ready: true, reason: null };
}
