"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/soporte-afiliados/[id] — detalle admin del ticket de un AFILIADO:
// hilo completo (con notas internas en ámbar bien diferenciadas), responder o
// guardar nota interna, y cambiar estado/prioridad.
//
// Espejo de /admin/soporte/[id] (clínicas). Se DUPLICA a propósito: aquella
// pantalla está en producción y sus piezas (MessageItem, AttachmentList,
// MetaItem…) son funciones locales tipadas contra SupportMessageDTO —
// exportarlas obligaría a generizarlas y a tocar el soporte de clínicas.
//
// Diferencia real con la de clínicas: aquí el admin NO sube adjuntos (el
// contrato addAffiliateSupportMessage no los acepta), pero SÍ se renderizan los
// que manda el afiliado.
//
// API: GET/PATCH /api/admin/affiliate-support/tickets/[id]
//      POST /api/admin/affiliate-support/tickets/[id]/messages { body, internalNote? }
// Contrato: src/lib/affiliate-support/types.ts (AdminAffiliateTicketDetailDTO).
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, Lock, Paperclip } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  AFFILIATE_SUPPORT_STATUSES,
  AFFILIATE_SUPPORT_PRIORITIES,
  AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN,
  AFFILIATE_SUPPORT_PRIORITY_LABELS,
  AFFILIATE_SUPPORT_CATEGORY_LABELS,
  AFFILIATE_SUPPORT_MAX_BODY_CHARS,
  type AdminAffiliateTicketDetailDTO,
  type AffiliateSupportAttachment,
  type AffiliateSupportMessageDTO,
} from "@/lib/affiliate-support/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const STATUS_TONES: Record<string, BadgeTone> = {
  ABIERTO: "info",
  EN_PROGRESO: "brand",
  ESPERANDO_RESPUESTA: "warning",
  RESUELTO: "success",
  CERRADO: "neutral",
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
  BAJA: "neutral",
  NORMAL: "info",
  ALTA: "warning",
  URGENTE: "danger",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span title={`${r} de 5`} style={{ color: "var(--warning)", letterSpacing: 1 }}>
      {"★".repeat(r)}
      <span style={{ color: "var(--text-3)" }}>{"☆".repeat(5 - r)}</span>
    </span>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--text-3)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/soporte-afiliados"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: "var(--text-2)",
        textDecoration: "none",
        marginBottom: 14,
      }}
    >
      <ArrowLeft size={14} />
      Soporte afiliados
    </Link>
  );
}

// ── Adjuntos (sólo lectura: los manda el afiliado) ───────────────────────────

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev-2, var(--bg-elev))",
  color: "var(--text-2)",
  textDecoration: "none",
  maxWidth: 220,
};

