// The buttons that start an import. They know nothing about pixels: each asks
// its source for `BoardEvidence` and hands it up. A source that does not exist
// yet is either hidden or, in development, drawn disabled — never pretending.

import { useEffect, useRef, useState } from "react";
import { Camera, FlaskConical, ImageUp, Loader2 } from "lucide-react";

import type { BoardEvidence } from "../../../features/boardVision/types";
import { isSourceShown, type StudyEvidenceSource } from "./boardEvidenceSources";

const ICONS: Record<string, typeof Camera> = { image: ImageUp, camera: Camera };

export function BoardImportEntries({
  sources,
  onEvidence,
  onStartFlow,
}: {
  sources: readonly StudyEvidenceSource[];
  onEvidence: (evidence: BoardEvidence) => void;
  /** A source with its own screens takes over the board step until it ends. */
  onStartFlow: (source: StudyEvidenceSource) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);

  // Leaving the page abandons whatever a source was doing (a camera, later).
  useEffect(() => () => running.current?.abort(), []);

  const shown = sources.filter(isSourceShown);
  if (shown.length === 0) return null;

  const run = async (source: StudyEvidenceSource) => {
    if (source.flow) {
      onStartFlow(source);
      return;
    }
    if (!source.produce) return;
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setBusy(source.id);
    setError(null);
    try {
      const evidence = await source.produce(controller.signal);
      if (!controller.signal.aborted) onEvidence(evidence);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "นำเข้ากระดานไม่สำเร็จ");
      }
    } finally {
      if (running.current === controller) {
        running.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <div className="study-import" role="group" aria-label="นำเข้ากระดาน">
      {shown.map((source) => {
        const Icon = busy === source.id ? Loader2 : (ICONS[source.id] ?? FlaskConical);
        return (
          <button
            key={source.id}
            type="button"
            className="ghost-button"
            disabled={!(source.produce || source.flow) || busy !== null}
            onClick={() => void run(source)}
          >
            <Icon size={16} aria-hidden /> {source.label}
            {!(source.produce || source.flow) && <small> · ยังไม่เปิดใช้</small>}
          </button>
        );
      })}
      {error && <p className="sync-banner">{error}</p>}
    </div>
  );
}
