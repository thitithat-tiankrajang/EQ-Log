export const UNIT_TOKENS = new Set<string>(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

export const TENS_TOKENS = new Set<string>([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
]);

export const EVALUATOR_MARKS = new Set<string>(["=", "+", "-", "*", "/"]);

export const BLANK_ASSIGNMENT_OPTIONS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "+", "-", "×", "÷", "=",
] as const;