function AttachmentList({ attachments }: { attachments?: AffiliateSupportAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {attachments.map((a, i) => {
        const key = `${a.path || a.name || "adj"}-${i}`;
        const isImage = typeof a.type === "string" && a.type.startsWith("image/");
        if (a.signedUrl && isImage) {
          return (
            <a
              key={key}
              href={a.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={a.name}
              style={{ display: "block", lineHeight: 0 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.signedUrl}
                alt={a.name || "Adjunto"}
                loading="lazy"
                style={{
                  maxHeight: 110,
                  maxWidth: 170,
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </a>
          );
        }
        if (a.signedUrl) {
          return (
            <a key={key} href={a.signedUrl} target="_blank" rel="noopener noreferrer" title={a.name} style={chipStyle}>
              <FileText size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.name || "Documento"}
              </span>
            </a>
          );
        }
        // Sin URL firmada (expiró o el service no la generó): chip apagado.
        return (
          <span key={key} title="Adjunto no disponible" style={{ ...chipStyle, color: "var(--text-3)", opacity: 0.7 }}>
            <Paperclip size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.name || "Adjunto"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── Mensaje del hilo ─────────────────────────────────────────────────────────

function MessageItem({ message, affiliateName }: { message: AffiliateSupportMessageDTO; affiliateName: string }) {
  const isInternal = message.internalNote === true;
  const isAffiliate = message.authorType === "affiliate";
  const isSystem = message.authorType === "system";

  // Mensajes system (cambios de estado, etc.): centrados, pequeños, itálica.
  if (isSystem && !isInternal) {
    return (
      <div style={{ alignSelf: "center", textAlign: "center", maxWidth: "min(560px, 92%)", padding: "0 8px" }}>
        <div
          style={{
            fontSize: 11.5,
            fontStyle: "italic",
            color: "var(--text-3)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.body}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-3)", opacity: 0.75, marginTop: 2 }}>
          {formatDate(message.createdAt)}
        </div>
      </div>
    );
  }

  const bubble: CSSProperties = {
    maxWidth: "min(640px, 88%)",
    borderRadius: 12,
    padding: "10px 14px",
    ...(isInternal
      ? {
          alignSelf: "flex-end",
          background: "var(--warning-soft)",
          border: "1px solid var(--warning-border-strong, rgba(217,119,6,0.35))",
        }
      : isAffiliate
        ? { alignSelf: "flex-start", background: "var(--bg-elev)", border: "1px solid var(--border-soft)" }
        : { alignSelf: "flex-end", background: "var(--brand-softer)", border: "1px solid var(--brand-soft)" }),
  };

  return (
    <div style={bubble}>
      {isInternal && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--warning)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          <Lock size={11} style={{ flexShrink: 0 }} />
          Nota interna — el afiliado no la ve
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
          {message.authorName || (isAffiliate ? "Afiliado" : "Soporte DaleControl")}
        </span>
        {isAffiliate && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{affiliateName}</span>}
        <span style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: "auto" }}>
          {formatDate(message.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--text-1)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.body}
      </div>
      <AttachmentList attachments={message.attachments} />
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function AdminAffiliateTicketClient({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<AdminAffiliateTicketDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<"status" | "priority" | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const hasDataRef = useRef(false);

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/affiliate-support/tickets/${ticketId}`, { cache: "no-store" });
      if (res.status === 404) {
        // El 404 también cubre "faltan las tablas" (sqlPending): se muestra el
        // mensaje del server en vez de un error genérico.
        const j = await res.json().catch(() => null);
        setNotFoundMsg(j?.sqlPending ? j?.error ?? null : null);
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error();
      const json = (await res.json()) as AdminAffiliateTicketDetailDTO;
      setData(json);
      hasDataRef.current = true;
      setLoadError(false);
    } catch {
      if (!hasDataRef.current) setLoadError(true);
      else toast.error("No se pudo actualizar el ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const messages = useMemo(() => {
    if (!data) return [] as AffiliateSupportMessageDTO[];
    // Copia antes de ordenar: sort muta y `data` es estado de React.
    return data.messages
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [data]);

  const ticket = data?.ticket;
  const isClosed = ticket?.status === "CERRADO";
  // En ticket cerrado el composer queda SOLO para notas internas.
  const effectiveInternal = isClosed ? true : internalNote;

  async function patchTicket(payload: { status?: string; priority?: string }, okMsg: string, failMsg: string) {
    setSaving(payload.status !== undefined ? "status" : "priority");
    try {
      const res = await fetch(`/api/admin/affiliate-support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "");
      }
      toast.success(okMsg);
      // El server ya generó el mensaje system si aplica; aquí sólo re-fetch.
      await fetchTicket();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : failMsg);
    } finally {
      setSaving(null);
    }
  }

  async function sendMessage() {
    const body = replyBody.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/affiliate-support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, internalNote: effectiveInternal }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "");
      }
      setReplyBody("");
      toast.success(effectiveInternal ? "Nota interna guardada" : "Respuesta enviada");
      await fetchTicket();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-3)", fontSize: 13 }}>Cargando ticket…</div>;
  }

  if (notFound) {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>
        <BackLink />
        <CardNew>
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-3)", fontSize: 13 }}>
            {notFoundMsg ??
              "Ticket no encontrado. Puede que haya sido eliminado o el enlace sea incorrecto."}
          </div>
        </CardNew>
      </div>
    );
  }

  if (loadError || !ticket) {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>
        <BackLink />
        <CardNew>
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ color: "var(--text-2)", fontSize: 13, marginBottom: 12 }}>No se pudo cargar el ticket.</div>
            <ButtonNew
              variant="secondary"
              onClick={() => {
                setLoading(true);
                setLoadError(false);
                fetchTicket();
              }}
            >
              Reintentar
            </ButtonNew>
          </div>
        </CardNew>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px 56px" }}>
      <BackLink />

      {/* Header del ticket */}
      <CardNew>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)" }}>
                {ticket.folioLabel}
              </span>
              <BadgeNew tone="neutral">
                {AFFILIATE_SUPPORT_CATEGORY_LABELS[ticket.category] ?? ticket.category}
              </BadgeNew>
              <BadgeNew tone={STATUS_TONES[ticket.status] ?? "neutral"} dot>
                {AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN[ticket.status] ?? ticket.status}
              </BadgeNew>
              <BadgeNew tone={PRIORITY_TONES[ticket.priority] ?? "neutral"}>
                {AFFILIATE_SUPPORT_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
              </BadgeNew>
            </div>
            <h1
              style={{
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-1)",
                margin: "8px 0 0",
                wordBreak: "break-word",
              }}
            >
              {ticket.subject}
            </h1>
          </div>

          {/* Controles de gestión */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
              Estado
              <select
                className="input-new"
                value={ticket.status}
                disabled={saving !== null}
                onChange={(e) =>
                  patchTicket({ status: e.target.value }, "Estado actualizado", "No se pudo actualizar el estado")
                }
                style={{ minWidth: 180 }}
              >
                {AFFILIATE_SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN[s] ?? s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
              Prioridad
              <select
                className="input-new"
                value={ticket.priority}
                disabled={saving !== null}
                onChange={(e) =>
                  patchTicket({ priority: e.target.value }, "Prioridad actualizada", "No se pudo actualizar la prioridad")
                }
                style={{ minWidth: 130 }}
              >
                {AFFILIATE_SUPPORT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {AFFILIATE_SUPPORT_PRIORITY_LABELS[p] ?? p}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Meta del ticket (colapsa a 1 columna en mobile) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "14px 18px",
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <MetaItem label="Afiliado">
            {/* Atajo a la ficha: desde el ticket casi siempre hay que mirar sus
                comisiones para poder responder. */}
            <Link
              href={`/admin/affiliates/${ticket.affiliateId}`}
              style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}
            >
              {ticket.affiliateName}
            </Link>
            {ticket.affiliateEmail && (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{ticket.affiliateEmail}</div>
            )}
          </MetaItem>
          <MetaItem label="Creado por">{ticket.createdByName || "—"}</MetaItem>
          <MetaItem label="Creado">{formatDate(ticket.createdAt)}</MetaItem>
          <MetaItem label="1ª respuesta">
            {ticket.firstResponseAt ? (
              formatDate(ticket.firstResponseAt)
            ) : (
              <span style={{ color: "var(--danger)", fontWeight: 500 }}>Sin responder</span>
            )}
          </MetaItem>
          {typeof ticket.rating === "number" && (
            <MetaItem label="Calificación">
              <Stars rating={ticket.rating} />{" "}
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>({ticket.rating}/5)</span>
            </MetaItem>
          )}
          {ticket.closedAt && <MetaItem label="Cerrado">{formatDate(ticket.closedAt)}</MetaItem>}
        </div>
      </CardNew>

      {/* Hilo de conversación */}
      <div style={{ margin: "22px 0 8px", display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-2)",
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Conversación
        </h2>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          {messages.length} mensaje{messages.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} affiliateName={ticket.affiliateName} />
        ))}
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: 20, fontSize: 12.5, color: "var(--text-3)" }}>
            Sin mensajes en este ticket.
          </div>
        )}
      </div>

      {/* Banner de ticket cerrado */}
      {isClosed && (
        <div
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-3)",
            fontSize: 12.5,
          }}
        >
          <Lock size={13} style={{ flexShrink: 0 }} />
          <span>
            <strong style={{ color: "var(--text-2)", fontWeight: 600 }}>Ticket cerrado.</strong> Ya no se envían
            respuestas al afiliado; solo puedes agregar notas internas.
          </span>
        </div>
      )}

      {/* Composer */}
      <div style={{ marginTop: isClosed ? 10 : 20 }}>
        <div
          style={{
            borderRadius: 12,
            padding: 12,
            background: effectiveInternal ? "var(--warning-soft)" : "var(--bg-elev)",
            border: effectiveInternal
              ? "1px solid var(--warning-border-strong, rgba(217,119,6,0.35))"
              : "1px solid var(--border-soft)",
            transition: "background .15s ease, border-color .15s ease",
          }}
        >
          <textarea
            className="input-new"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              effectiveInternal
                ? "Escribe una nota interna (el afiliado no la verá)…"
                : "Escribe tu respuesta para el afiliado…"
            }
            rows={4}
            maxLength={AFFILIATE_SUPPORT_MAX_BODY_CHARS}
            disabled={sending}
            style={{
              width: "100%",
              height: "auto",
              minHeight: 96,
              resize: "vertical",
              background: "transparent",
              border: "none",
              boxShadow: "none",
              padding: "4px 2px",
              fontSize: 13,
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                fontWeight: effectiveInternal ? 600 : 400,
                color: effectiveInternal ? "var(--warning)" : "var(--text-2)",
                cursor: isClosed ? "not-allowed" : "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={effectiveInternal}
                disabled={isClosed || sending}
                onChange={(e) => setInternalNote(e.target.checked)}
                style={{ accentColor: "var(--warning)" }}
              />
              Nota interna (solo la ve el equipo de soporte)
            </label>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                {replyBody.length}/{AFFILIATE_SUPPORT_MAX_BODY_CHARS}
              </span>
              <ButtonNew variant="primary" onClick={sendMessage} disabled={sending || !replyBody.trim()}>
                {sending ? "Enviando…" : effectiveInternal ? "Guardar nota" : "Responder"}
              </ButtonNew>
            </div>
          </div>
        </div>
        {!effectiveInternal && (
          <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "8px 2px 0" }}>
            El afiliado verá la respuesta en su panel de soporte.
          </p>
        )}
      </div>
    </div>
  );
}
