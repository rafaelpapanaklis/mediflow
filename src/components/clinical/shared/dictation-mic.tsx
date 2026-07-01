"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

/**
 * Botón de dictado por voz reutilizable: graba hasta 60s con MediaRecorder,
 * sube el audio a /api/ai/transcribe (Whisper) y entrega el texto vía onText.
 * El padre decide cómo insertar el texto (append, replace, etc.).
 */

/** Máximo por grabación: 60s (límite del producto; mantiene el audio <1MB). */
const MAX_SECONDS = 60;

/** Guard a nivel módulo: solo UNA grabación activa a la vez en toda la app. */
let someoneRecording = false;

type Phase = "idle" | "recording" | "transcribing" | "error";

interface Props {
  /** Recibe el texto transcrito (ya con trim). */
  onText: (text: string) => void;
  disabled?: boolean;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (let i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
  }
  return "";
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const btnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 28,
  height: 28,
  padding: "0 5px",
  borderRadius: 7,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  color: "var(--text-2)",
};

export function DictationMic({ onText, disabled }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const owningRef = useRef(false);
  const mimeRef = useRef("");
  // Última grabación fallida: se conserva para reintentar sin re-dictar 1 min.
  const retryBlobRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Limpieza dura al desmontar: descartar lo grabado sin subir nada.
      mountedRef.current = false;
      stopTimer();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        cancelledRef.current = true;
        try { rec.stop(); } catch { /* ya detenido */ }
      }
      releaseStream();
      if (owningRef.current) { someoneRecording = false; owningRef.current = false; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function releaseStream() {
    const s = streamRef.current;
    if (s) s.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    if (disabled || phase === "recording" || phase === "transcribing") return;
    if (someoneRecording) { toast(t("clinical.dictation.busy")); return; }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error(t("clinical.dictation.unsupported"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("clinical.dictation.micDenied"));
      return;
    }
    if (!mountedRef.current || someoneRecording) {
      stream.getTracks().forEach(tr => tr.stop());
      return;
    }

    retryBlobRef.current = null; // nueva grabación descarta el reintento previo
    cancelledRef.current = false;
    chunksRef.current = [];
    const mime = pickMimeType();
    mimeRef.current = mime;

    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
    } catch {
      stream.getTracks().forEach(tr => tr.stop());
      toast.error(t("clinical.dictation.unsupported"));
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = handleRecorderStop;

    streamRef.current = stream;
    recorderRef.current = recorder;
    someoneRecording = true;
    owningRef.current = true;

    recorder.start();
    setSeconds(0);
    setPhase("recording");

    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 1;
      if (mountedRef.current) setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) finishRecording(); // AUTO-STOP al minuto
    }, 1000);
  }

  /** Detiene la grabación y manda a transcribir. */
  function finishRecording() {
    stopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      cancelledRef.current = false;
      try { rec.stop(); } catch { /* noop */ }
    }
  }

  /** Cancela y descarta: no se sube nada. */
  function cancelRecording() {
    stopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      cancelledRef.current = true;
      try { rec.stop(); } catch { /* noop */ }
    }
  }

  function handleRecorderStop() {
    releaseStream();
    recorderRef.current = null;
    if (owningRef.current) { someoneRecording = false; owningRef.current = false; }

    const wasCancelled = cancelledRef.current;
    cancelledRef.current = false;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (!mountedRef.current) return;
    if (wasCancelled) { setPhase("idle"); return; }

    const type = (mimeRef.current || "audio/webm").split(";")[0];
    const blob = new Blob(chunks, { type });
    if (blob.size === 0) {
      setPhase("idle");
      toast(t("clinical.dictation.noSpeech"));
      return;
    }
    const filename = type === "audio/mp4" ? "voice.mp4" : "voice.webm";
    void transcribe(blob, filename);
  }

  async function transcribe(blob: Blob, filename: string) {
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });

      if (!mountedRef.current) return;

      if (res.status === 503) {
        // Sin OPENAI_API_KEY en el server: reintentar no ayuda.
        retryBlobRef.current = null;
        setPhase("idle");
        toast.error(t("clinical.dictation.notConfigured"));
        return;
      }
      if (!res.ok) {
        retryBlobRef.current = { blob, filename };
        setPhase("error");
        toast.error(t("clinical.dictation.failed"));
        return;
      }
      const data = await res.json();
      const text = data && typeof data.text === "string" ? data.text.trim() : "";
      retryBlobRef.current = null;
      setPhase("idle");
      if (!text) { toast(t("clinical.dictation.noSpeech")); return; }
      onText(text);
    } catch {
      if (!mountedRef.current) return;
      retryBlobRef.current = { blob, filename };
      setPhase("error");
      toast.error(t("clinical.dictation.failed"));
    }
  }

  function retry() {
    const kept = retryBlobRef.current;
    if (kept) void transcribe(kept.blob, kept.filename);
  }

  function discardError() {
    retryBlobRef.current = null;
    setPhase("idle");
  }

  if (phase === "recording") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden
          className="animate-pulse"
          style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }}
        />
        <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#ef4444", fontWeight: 600 }}>
          {fmt(seconds)} / {fmt(MAX_SECONDS)}
        </span>
        <button
          type="button"
          onClick={finishRecording}
          title={t("clinical.dictation.stop")}
          aria-label={t("clinical.dictation.stop")}
          className="hover:bg-muted/10 transition-colors"
          style={{ ...btnStyle, color: "#ef4444", borderColor: "rgba(239,68,68,.35)" }}
        >
          <Square size={12} aria-hidden />
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          title={t("clinical.dictation.cancel")}
          aria-label={t("clinical.dictation.cancel")}
          className="hover:bg-muted/10 transition-colors"
          style={btnStyle}
        >
          <X size={13} aria-hidden />
        </button>
      </span>
    );
  }

  if (phase === "transcribing") {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}
      >
        <Loader2 size={13} className="animate-spin" aria-hidden />
        {t("clinical.dictation.transcribing")}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={retry}
          title={t("clinical.dictation.retry")}
          aria-label={t("clinical.dictation.retry")}
          className="hover:bg-muted/10 transition-colors"
          style={{ ...btnStyle, color: "#ef4444", borderColor: "rgba(239,68,68,.35)" }}
        >
          <RotateCcw size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={discardError}
          title={t("clinical.dictation.discard")}
          aria-label={t("clinical.dictation.discard")}
          className="hover:bg-muted/10 transition-colors"
          style={btnStyle}
        >
          <X size={13} aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      title={t("clinical.dictation.dictate")}
      aria-label={t("clinical.dictation.dictate")}
      className="hover:bg-muted/10 transition-colors"
      style={{ ...btnStyle, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <Mic size={14} aria-hidden />
    </button>
  );
}
