"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /afiliados/soporte/[id] — hilo del ticket, estilo chat.
// Burbujas por authorType (afiliado a la derecha, soporte a la izquierda,
// `system` centrado). Al abrir se marca como leído.
// API: GET /api/afiliados/soporte/[id] · PATCH (marcar leído)
//      POST /api/afiliados/soporte/[id]/messages
// Contrato: src/lib/affiliate-support/types.ts.
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
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
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

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// MISMO mapa que en soporte-client.tsx — mantener en sincronía.
const STATUS_TONES: Record<string, BadgeTone> = {
  ABIERTO: "info",
  EN_PROGRESO: "brand",
  ESPERANDO_RESPUESTA: "warning",
  RESUELTO: "success",
  CERRADO: "neutral",
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
  URGENTE: "danger",
  ALTA: "warning",
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

// ── Burbuja de mensaje ──────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AffiliateSupportMessageDTO }) {
  const time = formatMsgTime(msg.createdAt);

  // Los `system` (cambios de estado) van centrados y en tono tenue: son del
  // sistema, no de una persona.
  if (msg.authorType === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "0 8px" }}>
        <div style={{ maxWidth: "80%", textAlign: "center" }}>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", fontSize: 12, fontStyle: "italic", color: "var(--text-3)", margin: 0 }}>
            {msg.body}
          </p>
          {time && <p style={{ marginTop: 2, marginBottom: 0, fontSize: 11, color: "var(--text-3)" }}>{time}</p>}
        </div>
      </div>
    );
  }

  const isAffiliate = msg.authorType === "affiliate";
  const authorLabel = isAffiliate
    ? (msg.authorName || "Tú")
    : (msg.authorName || "Soporte DaleControl");

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, justifyContent: isAffiliate ? "flex-end" : "flex-start" }}>
      {!isAffiliate && (
        <div style={{ marginTop: 4, flexShrink: 0 }}>
          <AvatarNew name={authorLabel} size="sm" />
        </div>
      )}
      <div
        style={
          isAffiliate
            ? {
                maxWidth: "78%",
                padding: "10px 14px",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand, rgba(124,58,237,0.25))",
                borderRadius: "var(--radius-lg)",
                borderBottomRightRadius: "var(--radius-sm)",
              }
            : {
                maxWidth: "78%",
                padding: "10px 14px",
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--radius-lg)",
                borderBottomLeftRadius: "var(--radius-sm)",
              }
        }
      >
        <p style={{ margin: 0, marginBottom: 4, fontSize: 11, fontWeight: 600, color: isAffiliate ? "var(--brand)" : "var(--text-2)" }}>
          {authorLabel}
        </p>
        {/* Texto plano siempre — nunca HTML. */}
        <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "break-word", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-1)" }}>
          {msg.body}
        </p>
        {time && (
          <p style={{ margin: 0, marginTop: 4, fontSize: 11, color: "var(--text-3)", textAlign: isAffiliate ? "right" : "left" }}>
            {time}
          </p>
        )}
      </div>
      {isAffiliate && (
        <div style={{ marginTop: 4, flexShrink: 0 }}>
          <AvatarNew name={authorLabel} size="sm" />
        </div>
      )}
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
      <div style={{ minHeight: "50vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Loader2 size={20} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--text-3)" }} aria-hidden />
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Cargando ticket…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ minHeight: "55vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center" }}>
        <LifeBuoy size={20} strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>Ticket no encontrado</h2>
        <p style={{ maxWidth: "42ch", fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          Puede que el enlace sea incorrecto o que ese ticket no sea tuyo.
        </p>
        <Link href="/afiliados/soporte" className="btn-new btn-new--secondary" style={{ marginTop: 8 }}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Volver a Soporte
        </Link>
      </div>
    );
  }

  if (loadError || !ticket) {
    return (
      <div style={{ minHeight: "55vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center" }}>
        <LifeBuoy size={20} strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>No se pudo cargar el ticket</h2>
        <p style={{ maxWidth: "42ch", fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          Revisa tu conexión e inténtalo de nuevo.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <ButtonNew variant="primary" onClick={() => loadTicket()}>Reintentar</ButtonNew>
          <Link href="/afiliados/soporte" className="btn-new btn-new--ghost">
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
          </Link>
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === "CERRADO";
  const statusLabel = AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE[ticket.status] || ticket.status;
  const statusTone = STATUS_TONES[ticket.status] || "neutral";
  const categoryLabel = AFFILIATE_SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = AFFILIATE_SUPPORT_PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const priorityTone = PRIORITY_TONES[ticket.priority] || "neutral";

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column" }}>
      <Link
        href="/afiliados/soporte"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "fit-content", marginBottom: 12, fontSize: 13, color: "var(--text-3)", textDecoration: "none" }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
      </Link>

      {/* Encabezado */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingBottom: 16, borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{ticket.folioLabel}</span>
            <BadgeNew tone={statusTone} dot>{statusLabel}</BadgeNew>
          </div>
          <h1 style={{ margin: 0, marginTop: 6, fontSize: 19, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.02em", overflowWrap: "break-word" }}>
            {ticket.subject}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
            <BadgeNew tone="neutral">{categoryLabel}</BadgeNew>
            <BadgeNew tone={priorityTone} dot>Prioridad: {priorityLabel}</BadgeNew>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              Creado el {formatDateLong(ticket.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Hilo */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
        {visibleMessages.length === 0 ? (
          <p style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
            Aún no hay mensajes en este ticket.
          </p>
        ) : (
          visibleMessages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* Composer / aviso de cerrado */}
      {isClosed ? (
        <div style={{ padding: "20px 16px", textAlign: "center", background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>Este ticket está cerrado.</p>
          {typeof ticket.rating === "number" && ticket.rating >= 1 && (
            <p style={{ margin: 0, marginTop: 4, fontSize: 12, color: "var(--text-3)" }}>
              Calificación: <span style={{ color: "var(--warning-strong)" }}>{"★".repeat(Math.min(5, ticket.rating))}</span> ({ticket.rating}/5)
            </p>
          )}
          <p style={{ margin: 0, marginTop: 4, fontSize: 12, color: "var(--text-3)" }}>
            Si necesitas algo más, crea un ticket nuevo y te atendemos.
          </p>
          <Link href="/afiliados/soporte" className="btn-new btn-new--primary" style={{ marginTop: 12 }}>
            Crear ticket nuevo
          </Link>
        </div>
      ) : (
        <div style={{ position: "sticky", bottom: 0, zIndex: 10, paddingTop: 4, paddingBottom: 4, background: "var(--bg)" }}>
          <div style={{ padding: 10, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, AFFILIATE_SUPPORT_MAX_BODY_CHARS))}
              onKeyDown={onComposerKeyDown}
              placeholder="Escribe tu mensaje…"
              rows={2}
              maxLength={AFFILIATE_SUPPORT_MAX_BODY_CHARS}
              disabled={sending}
              style={{
                width: "100%",
                resize: "none",
                background: "transparent",
                border: "none",
                outline: "none",
                padding: "4px 6px",
                fontSize: 13.5,
                fontFamily: "inherit",
                color: "var(--text-1)",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              {body.length > AFFILIATE_SUPPORT_MAX_BODY_CHARS - 500 && (
                <span style={{ fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {body.length}/{AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                </span>
              )}
              <ButtonNew
                variant="primary"
                onClick={handleSend}
                disabled={sending || !body.trim()}
                icon={sending
                  ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden />
                  : <Send size={16} strokeWidth={1.75} aria-hidden />}
              >
                {sending ? "Enviando…" : "Enviar"}
              </ButtonNew>
            </div>
          </div>
          <p style={{ margin: 0, marginTop: 6, textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>
            Enter para enviar · Shift+Enter para salto de línea
          </p>
        </div>
      )}
    </div>
  );
}
