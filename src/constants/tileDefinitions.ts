export type AmathTokenInfo = {
  token: string;
  count: number;
  type: "lightNumber" | "heavyNumber" | "operator" | "choice" | "equals" | "Blank";
  point: number;
};

export const AMATH_TOKENS = {
  "0": { token: "0", count: 5, type: "lightNumber", point: 1 },
  "1": { token: "1", count: 6, type: "lightNumber", point: 1 },
  "2": { token: "2", count: 6, type: "lightNumber", point: 1 },
  "3": { token: "3", count: 5, type: "lightNumber", point: 1 },
  "4": { token: "4", count: 5, type: "lightNumber", point: 2 },
  "5": { token: "5", count: 4, type: "lightNumber", point: 2 },
  "6": { token: "6", count: 4, type: "lightNumber", point: 2 },
  "7": { token: "7", count: 4, type: "lightNumber", point: 2 },
  "8": { token: "8", count: 4, type: "lightNumber", point: 2 },
  "9": { token: "9", count: 4, type: "lightNumber", point: 2 },
  "10": { token: "10", count: 2, type: "heavyNumber", point: 3 },
  "11": { token: "11", count: 1, type: "heavyNumber", point: 4 },
  "12": { token: "12", count: 2, type: "heavyNumber", point: 3 },
  "13": { token: "13", count: 1, type: "heavyNumber", point: 6 },
  "14": { token: "14", count: 1, type: "heavyNumber", point: 4 },
  "15": { token: "15", count: 1, type: "heavyNumber", point: 4 },
  "16": { token: "16", count: 1, type: "heavyNumber", point: 4 },
  "17": { token: "17", count: 1, type: "heavyNumber", point: 6 },
  "18": { token: "18", count: 1, type: "heavyNumber", point: 4 },
  "19": { token: "19", count: 1, type: "heavyNumber", point: 7 },
  "20": { token: "20", count: 1, type: "heavyNumber", point: 5 },
  "+": { token: "+", count: 4, type: "operator", point: 2 },
  "-": { token: "-", count: 4, type: "operator", point: 2 },
  x: { token: "×", count: 4, type: "operator", point: 2 },
  "/": { token: "÷", count: 4, type: "operator", point: 2 },
  "+/-": { token: "+/-", count: 5, type: "choice", point: 1 },
  "x//": { token: "x/÷", count: 4, type: "choice", point: 1 },
  "=": { token: "=", count: 11, type: "equals", point: 1 },
  "?": { token: "?", count: 4, type: "Blank", point: 0 },
} as const satisfies Record<string, AmathTokenInfo>;

export type AmathToken = keyof typeof AMATH_TOKENS;
export type TokenType = (typeof AMATH_TOKENS)[AmathToken]["type"];

