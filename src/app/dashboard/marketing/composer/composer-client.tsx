"use client";

// Composer del módulo Marketing (WS-MKT-T3). Editor de caption con contador por
// canal, uploader con preview, selector FB/IG/Ambas, toggle Publicar ahora vs
// Programar, y vista previa mock. Estilo: inline + tokens var(--...) del panel.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Facebook,
  Instagram,
  Megaphone,
  ImagePlus,
  X,
  Loader2,
  Send,
  CalendarClock,
  Save,
  AlertTriangle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Channel } from "@/lib/marketing/types";

interface Connections {
  facebook: boolean;
  instagram: boolean;
}
interface InitialPost {
  id: string;
  channel: string;
  caption: string;
  mediaUrls: string[];
  status: string;
  scheduledFor: string | null;
  aiGenerated?: boolean;
}
interface Props {
  connections: Connections;
  initialCaption: string;
  initialDate: string;
  initialPost: InitialPost | null;
}

const MAX_MEDIA = 10;

const CHANNEL_META: { value: Channel; label: string; icon: LucideIcon; limit: number }[] = [
  { value: "FACEBOOK", label: "Facebook", icon: Facebook, limit: 5000 },
  { value: "INSTAGRAM", label: "Instagram", icon: Instagram, limit: 2200 },
  { value: "BOTH", label: "Ambas", icon: Megaphone, limit: 2200 },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToISO(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── estilos base reutilizables ──────────────────────────────────────
const card: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  padding: 18,
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-2)",
  marginBottom: 8,
};
const baseBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 44,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 10,
  cursor: "pointer",
  border: "1px solid transparent",
  transition: "background 0.14s, opacity 0.14s, border-color 0.14s",
};

