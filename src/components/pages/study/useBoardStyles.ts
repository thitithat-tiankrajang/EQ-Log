import { useInsertionEffect } from "react";
import boardStylesCss from "../../../board-styles.css?inline";

let mounted = 0;
let element: HTMLStyleElement | null = null;

/**
 * The board and tile styling, in the document only while a page that needs it is on screen.
 *
 * `board-styles.css` re-declares the base sheets Play also ships. Imported normally it stayed in
 * the document for the rest of the session once the lobby had loaded the Study page, and on
 * entering Play its copies — `!important` rules above all, which layer order cannot tame —
 * overrode Play's own: nearly 200 elements on one Play screen changed colour or size until a
 * reload. Play needs `play-styles.css` and nothing else, so this sheet leaves with the page
 * that asked for it. Inserted before layout, so the Study board never paints unstyled.
 */
export function useBoardStyles(): void {
  useInsertionEffect(() => {
    mounted += 1;
    if (!element) {
      element = document.createElement("style");
      element.dataset.boardStyles = "study";
      element.textContent = boardStylesCss;
      document.head.appendChild(element);
    }
    return () => {
      mounted -= 1;
      if (mounted === 0 && element) {
        element.remove();
        element = null;
      }
    };
  }, []);
}
