"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import { EDU_DICTADO_MAX_SECONDS, type EduIaEstado } from "@/lib/edu/ia-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL MICRÓFONO DEL VERTICAL — y por qué NO es el del dental.
 *
 * `src/components/clinical/shared/dictation-mic.tsx` hace exactamente esto
 * y está bien hecho. No se importa por DOS razones, y la primera no es
 * negociable:
 *
 *   1. 🔴 LLAMA A `useT()` EN SU PRIMERA LÍNEA, y `useT` LANZA fuera de
 *      `<I18nProvider>` ("useT debe usarse dentro de <I18nProvider>", ver
 *      src/i18n/i18n-provider.tsx). Ese provider lo monta el layout de
 *      /dashboard y NADA MÁS: el panel del instituto no lo tiene. Importar
 *      ese componente aquí no da un texto en inglés — revienta el árbol de
 *      React en cuanto se renderiza la pestaña del expediente.
 *   2. Tiene el endpoint del dental cableado (`/api/ai/transcribe`), que
 *      con una sesión de instituto contesta 401 (ver ia-core.ts).
 *
 * Cambiar aquel componente para que sirviera aquí —hacerle el `useT`
 * opcional y sacarle la URL a una prop— habría sido tocar el dental, que
 * está VIVO en producción y tiene seis pantallas usándolo. Así que el
 * vertical trae el suyo, con la misma mecánica (MediaRecorder, tope de 60
 * segundos, auto-stop, cancelar, reintentar sin re-dictar) y sin las dos
 * ataduras.
 *
 * Diferencias de fondo, aparte de las dos de arriba:
 *   · los errores se pintan INLINE y no con `react-hot-toast`: en el piso
 *     clínico el teléfono está en la mano y un toast en la esquina se
 *     pierde;
 *   · no hay aviso de tokens gastados, porque en el instituto todavía no
 *     hay cupo de IA que descontar. Cuando lo haya, aquí va.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Solo UNA grabación activa a la vez en toda la pantalla. */
let alguienGrabando = false;

type Fase = "idle" | "grabando" | "transcribiendo" | "error";

export interface EduDictadoMicProps {
  /** Recibe el texto ya con trim. El padre decide cómo insertarlo. */
  onText: (text: string) => void;
  disabled?: boolean;
  /** El estado de la IA, resuelto en el SERVIDOR (ver ia-core.ts). */
  estado: EduIaEstado;
}

function mimeSoportado(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidatos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (let i = 0; i < candidatos.length; i++) {
    if (MediaRecorder.isTypeSupported(candidatos[i])) return candidatos[i];
  }
  return "";
}

/** El error de getUserMedia, traducido a algo que se pueda actuar. */
function mensajeDeMicrofono(err: unknown): string {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "El navegador no te dio permiso de micrófono. Ábrelo en el candado de la barra de direcciones y vuelve a intentarlo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono en este equipo.";
    case "NotReadableError":
      return "El micrófono lo está usando otra aplicación.";
    default:
      return "No se pudo abrir el micrófono.";
  }
}