export default function ComposerClient({ connections, initialCaption, initialDate, initialPost }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const postId = initialPost?.id ?? null;
  const isEdit = Boolean(postId);

  const defaultChannel: Channel =
    (initialPost?.channel as Channel) ??
    (connections.facebook && connections.instagram
      ? "BOTH"
      : connections.facebook
        ? "FACEBOOK"
        : connections.instagram
          ? "INSTAGRAM"
          : "BOTH");

  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [caption, setCaption] = useState<string>(initialPost?.caption ?? initialCaption ?? "");
  const [mediaUrls, setMediaUrls] = useState<string[]>(initialPost?.mediaUrls ?? []);
  const [mode, setMode] = useState<"now" | "schedule">(
    initialPost?.scheduledFor || initialDate ? "schedule" : "now",
  );
  const [scheduledLocal, setScheduledLocal] = useState<string>(
    initialPost?.scheduledFor
      ? isoToLocalInput(initialPost.scheduledFor)
      : initialDate
        ? `${initialDate}T09:00`
        : "",
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowLocalMin = useMemo(() => isoToLocalInput(new Date().toISOString()), []);
  const captionLimit = useMemo(
    () => CHANNEL_META.find((c) => c.value === channel)?.limit ?? 2200,
    [channel],
  );

  // ── reglas de habilitación ────────────────────────────────────────
  const needsInstagram = channel !== "FACEBOOK";
  const channelConnected =
    channel === "BOTH"
      ? connections.facebook && connections.instagram
      : channel === "FACEBOOK"
        ? connections.facebook
        : connections.instagram;
  const missingImage = needsInstagram && mediaUrls.length === 0;
  const emptyCaption = caption.trim().length === 0;
  const overLimit = caption.length > captionLimit;

  const draftDisabled = saving || uploading || emptyCaption || overLimit;
  const scheduleDisabled = draftDisabled || missingImage || !scheduledLocal;
  const publishNowDisabled = draftDisabled || missingImage || !channelConnected;

  // ── handlers ──────────────────────────────────────────────────────
  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const remaining = MAX_MEDIA - mediaUrls.length;
      if (remaining <= 0) {
        toast.error(`Máximo ${MAX_MEDIA} imágenes por publicación`);
        return;
      }
      const list = Array.from(files).slice(0, remaining);
      setUploading(true);
      setError(null);
      try {
        for (let i = 0; i < list.length; i++) {
          const fd = new FormData();
          fd.append("file", list[i]);
          const res = await fetch("/api/marketing/upload", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data?.error ?? "No se pudo subir la imagen");
            continue;
          }
          if (data.url) setMediaUrls((prev) => [...prev, data.url]);
        }
      } catch {
        toast.error("Error al subir la imagen");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [mediaUrls.length],
  );

  const removeImage = useCallback((idx: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = useCallback(
    async (intent: "DRAFT" | "SCHEDULED" | "NOW") => {
      if (emptyCaption) {
        setError("Escribe el texto de la publicación");
        return;
      }
      if (overLimit) {
        setError(`El texto supera el límite de ${captionLimit} caracteres`);
        return;
      }
      if ((intent === "SCHEDULED" || intent === "NOW") && missingImage) {
        setError("Instagram requiere al menos una imagen");
        return;
      }

      const payload: any = { channel, caption: caption.trim(), mediaUrls };

      if (intent === "DRAFT") {
        payload.status = "DRAFT";
      } else if (intent === "SCHEDULED") {
        const iso = localInputToISO(scheduledLocal);
        if (!iso) {
          setError("Elige una fecha y hora para programar");
          return;
        }
        if (new Date(iso).getTime() <= Date.now()) {
          setError("La fecha debe ser futura");
          return;
        }
        payload.status = "SCHEDULED";
        payload.scheduledFor = iso;
      } else if (intent === "NOW") {
        // Tanto crear como editar usan publishNow: el server valida conexión y fija fecha=ahora.
        payload.publishNow = true;
      }

      if (!isEdit) {
        payload.aiGenerated = Boolean(initialCaption);
      }

      setSaving(true);
      setError(null);
      try {
        const url = isEdit ? `/api/marketing/posts/${postId}` : `/api/marketing/posts`;
        const res = await fetch(url, {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 503) {
            const hint = data?.hint ?? "Marketing aún no está activo en esta clínica.";
            setError(hint);
            toast.error(hint);
            return;
          }
          const msg = data?.issues?.[0]?.message ?? data?.hint ?? data?.error ?? "No se pudo guardar";
          setError(msg);
          toast.error(msg);
          return;
        }
        toast.success(
          intent === "DRAFT"
            ? "Borrador guardado"
            : intent === "NOW"
              ? "Publicación enviada"
              : "Publicación programada",
        );
        router.push("/dashboard/marketing/calendar");
        router.refresh();
      } catch {
        setError("Error de red. Inténtalo de nuevo.");
        toast.error("Error de red");
      } finally {
        setSaving(false);
      }
    },
    [
      channel,
      caption,
      mediaUrls,
      scheduledLocal,
      emptyCaption,
      overLimit,
      missingImage,
      captionLimit,
      isEdit,
      postId,
      initialCaption,
      router,
    ],
  );

  // ── render ────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
      {/* Columna editor */}
      <div style={{ flex: "1 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text-1)" }}>
            {isEdit ? "Editar publicación" : "Crear publicación"}
          </h2>
          {initialCaption && !isEdit ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--brand)",
                background: "var(--brand-soft)",
                padding: "3px 8px",
                borderRadius: 8,
              }}
            >
              <Sparkles size={12} aria-hidden /> Desde Estudio IA
            </span>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              color: "var(--danger)",
              background: "var(--danger-soft)",
              border: "1px solid var(--danger)",
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Selector de canal */}
        <div style={card}>
          <span style={labelStyle}>Canal</span>
          <div role="group" aria-label="Canal de publicación" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHANNEL_META.map((c) => {
              const Icon = c.icon;
              const active = channel === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setChannel(c.value)}
                  style={{
                    ...baseBtn,
                    flex: "1 1 110px",
                    color: active ? "var(--brand)" : "var(--text-2)",
                    background: active ? "var(--brand-soft)" : "var(--bg-elev-2)",
                    borderColor: active ? "var(--border-brand)" : "transparent",
                  }}
                >
                  <Icon size={16} aria-hidden />
                  {c.label}
                </button>
              );
            })}
          </div>
          {!channelConnected ? (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--warning)", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={13} aria-hidden />
              {channel === "BOTH"
                ? "Conecta Facebook e Instagram para poder publicar."
                : `${channel === "FACEBOOK" ? "Facebook" : "Instagram"} no está conectado. Podrás programar, pero no publicar al instante.`}
            </p>
          ) : null}
        </div>

        {/* Texto */}
        <div style={card}>
          <label htmlFor="mkt-caption" style={labelStyle}>
            Texto de la publicación
          </label>
          <textarea
            id="mkt-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escribe aquí tu publicación… ¿Qué quieres contarle a tus pacientes?"
            rows={7}
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              minHeight: 130,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              color: "var(--text-1)",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <span
              aria-live="polite"
              aria-label={`${caption.length} de ${captionLimit} caracteres${overLimit ? ", superas el límite" : ""}`}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: overLimit ? "var(--danger)" : caption.length > captionLimit * 0.9 ? "var(--warning)" : "var(--text-3)",
              }}
            >
              {caption.length} / {captionLimit}
            </span>
          </div>
        </div>

        {/* Imágenes */}
        <div style={card}>
          <span style={labelStyle}>Imágenes {needsInstagram ? "(Instagram requiere al menos una)" : "(opcional)"}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(e) => onPickFiles(e.target.files)}
            style={{ display: "none" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {mediaUrls.map((u, i) => (
              <div
                key={`${u}-${i}`}
                style={{
                  position: "relative",
                  width: 84,
                  height: 84,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-elev-2)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Imagen ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button
                  type="button"
                  aria-label={`Quitar imagen ${i + 1}`}
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    color: "#fff",
                    background: "rgba(15,10,30,0.65)",
                  }}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
            {mediaUrls.length < MAX_MEDIA ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-busy={uploading}
                aria-label={uploading ? "Subiendo imagen" : "Añadir imagen"}
                style={{
                  width: 84,
                  height: 84,
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-3)",
                  background: "var(--bg-elev-2)",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: 10,
                  cursor: uploading ? "wait" : "pointer",
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                {uploading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ImagePlus size={18} aria-hidden />}
                {uploading ? "Subiendo…" : "Añadir"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Cuándo publicar */}
        <div style={card}>
          <span style={labelStyle}>¿Cuándo se publica?</span>
          <div role="group" aria-label="Momento de publicación" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              aria-pressed={mode === "now"}
              onClick={() => setMode("now")}
              style={{
                ...baseBtn,
                flex: 1,
                color: mode === "now" ? "var(--brand)" : "var(--text-2)",
                background: mode === "now" ? "var(--brand-soft)" : "var(--bg-elev-2)",
                borderColor: mode === "now" ? "var(--border-brand)" : "transparent",
              }}
            >
              <Send size={15} aria-hidden /> Publicar ahora
            </button>
            <button
              type="button"
              aria-pressed={mode === "schedule"}
              onClick={() => setMode("schedule")}
              style={{
                ...baseBtn,
                flex: 1,
                color: mode === "schedule" ? "var(--brand)" : "var(--text-2)",
                background: mode === "schedule" ? "var(--brand-soft)" : "var(--bg-elev-2)",
                borderColor: mode === "schedule" ? "var(--border-brand)" : "transparent",
              }}
            >
              <CalendarClock size={15} aria-hidden /> Programar
            </button>
          </div>
          {mode === "schedule" ? (
            <div>
              <label htmlFor="mkt-when" style={labelStyle}>
                Fecha y hora
              </label>
              <input
                id="mkt-when"
                type="datetime-local"
                value={scheduledLocal}
                min={nowLocalMin}
                onChange={(e) => setScheduledLocal(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 44,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  color: "var(--text-1)",
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  outline: "none",
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Acciones */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            onClick={() => submit("DRAFT")}
            disabled={draftDisabled}
            aria-busy={saving}
            style={{
              ...baseBtn,
              color: "var(--text-1)",
              background: "var(--bg-elev-2)",
              borderColor: "var(--border-soft)",
              opacity: draftDisabled ? 0.5 : 1,
              cursor: draftDisabled ? "not-allowed" : "pointer",
            }}
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
            Guardar borrador
          </button>

          {mode === "schedule" ? (
            <button
              type="button"
              onClick={() => submit("SCHEDULED")}
              disabled={scheduleDisabled}
              aria-busy={saving}
              style={{
                ...baseBtn,
                flex: "1 1 200px",
                color: "#fff",
                background: "var(--brand)",
                boxShadow: scheduleDisabled ? "none" : "0 4px 16px -6px rgba(124,58,237,0.6)",
                opacity: scheduleDisabled ? 0.5 : 1,
                cursor: scheduleDisabled ? "not-allowed" : "pointer",
              }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CalendarClock size={16} aria-hidden />}
              {isEdit ? "Guardar y programar" : "Programar publicación"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit("NOW")}
              disabled={publishNowDisabled}
              aria-busy={saving}
              title={!channelConnected ? "Conecta tu red social para publicar al instante" : undefined}
              style={{
                ...baseBtn,
                flex: "1 1 200px",
                color: "#fff",
                background: "var(--brand)",
                boxShadow: publishNowDisabled ? "none" : "0 4px 16px -6px rgba(124,58,237,0.6)",
                opacity: publishNowDisabled ? 0.5 : 1,
                cursor: publishNowDisabled ? "not-allowed" : "pointer",
              }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
              Publicar ahora
            </button>
          )}
        </div>
      </div>

      {/* Columna preview */}
      <div style={{ flex: "0 1 360px", minWidth: 280, position: "sticky", top: 12 }}>
        <span style={labelStyle}>Vista previa</span>
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "var(--brand-soft)",
                color: "var(--brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Megaphone size={18} aria-hidden />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>Tu clínica</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
                {(channel === "FACEBOOK" || channel === "BOTH") ? <Facebook size={12} aria-hidden /> : null}
                {(channel === "INSTAGRAM" || channel === "BOTH") ? <Instagram size={12} aria-hidden /> : null}
                <span>{mode === "schedule" && scheduledLocal ? "Programado" : "Ahora"}</span>
              </div>
            </div>
          </div>

          <div
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              background: "var(--bg-elev-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {mediaUrls.length > 0 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrls[0]} alt="Vista previa" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {mediaUrls.length > 1 ? (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 8,
                      right: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#fff",
                      background: "rgba(15,10,30,0.65)",
                      padding: "2px 8px",
                      borderRadius: 8,
                    }}
                  >
                    +{mediaUrls.length - 1}
                  </span>
                ) : null}
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <ImagePlus size={26} aria-hidden />
                Sin imagen
              </span>
            )}
          </div>

          <div style={{ padding: "12px 14px" }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.55,
                color: caption.trim() ? "var(--text-1)" : "var(--text-3)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {caption.trim() ? caption : "Tu texto aparecerá aquí…"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
