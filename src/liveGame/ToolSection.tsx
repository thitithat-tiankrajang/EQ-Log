import type { ReactNode } from "react";

/** One compact group inside a live game tools or record panel. */
export function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="live-tool" aria-label={title}>
      <h3 className="live-tool-title">{title}</h3>
      {children}
    </section>
  );
}
