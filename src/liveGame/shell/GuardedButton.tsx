import { useEffect, useRef, type ButtonHTMLAttributes, type MouseEvent } from "react";

/**
 * A turn-action button that ignores a press it did not see begin.
 *
 * Fast play means buttons appear the moment the newest authoritative state
 * allows them, often right under a thumb or cursor that is already moving. A
 * blanket "ignore input for N ms" would add lag to every legitimate fast press,
 * so instead the button accepts a pointer activation only if the pointer went
 * DOWN on this very button after it was first painted. A press that started
 * on whatever was there before (the THINKING status, a previous turn's button)
 * is dropped; a fresh press is honoured immediately, with no delay at all.
 * Keyboard activation (`detail === 0`) is always honoured.
 *
 * Callers also key the action group by turn so React never recycles a DOM node
 * from the previous turn into this one.
 */
export function GuardedButton({
  onPress,
  onPointerDown,
  onClick: _ignored,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { onPress(): void }) {
  const paintedAt = useRef(Number.POSITIVE_INFINITY);
  const armed = useRef(false);
  useEffect(() => {
    const stamp = () => {
      paintedAt.current = performance.now();
    };
    if (typeof requestAnimationFrame !== "function") {
      stamp();
      return;
    }
    const frame = requestAnimationFrame(stamp);
    return () => cancelAnimationFrame(frame);
  }, []);
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      const ok = armed.current;
      armed.current = false;
      if (!ok) return;
    }
    onPress();
  };
  return (
    <button
      {...props}
      type="button"
      onPointerDown={(event) => {
        // Event time and performance.now() share the same origin.
        armed.current = event.timeStamp >= paintedAt.current;
        onPointerDown?.(event);
      }}
      onClick={click}
    />
  );
}