function reloj(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function EduDictadoMic({ onText, disabled, estado }: EduDictadoMicProps) {
  const [fase, setFase] = useState<Fase>("idle");
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceladoRef = useRef(false);
  const dueñoRef = useRef(false);
  const mimeRef = useRef("");
  // La última grabación fallida se conserva para reintentar la SUBIDA sin
  // pedirle a nadie que vuelva a dictar un minuto entero.
  const reintentoRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      // Limpieza dura al desmontar: lo grabado se descarta sin subir nada.
      montadoRef.current = false;
      pararTimer();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        canceladoRef.current = true;
        try {
          rec.stop();
        } catch {
          /* ya detenido */
        }
      }
      soltarStream();
      if (dueñoRef.current) {
        alguienGrabando = false;
        dueñoRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pararTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function soltarStream() {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function empezar() {
    if (disabled || !estado.disponible) return;
    if (fase === "grabando" || fase === "transcribiendo") return;
    if (alguienGrabando) {
      setError("Ya hay un dictado en curso en esta pantalla.");
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Este navegador no puede grabar audio. Prueba con Chrome o Safari actualizados.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(mensajeDeMicrofono(err));
      return;
    }
    if (!montadoRef.current || alguienGrabando) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    setError(null);
    reintentoRef.current = null;
    canceladoRef.current = false;
    chunksRef.current = [];
    const mime = mimeSoportado();
    mimeRef.current = mime;

    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Este navegador no puede grabar en un formato que sepamos transcribir.");
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = alDetenerse;

    streamRef.current = stream;
    recorderRef.current = recorder;
    alguienGrabando = true;
    dueñoRef.current = true;

    recorder.start();
    setSegundos(0);
    setFase("grabando");

    let transcurridos = 0;
    timerRef.current = setInterval(() => {
      transcurridos += 1;
      if (montadoRef.current) setSegundos(transcurridos);
      if (transcurridos >= EDU_DICTADO_MAX_SECONDS) terminar();
    }, 1000);
  }

  /** Corta y manda a transcribir. */
  function terminar() {
    pararTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      canceladoRef.current = false;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
  }

  /** Corta y descarta: no se sube nada. */
  function cancelar() {
    pararTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      canceladoRef.current = true;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
  }

  function alDetenerse() {
    soltarStream();
    recorderRef.current = null;
    if (dueñoRef.current) {
      alguienGrabando = false;
      dueñoRef.current = false;
    }

    const seCanceló = canceladoRef.current;
    canceladoRef.current = false;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (!montadoRef.current) return;
    if (seCanceló) {
      setFase("idle");
      return;
    }

    const tipo = (mimeRef.current || "audio/webm").split(";")[0];
    const blob = new Blob(chunks, { type: tipo });
    if (blob.size === 0) {
      setFase("idle");
      setError("No se grabó nada. Acerca el micrófono y vuelve a intentarlo.");
      return;
    }
    void transcribir(blob, tipo === "audio/mp4" ? "voz.mp4" : "voz.webm");
  }

  async function transcribir(blob: Blob, filename: string) {
    setFase("transcribiendo");
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      // Sin `eduRequest`: eso manda JSON y esto es multipart. El manejo de
      // error se repite adrede en vez de generalizar aquel helper — es la
      // única llamada del vertical que sube un archivo desde el servidor.
      const res = await fetch("/api/instituto/ai/dictado", { method: "POST", body: form });
      if (!montadoRef.current) return;

      const data = await res.json().catch(() => null as unknown);
      if (!res.ok) {
        const mensaje =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "No se pudo transcribir el audio.";
        // 503 y 403 no se arreglan reintentando: falta la bandera de IA o
        // el permiso. Se descarta el audio para no ofrecer un botón que
        // siempre va a fallar.
        if (res.status === 503 || res.status === 403 || res.status === 401) {
          reintentoRef.current = null;
          setFase("idle");
        } else {
          reintentoRef.current = { blob, filename };
          setFase("error");
        }
        setError(mensaje);
        return;
      }

      const texto =
        data && typeof data === "object" && typeof (data as { text?: unknown }).text === "string"
          ? (data as { text: string }).text.trim()
          : "";
      reintentoRef.current = null;
      setFase("idle");
      if (!texto) {
        setError("No se entendió nada de la grabación.");
        return;
      }
      onText(texto);
    } catch {
      if (!montadoRef.current) return;
      reintentoRef.current = { blob, filename };
      setFase("error");
      setError("No se pudo conectar. Revisa tu conexión y reintenta.");
    }
  }

  // ── Apagado: el botón se pinta, deshabilitado, con el motivo ──────────
  // No se esconde a propósito. Un micrófono que desaparece parece un
  // producto al que le falta una función; uno deshabilitado que dice por
  // qué es un producto que te está contando algo.
  if (!estado.disponible) {
    return (
      <button
        type="button"
        className="edu-mic edu-mic--off"
        disabled
        title={`${estado.titulo}. ${estado.detalle}`}
        aria-label={estado.titulo}
      >
        <Mic size={14} aria-hidden />
      </button>
    );
  }

  if (fase === "grabando") {
    return (
      <span className="edu-mic__wrap">
        <span className="edu-mic__punto animate-pulse" aria-hidden />
        <span className="edu-mic__reloj">
          {reloj(segundos)} / {reloj(EDU_DICTADO_MAX_SECONDS)}
        </span>
        <button
          type="button"
          className="edu-mic edu-mic--rec"
          onClick={terminar}
          title="Terminar y transcribir"
          aria-label="Terminar y transcribir"
        >
          <Square size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="edu-mic"
          onClick={cancelar}
          title="Cancelar sin transcribir"
          aria-label="Cancelar sin transcribir"
        >
          <X size={13} aria-hidden />
        </button>
      </span>
    );
  }

  if (fase === "transcribiendo") {
    return (
      <span className="edu-mic__wrap" role="status" aria-live="polite">
        <Loader2 size={13} className="animate-spin" aria-hidden />
        <span className="edu-mic__reloj">Transcribiendo…</span>
      </span>
    );
  }

  return (
    <span className="edu-mic__wrap">
      {error && (
        <span className="edu-mic__error" role="alert" title={error}>
          {error}
        </span>
      )}
      {fase === "error" && reintentoRef.current ? (
        <>
          <button
            type="button"
            className="edu-mic edu-mic--rec"
            onClick={() => {
              const guardado = reintentoRef.current;
              if (guardado) void transcribir(guardado.blob, guardado.filename);
            }}
            title="Reintentar con lo que ya grabaste"
            aria-label="Reintentar"
          >
            <RotateCcw size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="edu-mic"
            onClick={() => {
              reintentoRef.current = null;
              setError(null);
              setFase("idle");
            }}
            title="Descartar la grabación"
            aria-label="Descartar"
          >
            <X size={13} aria-hidden />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="edu-mic"
          onClick={empezar}
          disabled={disabled}
          title={`Dictar (hasta ${EDU_DICTADO_MAX_SECONDS} s). El texto se agrega al final del campo.`}
          aria-label="Dictar"
        >
          <Mic size={14} aria-hidden />
        </button>
      )}
    </span>
  );
}
