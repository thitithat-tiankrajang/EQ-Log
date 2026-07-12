export const BOARD_CELL_MIN_PX = 15;
export const BOARD_CELL_MAX_PX = 68;
export const BOARD_CELL_SCALE = 0.96;
export const BOARD_COLUMN_LABEL_HEIGHT_PX = 22;
export const BOARD_ROW_LABEL_WIDTH_PX = 34;
export const BOARD_BORDER_TOTAL_PX = 4;
export const BOARD_RACK_CHROME_PX = 34;
export const BOARD_SAFETY_INSET_PX = 18;
export const RACK_HEIGHT_TO_CELL_RATIO = 1.42;

export const ACTION_PANEL_MIN_HEIGHT_PX = 140;
export const TILEBAG_PANEL_MIN_HEIGHT_PX = 160;

/* Mobile (≤ this width the game switches to the bottom-dock layout;
   keep in sync with the @media breakpoints in styles/99-mobile-play.css). */
export const MOBILE_LAYOUT_MAX_PX = 759;
/* Total horizontal pixels outside the 15 cells on mobile:
   4px board border + 8px grid-wrap padding. */
export const MOBILE_BOARD_INSET_PX = 12;
/* Fixed mobile chrome above/below the board, EXCLUDING the rack row:
   top bar + score strip + gaps + dock action bar + dock padding. */
export const MOBILE_CHROME_BASE_PX = 224;
