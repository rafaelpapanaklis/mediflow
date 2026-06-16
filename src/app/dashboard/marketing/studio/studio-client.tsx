"use client";

// Estudio IA — UI del generador (WS-MKT-T2).
// Selector de modo + inputs → POST /api/marketing/generate → tarjetas con acciones
// (Copiar, Enviar al Composer, Guardar en Biblioteca). Medidor de tokens IA.
// Diseño: tokens CSS del panel (var(--brand), var(--bg-elev)…) → claro/oscuro automático.

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Lightbulb,
  Type,
  CalendarDays,
  Hash,
  Image as ImageIcon,
  Instagram,
  Facebook,
  Sparkles,
  Wand2,
  Copy,
  Check,
  Send,
  BookmarkPlus,
  Loader2,
  AlertCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { StudioMode, Channel } from "@/lib/marketing/types";

interface TokenInfo {
  used: number;
  limit: number;
  remaining: number;
}

interface ModeDef {
  id: StudioMode;
  label: string;
  icon: LucideIcon;
  hint: string;
  countLabel?: string;
  countMin?: number;
  countMax?: number;
  countDefault?: number;
  placeholder: string;
}

const MODES: ModeDef[] = [
  {
    id: "ideas",
    label: "Ideas",
    icon: Lightbulb,
    hint: "Lluvia de ideas de publicaciones para tu clínica.",
    countLabel: "Ideas",
    countMin: 1,
    countMax: 12,
    countDefault: 6,
    placeholder: "Ej: promoción de limpieza dental de temporada",
  },
  {
    id: "caption",
    label: "Captions",
    icon: Type,
    hint: "Textos listos para publicar, con gancho y llamada a la acción.",
    countLabel: "Variantes",
    countMin: 1,
    countMax: 6,
    countDefault: 3,
    placeholder: "Ej: nuevo tratamiento de blanqueamiento",
  },
  {
    id: "calendar",
    label: "Calendario",
    icon: CalendarDays,
    hint: "Plan de contenido día por día, con tema y canal.",
    countLabel: "Días",
    countMin: 1,
    countMax: 30,
    countDefault: 7,
    placeholder: "Ej: enfoque del mes en salud preventiva (opcional)",
  },
  {
    id: "hashtags",
    label: "Hashtags",
    icon: Hash,
    hint: "Grupos de hashtags: amplios, de nicho y locales.",
    placeholder: "Ej: ortodoncia invisible",
  },
  {
    id: "image_brief",
    label: "Briefs de imagen",
    icon: ImageIcon,
    hint: "Describe la foto o diseño a producir (no genera la imagen).",
    countLabel: "Briefs",
    countMin: 1,
    countMax: 6,
    countDefault: 3,
    placeholder: "Ej: antes y después de un tratamiento facial",
  },
];

const CHANNELS: { id: Channel; label: string; icon: LucideIcon | null }[] = [
  { id: "INSTAGRAM", label: "Instagram", icon: Instagram },
  { id: "FACEBOOK", label: "Facebook", icon: Facebook },
  { id: "BOTH", label: "Ambos", icon: null },
];

const TONES = ["Cercano", "Profesional", "Divertido", "Inspirador", "Promocional", "Educativo", "Empático"];

