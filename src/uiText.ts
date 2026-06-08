import type { ActionType, Phase, SlotType } from "./game";

export const TILE_GROUP_LABELS = {
  lightNumber: "Single Digits",
  heavyNumber: "10-20",
  operator: "Operators",
  choice: "Flexible Operators",
  equals: "Equals",
  Blank: "Blanks",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  place_equation: "Place Equation",
  exchange: "Exchange Tiles",
  pass: "Pass",
};

export const PHASE_LABELS: Record<Phase, string> = {
  refill: "Refill",
  choose_action: "Choose Action",
  perform_action: "Action Draft",
};

export const SLOT_LABELS: Record<SlotType, string> = {
  px1: "",
  px2: "2P",
  px3: "3P",
  px3star: "3P",
  ex2: "2E",
  ex3: "3E",
};
