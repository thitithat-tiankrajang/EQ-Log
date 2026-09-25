// ── Board import from a photo (V1) ───────────────────────────────────────────
//
//   choose photo → upright pixels (EXIF, exactly once) → four grid corners
//   → recognition in a worker (two passes) → BoardEvidence → verification
//
// Loaded lazily: none of this — nor the worker, ONNX Runtime or the model — is
// fetched unless someone opens the photo import.
//
// This flow only PRODUCES evidence. What the tiles are is still decided by the
// person in verification; faces and equations are not touched here.

import { useRef, useState } from "react";
import { ImageUp, Loader2 } from "lucide-react";

import type { ImportContext } from "../../../../features/boardVision/annotation";
import type { Quad } from "../../../../features/boardVision/geometry";
import { readingQuad } from "../../../../features/boardVision/geometry";
import { EvidenceAccumulator } from "../../../../features/boardVision/observation";
import { PhotoError, decodePhoto, type Photo } from "../../../../features/boardVision/photo";
import type { ImageRecognition } from "../../../../features/boardVision/recognize";
import {
  VISION_MODEL_VERSION,
  recognizePhoto,
  type RecognitionStage,
} from "../../../../features/boardVision/recognizerClient";
import type { ImportFlowProps } from "../boardEvidenceSources";
import { CornerPicker } from "./CornerPicker";

type Stage =
  | { name: "choose" }
  | { name: "decoding" }
  | { name: "corners"; photo: Photo; quad?: Quad }
  | { name: "reading"; photo: Photo; quad: Quad; stage: RecognitionStage }
  | { name: "undecided"; photo: Photo; quad: Quad; recognition: ImageRecognition };

const STAGE_TEXT: Record<RecognitionStage, string> = {
  model: "กำลังโหลดตัวอ่านภาพ (ครั้งแรกใช้เวลาสักครู่)…",
  recognising: "กำลังอ่านเบี้ยทุกช่อง…",
};

export default function ImageImportFlow({ onEvidence, onCancel }: ImportFlowProps) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStage({ name: "decoding" });
    try {
      setStage({ name: "corners", photo: await decodePhoto(file) });
    } catch (cause) {
      setError(cause instanceof PhotoError ? cause.message : "เปิดรูปนี้ไม่ได้");
      setStage({ name: "choose" });
    }
  };

  const finish = (photo: Photo, recognition: ImageRecognition) => {
    const accumulator = new EvidenceAccumulator();
    accumulator.add(recognition.observation);
    const toOriginal = (v: number) => v / photo.scale;
    const context: ImportContext = {
      photoName: photo.name,
      photoSize: [toOriginal(photo.width), toOriginal(photo.height)],
      quad: recognition.quad.map(
        ([x, y]) => [toOriginal(x), toOriginal(y)] as const,
      ) as unknown as Quad,
      reading: recognition.reading,
      modelVersion: recognition.observation.classifier.modelVersion,
      modelDomain: "",
      exifOrientation: photo.orientation,
    };
    onEvidence(accumulator.evidence(), context);
  };

  const read = async (photo: Photo, quad: Quad) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setError(null);
    setStage({ name: "reading", photo, quad, stage: "model" });
    try {
      const recognition = await recognizePhoto(photo, quad, {
        frameId: `${photo.name}#${Date.now()}`,
        signal: controller.signal,
        onStage: (s) => setStage({ name: "reading", photo, quad, stage: s }),
      });
      if (controller.signal.aborted) return;
      // The recogniser could not tell which side is row 1: ask, don't guess.
      if (!recognition.reading.decided) {
        setStage({ name: "undecided", photo, quad, recognition });
        return;
      }
      finish(photo, recognition);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "อ่านกระดานไม่สำเร็จ");
      setStage({ name: "corners", photo, quad });
    }
  };

  const cancel = () => {
    running.current?.abort();
    onCancel();
  };

  return (
    <div className="study-import-flow">
      {error && (
        <p className="sync-banner" role="alert">
          {error}
        </p>
      )}

      {(stage.name === "choose" || stage.name === "decoding") && (
        <section className="study-step" aria-label="เลือกรูปกระดาน">
          <h2 className="study-heading">นำเข้ากระดานจากรูป</h2>
          <p className="study-hint">
            ถ่ายจากด้านบนให้เห็นตารางครบทั้ง 15×15 ช่อง ยิ่งใกล้และคมยิ่งอ่านได้แม่น ·
            รูปถูกอ่านบนเครื่องนี้ ด้วยตัวอ่านภาพรุ่น {VISION_MODEL_VERSION}{" "}
            ซึ่งยังไม่ได้วัดความแม่นยำกับรูปจริง — ต้องตรวจทุกช่องก่อนยืนยัน
          </p>
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="visually-hidden"
            aria-label="ไฟล์รูปกระดาน"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={cancel}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={stage.name === "decoding"}
              onClick={() => input.current?.click()}
            >
              {stage.name === "decoding" ? (
                <Loader2 size={16} aria-hidden />
              ) : (
                <ImageUp size={16} aria-hidden />
              )}{" "}
              เลือกรูป
            </button>
          </div>
        </section>
      )}

      {(stage.name === "corners" || stage.name === "reading") && (
        <>
          <CornerPicker
            photo={stage.photo}
            initial={stage.quad}
            busy={stage.name === "reading"}
            onBack={() => {
              running.current?.abort();
              setStage({ name: "choose" });
            }}
            onConfirm={(quad) => void read(stage.photo, quad)}
          />
          {stage.name === "reading" && (
            <p className="study-hint" role="status">
              <Loader2 size={14} aria-hidden /> {STAGE_TEXT[stage.stage]}
            </p>
          )}
        </>
      )}

      {stage.name === "undecided" && (
        <section className="study-step" aria-label="ด้านบนของกระดาน">
          <h2 className="study-heading">ไม่แน่ใจว่าด้านไหนคือแถวที่ 1</h2>
          <p className="study-hint">
            เบี้ยบนกระดานน้อยเกินไปหรือวางหันหลายทาง ระบบจึงไม่เดาทิศของกระดาน — ใช้ตามที่วางมุมไว้
            (จุด 1 คือมุมบนซ้าย) หรือหมุนทีละ 90° แล้วให้อ่านใหม่
          </p>
          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={cancel}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void read(stage.photo, readingQuad(stage.quad, 1))}
            >
              หมุน 90° แล้วอ่านใหม่
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => finish(stage.photo, stage.recognition)}
            >
              ใช้ตามนี้
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