const KIND_MAP: Record<StudioMode, string> = {
  ideas: "IDEA",
  caption: "CAPTION",
  calendar: "CAMPAIGN",
  hashtags: "CAPTION",
  image_brief: "IMAGE_BRIEF",
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cae al fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function StudioClient({ initialTokens }: { initialTokens: TokenInfo | null }) {
  const router = useRouter();

  const [mode, setMode] = useState<StudioMode>("ideas");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [channel, setChannel] = useState<Channel>("INSTAGRAM");
  const [count, setCount] = useState(6);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [tokens, setTokens] = useState<TokenInfo | null>(initialTokens);
  const [result, setResult] = useState<{ mode: StudioMode; items: string[]; model?: string } | null>(null);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeMode = useMemo(() => MODES.find((m) => m.id === mode) ?? MODES[0], [mode]);
  const showCount = !!activeMode.countLabel;

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const selectMode = useCallback((m: ModeDef) => {
    setMode(m.id);
    setCount(m.countDefault ?? 6);
    setError(null);
  }, []);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLimitReached(false);
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          topic: topic.trim() || undefined,
          tone: tone.trim() || undefined,
          channel,
          count: showCount ? count : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.limitReached) {
          setLimitReached(true);
          setTokens({ used: data.used ?? 0, limit: data.limit ?? 0, remaining: 0 });
        }
        setError(data?.error || "No se pudo generar. Intenta de nuevo.");
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setResult({ mode: data.mode, items, model: data.model });
      if (items.length === 0) {
        setError(data.warning || "No se obtuvieron resultados. Intenta de nuevo o ajusta el tema.");
      }
      if (typeof data.tokensRemaining === "number" && typeof data.tokensLimit === "number") {
        setTokens({
          used: data.tokensLimit - data.tokensRemaining,
          limit: data.tokensLimit,
          remaining: data.tokensRemaining,
        });
      }
    } catch {
      setError("Error de red. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [mode, topic, tone, channel, count, showCount]);

  const onCopy = useCallback(async (text: string, idx: number) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } else {
      flashToast("No se pudo copiar.");
    }
  }, [flashToast]);

  const onSendToComposer = useCallback(
    (text: string) => {
      router.push(`/dashboard/marketing/composer?caption=${encodeURIComponent(text)}`);
    },
    [router],
  );

  const onSaveTemplate = useCallback(
    async (text: string, idx: number) => {
      if (!result) return;
      setSavingIdx(idx);
      try {
        const res = await fetch("/api/marketing/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: KIND_MAP[result.mode],
            title: (topic.trim() || activeMode.label).slice(0, 60),
            body: text,
            tags: [result.mode],
          }),
        });
        if (res.status === 404) {
          flashToast("La Biblioteca aún no está disponible.");
          return;
        }
        if (!res.ok) {
          flashToast("No se pudo guardar la plantilla.");
          return;
        }
        setSavedIdx(idx);
        setTimeout(() => setSavedIdx((s) => (s === idx ? null : s)), 1800);
      } catch {
        flashToast("La Biblioteca aún no está disponible.");
      } finally {
        setSavingIdx(null);
      }
    },
    [result, topic, activeMode.label, flashToast],
  );

  // ── Medidor de tokens ────────────────────────────────────────────────────────
  const meter = (() => {
    if (!tokens || tokens.limit <= 0) return null;
    const ratio = tokens.remaining / tokens.limit;
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    const color =
      tokens.remaining <= 0 ? "var(--danger)" : ratio < 0.15 ? "var(--warning)" : "var(--brand)";
    return (
      <div
        style={{
          minWidth: 200,
          padding: "10px 14px",
          borderRadius: 12,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
        }}
        aria-label={`Tokens de IA restantes: ${tokens.remaining.toLocaleString("es-MX")} de ${tokens.limit.toLocaleString("es-MX")}`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>
            <Zap size={13} aria-hidden style={{ color }} /> Tokens IA
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            {tokens.remaining.toLocaleString("es-MX")}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "var(--bg-elev-2)", marginTop: 7, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .3s" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>
          de {tokens.limit.toLocaleString("es-MX")} este mes
        </div>
      </div>
    );
  })();

  const singleColumn = result && (result.mode === "calendar" || result.mode === "hashtags");
  const degraded = result?.model?.includes("haiku");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{STYLES}</style>

      {/* Encabezado de sección + medidor */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text-1)" }}>
            <Sparkles size={18} aria-hidden style={{ color: "var(--brand)" }} />
            Generador con IA
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 560 }}>
            Crea ideas, captions, hashtags, calendarios y briefs de imagen, personalizados para tu clínica.
          </p>
        </div>
        {meter}
      </div>

      {/* Panel de controles */}
      <div
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(14px, 2vw, 20px)",
        }}
      >
        {/* Chips de modo */}
        <div role="group" aria-label="Tipo de contenido" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                className="mkt-chip"
                aria-pressed={active}
                onClick={() => selectMode(m)}
              >
                <Icon size={15} aria-hidden style={{ flexShrink: 0 }} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* Inputs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {/* Tema (ancho completo) */}
          <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={FIELD_LABEL}>Tema o enfoque {mode === "calendar" || mode === "ideas" ? "(opcional)" : ""}</span>
            <input
              className="mkt-input"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={activeMode.placeholder}
              maxLength={300}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) generate();
              }}
            />
          </label>

          {/* Tono */}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={FIELD_LABEL}>Tono</span>
            <input
              className="mkt-input"
              type="text"
              list="mkt-tones"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="Cercano y profesional"
              maxLength={60}
            />
            <datalist id="mkt-tones">
              {TONES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          {/* Canal */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={FIELD_LABEL}>Canal</span>
            <div role="group" aria-label="Canal" style={{ display: "flex", gap: 4, background: "var(--bg)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: 3 }}>
              {CHANNELS.map((c) => {
                const Icon = c.icon;
                const active = c.id === channel;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="mkt-seg"
                    aria-pressed={active}
                    onClick={() => setChannel(c.id)}
                    style={{ flex: 1 }}
                  >
                    {Icon ? <Icon size={14} aria-hidden /> : null}
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cantidad (según modo) */}
          {showCount && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 160 }}>
              <span style={FIELD_LABEL}>{activeMode.countLabel}</span>
              <input
                className="mkt-input"
                type="number"
                min={activeMode.countMin ?? 1}
                max={activeMode.countMax ?? 12}
                value={count}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  const min = activeMode.countMin ?? 1;
                  const max = activeMode.countMax ?? 12;
                  setCount(Number.isNaN(v) ? min : Math.min(Math.max(v, min), max));
                }}
              />
            </label>
          )}
        </div>

        {/* Generar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 18 }}>
          <button
            type="button"
            className="mkt-btn-primary"
            onClick={generate}
            aria-busy={loading}
            disabled={loading || (!!tokens && tokens.remaining <= 0)}
          >
            {loading ? (
              <>
                <Loader2 size={16} aria-hidden className="mkt-spin" /> Generando…
              </>
            ) : (
              <>
                <Wand2 size={16} aria-hidden /> Generar
              </>
            )}
          </button>
          <span style={{ fontSize: 12.5, color: "var(--text-3)", maxWidth: 380 }}>{activeMode.hint}</span>
        </div>
      </div>

      {/* Aviso de error / límite */}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 12,
            fontSize: 13.5,
            color: limitReached ? "var(--warning)" : "var(--danger)",
            background: limitReached ? "var(--warning-soft)" : "var(--danger-soft)",
            border: `1px solid ${limitReached ? "var(--warning)" : "var(--danger)"}`,
          }}
        >
          <AlertCircle size={17} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ minWidth: 0, wordBreak: "break-word" }}>{error}</span>
        </div>
      )}

      {/* Resultados / estados */}
      {loading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Generando contenido con IA"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="mkt-skel" aria-hidden style={{ height: 150, borderRadius: 14 }} />
          ))}
        </div>
      ) : result && result.items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {degraded && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Zap size={12} aria-hidden style={{ color: "var(--warning)" }} />
              Generado en modo económico para cuidar tus tokens.
            </p>
          )}
          <div
            style={
              singleColumn
                ? { display: "flex", flexDirection: "column", gap: 12 }
                : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }
            }
          >
            {result.items.map((item, idx) => (
              <article key={idx} className="mkt-card">
                <p
                  style={{
                    margin: 0,
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "var(--text-1)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    flex: 1,
                  }}
                >
                  {item}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                  <button type="button" className="mkt-iconbtn" onClick={() => onCopy(item, idx)} title="Copiar">
                    {copiedIdx === idx ? (
                      <>
                        <Check size={14} aria-hidden style={{ color: "var(--success)" }} /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy size={14} aria-hidden /> Copiar
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="mkt-iconbtn"
                    onClick={() => onSendToComposer(item)}
                    title="Enviar al Composer"
                    aria-label="Enviar este texto al Composer"
                  >
                    <Send size={14} aria-hidden /> Al Composer
                  </button>
                  <button
                    type="button"
                    className="mkt-iconbtn"
                    onClick={() => onSaveTemplate(item, idx)}
                    disabled={savingIdx === idx}
                    title="Guardar como plantilla"
                  >
                    {savedIdx === idx ? (
                      <>
                        <Check size={14} aria-hidden style={{ color: "var(--success)" }} /> Guardado
                      </>
                    ) : savingIdx === idx ? (
                      <>
                        <Loader2 size={14} aria-hidden className="mkt-spin" /> Guardando
                      </>
                    ) : (
                      <>
                        <BookmarkPlus size={14} aria-hidden /> Guardar
                      </>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 10,
            padding: "clamp(36px, 7vw, 72px) 24px",
            border: "1px dashed var(--border-soft)",
            borderRadius: 16,
            background: "var(--bg-elev)",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              color: "var(--brand)",
            }}
          >
            <Sparkles size={24} aria-hidden />
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
            Listo para crear contenido
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", maxWidth: 420 }}>
            Elige un tipo de contenido, escribe un tema y pulsa <strong>Generar</strong>. La IA usa la
            especialidad de tu clínica para personalizar todo.
          </p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--text-1)",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

const FIELD_LABEL: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

const STYLES = `
.mkt-chip {
  display: inline-flex; align-items: center; gap: 7px;
  min-height: 36px; padding: 8px 13px; font-size: 13px; font-weight: 500; cursor: pointer;
  color: var(--text-2); background: var(--bg);
  border: 1px solid var(--border-soft); border-radius: 10px;
  transition: background .12s, color .12s, border-color .12s;
}
.mkt-chip:hover { background: var(--bg-hover); color: var(--text-1); }
.mkt-chip[aria-pressed="true"] {
  color: var(--brand); background: var(--brand-soft); border-color: var(--border-brand); font-weight: 600;
}
.mkt-seg {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 10px; font-size: 12.5px; font-weight: 500; cursor: pointer;
  color: var(--text-2); background: transparent; border: none; border-radius: 8px;
  transition: background .12s, color .12s; white-space: nowrap;
}
.mkt-seg:hover { color: var(--text-1); }
.mkt-seg[aria-pressed="true"] { color: var(--brand); background: var(--bg-elev); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.mkt-input {
  width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px;
  color: var(--text-1); background: var(--bg);
  border: 1px solid var(--border-soft); border-radius: 10px; outline: none;
  transition: border-color .12s, box-shadow .12s; font-family: inherit;
}
.mkt-input::placeholder { color: var(--text-4); }
.mkt-input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-softer); }
.mkt-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer;
  color: #fff; background: var(--brand); border: none; border-radius: 11px;
  transition: filter .12s, opacity .12s;
}
.mkt-btn-primary:hover { filter: brightness(1.07); }
.mkt-btn-primary:disabled { opacity: .55; cursor: not-allowed; filter: none; }
.mkt-card {
  display: flex; flex-direction: column;
  padding: 15px; border-radius: 14px;
  background: var(--bg-elev); border: 1px solid var(--border-soft);
  transition: border-color .12s, box-shadow .12s;
}
.mkt-card:hover { border-color: var(--border-strong); box-shadow: 0 4px 18px rgba(0,0,0,0.06); }
.mkt-iconbtn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 36px; padding: 8px 12px; font-size: 12.5px; font-weight: 500; cursor: pointer;
  color: var(--text-2); background: transparent;
  border: 1px solid var(--border-soft); border-radius: 8px;
  transition: background .12s, color .12s, border-color .12s;
}
.mkt-iconbtn:hover { background: var(--bg-hover); color: var(--text-1); border-color: var(--border-interactive); }
.mkt-iconbtn:disabled { opacity: .6; cursor: default; }
.mkt-spin { animation: mkt-spin 0.8s linear infinite; }
@keyframes mkt-spin { to { transform: rotate(360deg); } }
.mkt-skel {
  background: linear-gradient(90deg, var(--bg-elev) 25%, var(--bg-elev-2) 37%, var(--bg-elev) 63%);
  background-size: 400% 100%; animation: mkt-shimmer 1.4s ease infinite;
  border: 1px solid var(--border-soft);
}
@keyframes mkt-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
`;
