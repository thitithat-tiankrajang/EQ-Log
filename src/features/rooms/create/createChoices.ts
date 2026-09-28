import type { CreatePreset, Route } from "../../../router";

export type CreateRoute = Extract<Route, { kind: "create" }>;

/**
 * What the Create chooser offers, in order. Each is an existing way of setting
 * up a room, named for what the player wants rather than for its technical
 * mode; the room it produces is unchanged:
 *
 * - `match`    — the creator takes one side against a chosen player (direct).
 * - `host`     — a neutral host runs the board for one or two seated players.
 * - `passplay` — both sides on this device; the app draws tiles, or the
 *                players enter real tiles to record a game played on a board.
 * - `solo`     — one player practising alone.
 * - `custom`   — the full step-by-step setup.
 *
 * Ranked, Stage and games against a bot are Arena activities, not things the
 * player creates here, so they are deliberately absent.
 */
export const CREATE_CHOICES = [
  "match",
  "host",
  "passplay",
  "solo",
  "custom",
] as const satisfies readonly CreatePreset[];
export type CreateChoice = (typeof CREATE_CHOICES)[number];

/** Choices that seat registered players online, so need the online service. */
export const ONLINE_CREATE_CHOICES: readonly CreateChoice[] = ["match", "host"];

/**
 * The Create address for where the player is now, without a choice made: the
 * space they came from, and the place to return to when that place is a list
 * the player would expect to go back to.
 */
export function createContextFor(route: Route): CreateRoute {
  if (route.kind === "create") {
    return {
      kind: "create",
      visibility: route.visibility,
      ...(route.returnTo ? { returnTo: route.returnTo } : {}),
    };
  }
  if (route.kind === "private") {
    return { kind: "create", visibility: "public", returnTo: route };
  }
  if (route.kind === "home" && route.section === "history") {
    return {
      kind: "create",
      visibility: route.visibility,
      returnTo: { kind: "home", visibility: route.visibility, section: "history" },
    };
  }
  if (route.kind === "home" && route.visibility === "region") {
    return { kind: "create", visibility: "region" };
  }
  return { kind: "create", visibility: "public" };
}

/** The address of one choice, keeping the context it was chosen in. */
export function createChoiceRoute(context: CreateRoute, choice: CreateChoice): CreateRoute {
  return { ...createContextFor(context), preset: choice };
}

export function isCreateChoice(preset: CreatePreset | undefined): preset is CreateChoice {
  return CREATE_CHOICES.some((choice) => choice === preset);
}

/** The choices that open the settings form directly, with scope chosen inline. */
export function isDirectCreateChoice(
  preset: CreatePreset | undefined,
): preset is Exclude<CreateChoice, "custom"> {
  return isCreateChoice(preset) && preset !== "custom";
}

export type CreateScope = "public" | "region" | "private";

/**
 * The space a directly-opened form starts in: the Region when the player came
 * from it (and has one), Private when they came from their saved games, and
 * Public otherwise. The player can change it in the form.
 */
export function initialCreateScope(route: CreateRoute, regionAvailable: boolean): CreateScope {
  if (route.returnTo?.kind === "private") return "private";
  if (route.visibility === "region" && regionAvailable) return "region";
  return "public";
}
