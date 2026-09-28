import type { MouseEvent } from "react";

/**
 * A plain primary click on a link. Anything else (a new tab, a new window, a
 * download) is left to the browser, so a link that the app handles itself
 * still behaves as a link.
 */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
