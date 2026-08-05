"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /afiliados/soporte/[id] — hilo del ticket, estilo chat.
// Burbujas por authorType (afiliado a la derecha, soporte a la izquierda,
// `system` centrado). Al abrir se marca como leído.
// API: GET /api/afiliados/soporte/[id] · PATCH (marcar leído)
//      POST /api/afiliados/soporte/[id]/messages
// Contrato: src/lib/affiliate-support/types.ts.
//
// Lenguaje visual del panel de afiliados: primitivas de
// components/afiliados/ui/panel-ui + clases `dcafp-*` de
// src/app/afiliados/panel.css. Las burbujas son el único bloque con estilo
// inline "de una sola vez": no hay patrón de chat en panel.css.
//
// Las notas internas NUNCA llegan a este endpoint (el service las descarta en
// el where de Prisma), pero igual NO se renderiza nada con internalNote=true:
// defensa en profundidad, misma regla que en el hilo de la clínica.
//
// ⚠️ Sin adjuntos en esta ola (no existe el bucket): el composer es solo texto.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, LifeBuoy, Loader2, Send } from "lucide-react";
import { Chip, EmptyState, PageHead, PanelCard, Note, type ChipTone } from "@/components/afiliados/ui/panel-ui";
import {
  AFFILIATE_SUPPORT_CATEGORY_LABELS,
  AFFILIATE_SUPPORT_MAX_BODY_CHARS,
  AFFILIATE_SUPPORT_PRIORITY_LABELS,
  AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE,
} from "@/lib/affiliate-support/types";
import type {
  AffiliateSupportMessageDTO,
  AffiliateTicketSummary,
} from "@/lib/affiliate-support/types";

// MISMO mapa que en soporte-client.tsx — mantener en sincronía. `Chip` no
// tiene tono "info": ABIERTO y EN_PROGRESO caen los dos en `brand`.
const STATUS_TONES: Record<string, ChipTone> = {
  ABIERTO: "brand",
  EN_PROGRESO: "brand",
  ESPERANDO_RESPUESTA: "amber",
  RESUELTO: "ok",
  CERRADO: "neutral",
};

const PRIORITY_TONES: Record<string, ChipTone> = {
  URGENTE: "danger",
  ALTA: "amber",
  NORMAL: "neutral",
  BAJA: "neutral",
};

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleString("es-MX", opts);
}

