"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/soporte/[id] — detalle admin del ticket: hilo completo (con notas
// internas en ámbar bien diferenciadas), responder o guardar nota interna
// (ambas con adjuntos imagen/PDF, 5MB, máx 5), y cambiar estado/prioridad.
// El cambio de estado genera el mensaje system y el email a la clínica DEL
// LADO DEL SERVER (aquí solo se hace re-fetch, no se duplica nada).
// API: GET/PATCH /api/admin/support/tickets/[id]
//      POST /api/admin/support/tickets/[id]/messages { body, internalNote?, attachments? }
//      POST /api/admin/support/tickets/[id]/attachments (subir adjunto antes de enviar)
// Contrato: src/lib/support/types.ts (AdminTicketDetailDTO).
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, Image as ImageIcon, Lock, Paperclip, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUS_LABELS_ADMIN,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  type AdminTicketDetailDTO,
  type SupportAttachment,
  type SupportMessageDTO,
} from "@/lib/support/types";

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

const ACCEPT_ATTR = SUPPORT_ALLOWED_MIME.join(",");

function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
      href="/admin/soporte"
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
      Soporte
    </Link>
  );
}

// ── Adjuntos ─────────────────────────────────────────────────────────────────

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

function AttachmentList({ attachments }: { attachments?: SupportAttachment[] }) {
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

function MessageItem({ message, clinicName }: { message: SupportMessageDTO; clinicName: string }) {
  const isInternal = message.internalNote === true;
  const isClinic = message.authorType === "clinic";
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
      : isClinic
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
          Nota interna — la clínica no la ve
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
          {message.authorName || (isClinic ? "Clínica" : "Soporte DaleControl")}
        </span>
        {isClinic && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{clinicName}</span>}
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

export function AdminTicketClient({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<AdminTicketDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<"status" | "priority" | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const hasDataRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error();
      const json = (await res.json()) as AdminTicketDetailDTO;
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
    if (!data) return [] as SupportMessageDTO[];
    return [...data.messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [data]);

  const ticket = data?.ticket;
  const isClosed = ticket?.status === "CERRADO";
  // En ticket cerrado el composer queda SOLO para notas internas.
  const effectiveInternal = isClosed ? true : internalNote;
  const canAttachMore = pendingFiles.length < SUPPORT_MAX_FILES_PER_MESSAGE;

  async function patchTicket(payload: { status?: string; priority?: string }, okMsg: string, failMsg: string) {
    setSaving(payload.status !== undefined ? "status" : "priority");
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "");
      }
      toast.success(okMsg);
      // El server ya generó mensaje system + email si aplica; solo re-fetch.
      await fetchTicket();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : failMsg);
    } finally {
      setSaving(null);
    }
  }

  // ── Adjuntos del composer (mismo patrón que dashboard/soporte/[id]) ────────
  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const slots = SUPPORT_MAX_FILES_PER_MESSAGE - pendingFiles.length;
    if (slots <= 0) {
      toast.error(`Máximo ${SUPPORT_MAX_FILES_PER_MESSAGE} archivos por mensaje.`);
      return;
    }
    if (files.length > slots) {
      toast.error(`Solo puedes adjuntar ${slots} archivo${slots === 1 ? "" : "s"} más.`);
    }
    setUploading(true);
    try {
      for (const file of files.slice(0, slots)) {
        if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
          toast.error(`"${file.name}": tipo no permitido (solo imágenes o PDF).`);
          continue;
        }
        if (file.size > SUPPORT_MAX_FILE_BYTES) {
          toast.error(`"${file.name}" supera el límite de 5MB.`);
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(`/api/admin/support/tickets/${ticketId}/attachments`, {
            method: "POST",
            body: fd,
          });
          let data: any = null;
          try { data = await res.json(); } catch {}
          if (!res.ok || !data || !data.path) {
            toast.error((data && data.error) || `No se pudo subir "${file.name}".`);
            continue;
          }
          const uploaded: SupportAttachment = {
            path: data.path,
            name: data.name || file.name,
            size: typeof data.size === "number" ? data.size : file.size,
            type: data.type || file.type,
          };
          setPendingFiles((prev) =>
            prev.length >= SUPPORT_MAX_FILES_PER_MESSAGE ? prev : [...prev, uploaded]
          );
        } catch {
          toast.error(`Error de red al subir "${file.name}".`);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function sendMessage() {
    const body = replyBody.trim();
    // Se permite enviar SOLO archivos sin texto (el service ya lo acepta).
    if ((!body && pendingFiles.length === 0) || sending || uploading) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          internalNote: effectiveInternal,
          ...(pendingFiles.length > 0 ? { attachments: pendingFiles } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "");
      }
      setReplyBody("");
      setPendingFiles([]);
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
            Ticket no encontrado. Puede que haya sido eliminado o el enlace sea incorrecto.
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
              <BadgeNew tone="neutral">{SUPPORT_CATEGORY_LABELS[ticket.category] ?? ticket.category}</BadgeNew>
              <BadgeNew tone={STATUS_TONES[ticket.status] ?? "neutral"} dot>
                {SUPPORT_STATUS_LABELS_ADMIN[ticket.status] ?? ticket.status}
              </BadgeNew>
              <BadgeNew tone={PRIORITY_TONES[ticket.priority] ?? "neutral"}>
                {SUPPORT_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
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
                onChange={(e) => patchTicket({ status: e.target.value }, "Estado actualizado", "No se pudo actualizar el estado")}
                style={{ minWidth: 180 }}
              >
                {SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_STATUS_LABELS_ADMIN[s] ?? s}
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
                onChange={(e) => patchTicket({ priority: e.target.value }, "Prioridad actualizada", "No se pudo actualizar la prioridad")}
                style={{ minWidth: 130 }}
              >
                {SUPPORT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {SUPPORT_PRIORITY_LABELS[p] ?? p}
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
          <MetaItem label="Clínica">
            <div style={{ color: "var(--text-1)", fontWeight: 500 }}>{ticket.clinicName}</div>
            {ticket.clinicEmail && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{ticket.clinicEmail}</div>}
          </MetaItem>
          <MetaItem label="Creado por">
            <div>{ticket.createdByName || "—"}</div>
            {ticket.createdByEmail && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{ticket.createdByEmail}</div>}
          </MetaItem>
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
          <MessageItem key={m.id} message={m} clinicName={ticket.clinicName} />
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
            respuestas a la clínica; solo puedes agregar notas internas.
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
                ? "Escribe una nota interna (la clínica no la verá)…"
                : "Escribe tu respuesta para la clínica…"
            }
            rows={4}
            maxLength={SUPPORT_MAX_BODY_CHARS}
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
          {/* Chips de adjuntos pendientes (aún no enviados) */}
          {pendingFiles.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {pendingFiles.map((f, i) => (
                <span key={`${f.path}-${i}`} style={chipStyle}>
                  {f.type && f.type.startsWith("image/") ? (
                    <ImageIcon size={12} style={{ flexShrink: 0 }} />
                  ) : (
                    <FileText size={12} style={{ flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-1)",
                    }}
                  >
                    {f.name}
                  </span>
                  {formatBytes(f.size) && (
                    <span style={{ color: "var(--text-3)", flexShrink: 0 }}>{formatBytes(f.size)}</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Quitar ${f.name}`}
                    onClick={() => removePending(i)}
                    disabled={sending}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: sending ? "not-allowed" : "pointer",
                      color: "var(--text-3)",
                      flexShrink: 0,
                    }}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              style={{ display: "none" }}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (fileRef.current) fileRef.current.click();
              }}
              disabled={uploading || sending || !canAttachMore}
              aria-label="Adjuntar archivo (imagen o PDF, máximo 5MB)"
              title="Imágenes o PDF · máx. 5MB · hasta 5 por mensaje"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-soft)",
                background: "transparent",
                color: "var(--text-2)",
                cursor: uploading || sending || !canAttachMore ? "not-allowed" : "pointer",
                opacity: uploading || sending || !canAttachMore ? 0.6 : 1,
              }}
            >
              <Paperclip size={13} style={{ flexShrink: 0 }} />
              {uploading ? "Subiendo…" : "Adjuntar"}
            </button>
            {pendingFiles.length > 0 && (
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                {pendingFiles.length}/{SUPPORT_MAX_FILES_PER_MESSAGE}
              </span>
            )}
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
                {replyBody.length}/{SUPPORT_MAX_BODY_CHARS}
              </span>
              <ButtonNew
                variant="primary"
                onClick={sendMessage}
                disabled={sending || uploading || (!replyBody.trim() && pendingFiles.length === 0)}
              >
                {sending ? "Enviando…" : effectiveInternal ? "Guardar nota" : "Responder"}
              </ButtonNew>
            </div>
          </div>
        </div>
        {!effectiveInternal && (
          <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "8px 2px 0" }}>
            La respuesta se envía por email al creador del ticket.
          </p>
        )}
      </div>
    </div>
  );
}