/** Iniciales del avatar de la burbuja. Dos como máximo: con tres son ilegibles. */
function initialsOf(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Enlace de regreso — el mismo en las cuatro salidas de la pantalla. */
function BackToSupport({ label = "Soporte" }: { label?: string }) {
  return (
    <Link
      href="/afiliados/soporte"
      className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
      style={{ alignSelf: "flex-start" }}
    >
      <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
      {label}
    </Link>
  );
}

// ── Burbuja de mensaje ──────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AffiliateSupportMessageDTO }) {
  const time = formatMsgTime(msg.createdAt);

  // Los `system` (cambios de estado) van centrados y en tono tenue: son del
  // sistema, no de una persona.
  if (msg.authorType === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "0 8px" }}>
        <div style={{ maxWidth: "80%", textAlign: "center", minWidth: 0 }}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, fontStyle: "italic", color: "var(--dcafp-ink-3)" }}>
            {msg.body}
          </p>
          {time && (
            <p className="dcafp-nums" style={{ margin: 0, marginTop: 2, fontSize: 11, color: "var(--dcafp-ink-4)" }}>
              {time}
            </p>
          )}
        </div>
      </div>
    );
  }

  const isAffiliate = msg.authorType === "affiliate";
  const authorLabel = isAffiliate
    ? (msg.authorName || "Tú")
    : (msg.authorName || "Soporte DaleControl");

  const avatar = (
    <span
      className="dcafp-avatar"
      aria-hidden
      style={{
        width: 32,
        height: 32,
        fontSize: 11.5,
        marginTop: 4,
        // El staff se distingue del afiliado también en el avatar: gris contra
        // el lila de marca.
        background: isAffiliate ? "var(--dcafp-brand-75)" : "var(--dcafp-surface-2)",
        color: isAffiliate ? "var(--dcafp-brand-deep)" : "var(--dcafp-ink-2)",
        border: isAffiliate ? "1px solid var(--dcafp-brand-100)" : "1px solid var(--dcafp-line)",
      }}
    >
      {initialsOf(authorLabel)}
    </span>
  );

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 9, justifyContent: isAffiliate ? "flex-end" : "flex-start" }}>
      {!isAffiliate && avatar}
      <div
        style={{
          maxWidth: "78%",
          minWidth: 0,
          padding: "11px 14px",
          borderRadius: "var(--dcafp-r-box)",
          background: isAffiliate ? "var(--dcafp-brand-50)" : "var(--dcafp-surface-2)",
          border: isAffiliate ? "1px solid var(--dcafp-brand-100)" : "1px solid var(--dcafp-line)",
        }}
      >
        <p
          style={{
            margin: 0,
            marginBottom: 4,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: "0.2px",
            color: isAffiliate ? "var(--dcafp-brand-deep)" : "var(--dcafp-ink-2)",
            overflowWrap: "anywhere",
          }}
        >
          {authorLabel}
        </p>
        {/* Texto plano siempre — nunca HTML. */}
        <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13.5, lineHeight: 1.6, color: "var(--dcafp-ink)" }}>
          {msg.body}
        </p>
        {time && (
          <p
            className="dcafp-nums"
            style={{ margin: 0, marginTop: 5, fontSize: 11, color: "var(--dcafp-ink-3)", textAlign: isAffiliate ? "right" : "left" }}
          >
            {time}
          </p>
        )}
      </div>
      {isAffiliate && avatar}
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export function TicketAfiliadoClient({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<AffiliateTicketSummary | null>(null);
  const [messages, setMessages] = useState<AffiliateSupportMessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadTicket = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts && opts.silent;
    if (!silent) { setLoading(true); setLoadError(false); }
    try {
      const res = await fetch(`/api/afiliados/soporte/${ticketId}`, { cache: "no-store" });
      // 404 = no existe O no es suyo: el servidor no distingue a propósito.
      if (res.status === 404) {
        setNotFound(true);
        setTicket(null);
        setMessages([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTicket(data && data.ticket ? data.ticket : null);
      setMessages(data && Array.isArray(data.messages) ? data.messages : []);
      setNotFound(false);
      setLoadError(false);
    } catch {
      if (silent) toast.error("No se pudo actualizar el hilo.");
      else setLoadError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  // Abrir el ticket ES leerlo: se apaga el badge "respuesta nueva" de la lista.
  // Va aparte del GET (que es una lectura pura) y es best-effort: si falla, el
  // badge sigue encendido y no pasa nada grave.
  useEffect(() => {
    if (!ticket) return;
    fetch(`/api/afiliados/soporte/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }).catch(() => { /* silencioso a propósito */ });
    // Solo al cargar el ticket por primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket ? ticket.id : null]);

  // Defensa extra: nunca renderizar notas internas, y orden cronológico.
  const visibleMessages = useMemo(() => {
    return messages
      .filter((m) => m && m.internalNote !== true)
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [messages]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/afiliados/soporte/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      let data: any = null;
      try { data = await res.json(); } catch { /* respuesta sin JSON */ }
      if (res.status === 409) {
        toast.error((data && data.error) || "Este ticket está cerrado.");
        await loadTicket({ silent: true });
        return;
      }
      if (!res.ok) {
        toast.error((data && data.error) || "No se pudo enviar el mensaje.");
        return;
      }
      setBody("");
      await loadTicket({ silent: true });
      scrollToBottom();
    } catch {
      toast.error("Error de red al enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      if ((e.nativeEvent as any).isComposing) return;
      e.preventDefault();
      handleSend();
    }
  }

  // ── Estados de página ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <PanelCard>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "44px 0" }}>
          <Loader2 size={18} strokeWidth={1.9} className="animate-spin" style={{ color: "var(--dcafp-ink-3)" }} aria-hidden />
          <p style={{ fontSize: 13, color: "var(--dcafp-ink-3)" }}>Cargando ticket…</p>
        </div>
      </PanelCard>
    );
  }

  if (notFound) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BackToSupport />
        <PanelCard>
          <EmptyState
            icon={<LifeBuoy size={22} strokeWidth={1.8} />}
            title="Ticket no encontrado"
            action={
              <Link href="/afiliados/soporte" className="dcafp-btn dcafp-btn--outline">
                <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
                Volver a Soporte
              </Link>
            }
          >
            Puede que el enlace sea incorrecto o que ese ticket no sea tuyo.
          </EmptyState>
        </PanelCard>
      </div>
    );
  }

  if (loadError || !ticket) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BackToSupport />
        <PanelCard>
          <EmptyState
            icon={<LifeBuoy size={22} strokeWidth={1.8} />}
            title="No se pudo cargar el ticket"
            action={
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <button type="button" className="dcafp-btn dcafp-btn--primary" onClick={() => loadTicket()}>
                  Reintentar
                </button>
                <Link href="/afiliados/soporte" className="dcafp-btn">
                  <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
                  Soporte
                </Link>
              </div>
            }
          >
            Revisa tu conexión e inténtalo de nuevo.
          </EmptyState>
        </PanelCard>
      </div>
    );
  }

  const isClosed = ticket.status === "CERRADO";
  const statusLabel = AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE[ticket.status] || ticket.status;
  const statusTone = STATUS_TONES[ticket.status] || "neutral";
  const categoryLabel = AFFILIATE_SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = AFFILIATE_SUPPORT_PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const priorityTone = PRIORITY_TONES[ticket.priority] || "neutral";
  const nearLimit = body.length > AFFILIATE_SUPPORT_MAX_BODY_CHARS - 500;

  return (
    // `overflowWrap` se hereda: un asunto de una sola palabra larguísima corta
    // dentro del <h1> de PageHead sin desbordar a 375px.
    <div style={{ maxWidth: 820, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14, minWidth: 0, overflowWrap: "anywhere" }}>
      <BackToSupport />

      <PageHead
        title={ticket.subject}
        sub={
          <>
            <span className="dcafp-mono">{ticket.folioLabel}</span>
            {" · "}Creado el {formatDateLong(ticket.createdAt)}
          </>
        }
        action={<Chip tone={statusTone} dot>{statusLabel}</Chip>}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip sm>{categoryLabel}</Chip>
        <Chip tone={priorityTone} dot sm>Prioridad: {priorityLabel}</Chip>
      </div>

      {/* Hilo */}
      <PanelCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {visibleMessages.length === 0 ? (
            <p style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "var(--dcafp-ink-3)" }}>
              Aún no hay mensajes en este ticket.
            </p>
          ) : (
            visibleMessages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
          <div ref={bottomRef} aria-hidden />
        </div>
      </PanelCard>

      {/* Composer / aviso de cerrado */}
      {isClosed ? (
        <Note>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>Este ticket está cerrado.</span>
            {typeof ticket.rating === "number" && ticket.rating >= 1 && (
              <span style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
                Calificación:{" "}
                <span style={{ color: "var(--dcafp-amber)" }}>{"★".repeat(Math.min(5, ticket.rating))}</span>{" "}
                <span className="dcafp-nums">({ticket.rating}/5)</span>
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
              Si necesitas algo más, crea un ticket nuevo y te atendemos.
            </span>
            <Link href="/afiliados/soporte" className="dcafp-btn dcafp-btn--primary" style={{ marginTop: 6 }}>
              Crear ticket nuevo
            </Link>
          </div>
        </Note>
      ) : (
        <div style={{ position: "sticky", bottom: 0, zIndex: 10, paddingTop: 4, paddingBottom: 6, background: "var(--dcafp-bg)" }}>
          <PanelCard tight>
            <label className="dcafp-label" htmlFor="af-ticket-reply">Tu respuesta</label>
            <textarea
              id="af-ticket-reply"
              className="dcafp-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, AFFILIATE_SUPPORT_MAX_BODY_CHARS))}
              onKeyDown={onComposerKeyDown}
              placeholder="Escribe tu mensaje…"
              rows={2}
              maxLength={AFFILIATE_SUPPORT_MAX_BODY_CHARS}
              disabled={sending}
              style={{ minHeight: 84 }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <span className="dcafp-hint">Enter para enviar · Shift+Enter para salto de línea</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
                {nearLimit && (
                  <span className="dcafp-nums" style={{ fontSize: 11.5, color: "var(--dcafp-ink-3)" }}>
                    {body.length}/{AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                  </span>
                )}
                <button
                  type="button"
                  className="dcafp-btn dcafp-btn--primary"
                  onClick={handleSend}
                  disabled={sending || !body.trim()}
                >
                  {sending
                    ? <Loader2 size={16} strokeWidth={1.9} className="animate-spin" aria-hidden />
                    : <Send size={16} strokeWidth={1.9} aria-hidden />}
                  {sending ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </div>
          </PanelCard>
        </div>
      )}
    </div>
  );
}
