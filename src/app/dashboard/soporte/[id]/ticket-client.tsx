"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /dashboard/soporte/[id] — detalle del ticket con hilo estilo chat (clínica).
// Hilo cronológico (clínica derecha / soporte izquierda / sistema centrado),
// responder con adjuntos (imagen/PDF, 5MB, máx 5), cerrar y calificar 1-5.
// Las notas internas NUNCA llegan a este endpoint, pero igual NO se
// renderizan mensajes con internalNote=true (defensa extra).
// API: GET /api/support/tickets/[id] · POST /api/support/tickets/[id]/messages
//      PATCH /api/support/tickets/[id] { action:"close", rating? }
//      POST /api/support/attachments (subir adjunto antes de enviar)
// Contrato: src/lib/support/types.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowLeft, Paperclip, FileText, Send, X,
  CheckCircle2, Loader2, LifeBuoy, Image as ImageIcon, Star,
} from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import {
  SUPPORT_STATUS_LABELS_CLINIC,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SUPPORT_MAX_BODY_CHARS,
} from "@/lib/support/types";
import type {
  SupportAttachment,
  SupportMessageDTO,
  SupportTicketSummary,
} from "@/lib/support/types";

// ── Presentación ─────────────────────────────────────────────────────────────

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// MISMO mapa en soporte/soporte-client.tsx — mantener en sincronía.
const STATUS_TONES: Record<string, BadgeTone> = {
  ABIERTO: "info",               // azul
  EN_PROGRESO: "brand",          // violeta (en curso)
  ESPERANDO_RESPUESTA: "warning",// ámbar
  RESUELTO: "success",           // verde
  CERRADO: "neutral",            // gris
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
  URGENTE: "danger",
  ALTA: "warning",
  NORMAL: "neutral",
  BAJA: "neutral",
};

const ACCEPT_ATTR = SUPPORT_ALLOWED_MIME.join(",");

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

function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Adjunto dentro de un mensaje ─────────────────────────────────────────────

function AttachmentItem({ att }: { att: SupportAttachment }) {
  const isImage = typeof att.type === "string" && att.type.startsWith("image/");

  // Sin signedUrl → solo el nombre, en tono tenue y sin link.
  if (!att.signedUrl) {
    return (
      <span
        className="tag-new"
        style={{ color: "var(--text-3)" }}
        title="Adjunto no disponible por ahora"
      >
        {isImage ? <ImageIcon size={16} strokeWidth={1.75} aria-hidden /> : <FileText size={16} strokeWidth={1.75} aria-hidden />}
        <span className="max-w-[140px] truncate">{att.name}</span>
      </span>
    );
  }

  if (isImage) {
    return (
      <a
        href={att.signedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        title={att.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={att.signedUrl}
          alt={att.name}
          loading="lazy"
          className="object-cover"
          style={{ maxWidth: 160, maxHeight: 160, borderRadius: "var(--radius)", border: "1px solid var(--border-soft)" }}
        />
      </a>
    );
  }

  return (
    <a
      href={att.signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="tag-new hover:underline"
      style={{ background: "var(--bg-elev)" }}
      title={att.name}
    >
      <FileText size={16} strokeWidth={1.75} aria-hidden />
      <span className="max-w-[160px] truncate">{att.name}</span>
    </a>
  );
}

// ── Burbuja de mensaje ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: SupportMessageDTO }) {
  const time = formatMsgTime(msg.createdAt);
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];

  if (msg.authorType === "system") {
    return (
      <div className="flex justify-center px-2">
        <div className="max-w-[85%] sm:max-w-[65%] text-center">
          <p className="whitespace-pre-wrap break-words text-xs italic" style={{ color: "var(--text-3)" }}>
            {msg.body}
          </p>
          {time && (
            <p className="mt-0.5" style={{ fontSize: 11, color: "var(--text-3)" }}>{time}</p>
          )}
        </div>
      </div>
    );
  }

  const isClinic = msg.authorType === "clinic";
  const authorLabel = isClinic
    ? (msg.authorName || "Tú")
    : (msg.authorName || "Soporte DaleControl");

  return (
    <div className={`flex items-start gap-2 ${isClinic ? "justify-end" : "justify-start"}`}>
      {!isClinic && <AvatarNew name={authorLabel} size="sm" className="mt-1" />}
      <div
        className="max-w-[85%] sm:max-w-[65%] px-3.5 py-2.5"
        style={
          isClinic
            ? { background: "var(--brand-soft)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: "var(--radius-lg)", borderBottomRightRadius: "var(--radius-sm)" }
            : { background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", borderBottomLeftRadius: "var(--radius-sm)" }
        }
      >
        <p
          className="mb-1 font-semibold"
          style={{ fontSize: 11, color: isClinic ? "var(--brand)" : "var(--text-2)" }}
        >
          {authorLabel}
        </p>
        {/* Texto plano siempre — nunca HTML */}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>
          {msg.body}
        </p>
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <AttachmentItem key={`${att.path || att.name}-${i}`} att={att} />
            ))}
          </div>
        )}
        {time && (
          <p
            className={`mt-1 ${isClinic ? "text-right" : "text-left"}`}
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            {time}
          </p>
        )}
      </div>
      {isClinic && <AvatarNew name={authorLabel} size="sm" className="mt-1" />}
    </div>
  );
}

// ── Diálogo de cierre con calificación opcional ──────────────────────────────

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="Calificación (opcional)">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          onClick={() => onChange(value === n ? 0 : n)}
          className="transition-transform hover:scale-110"
          style={{
            width: 40, height: 40, display: "grid", placeItems: "center",
            background: "transparent", border: "none", cursor: "pointer",
            color: n <= value ? "var(--warning-strong)" : "var(--text-3)",
            transitionDuration: "var(--dur-1)", transitionTimingFunction: "var(--ease)",
          }}
        >
          <Star size={22} strokeWidth={1.75} fill={n <= value ? "currentColor" : "none"} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function CloseDialog({
  closing,
  onCancel,
  onConfirm,
}: {
  closing: boolean;
  onCancel: () => void;
  onConfirm: (rating: number) => void;
}) {
  const [rating, setRating] = useState(0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={closing ? undefined : onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cerrar ticket"
        className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-3)" }}
      >
        <h3 className="shrink-0 px-5 pb-3 pt-5 text-base font-semibold" style={{ color: "var(--text-1)" }}>¿Resolvimos tu problema?</h3>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Al cerrar el ticket ya no podrás responder en este hilo. Si quieres, califica la atención (es opcional).
          </p>
          <div className="mt-4">
            <StarPicker value={rating} onChange={setRating} />
            <p className="mt-1.5 text-center text-xs" style={{ color: "var(--text-3)" }}>
              {rating > 0 ? `${rating} de 5` : "Sin calificación"}
            </p>
          </div>
        </div>
        <div className="shrink-0 flex justify-end gap-2 px-5 pb-5 pt-3">
          <ButtonNew variant="ghost" onClick={onCancel} disabled={closing}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            variant="primary"
            onClick={() => onConfirm(rating)}
            disabled={closing}
            icon={closing ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden /> : undefined}
          >
            {closing ? "Cerrando…" : "Cerrar ticket"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function TicketClient({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<SupportTicketSummary | null>(null);
  const [messages, setMessages] = useState<SupportMessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadTicket = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts && opts.silent;
    if (!silent) { setLoading(true); setLoadError(false); }
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, { cache: "no-store" });
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

  // ── Adjuntos del composer ──────────────────────────────────────────────────
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
          const res = await fetch("/api/support/attachments", { method: "POST", body: fd });
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

  // ── Enviar mensaje ─────────────────────────────────────────────────────────
  async function handleSend() {
    const text = body.trim();
    if (!text || sending || uploading) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          ...(pendingFiles.length > 0 ? { attachments: pendingFiles } : {}),
        }),
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
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
      setPendingFiles([]);
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

  // ── Cerrar ticket (con calificación opcional) ─────────────────────────────
  async function handleCloseTicket(rating: number) {
    if (closing) return;
    setClosing(true);
    try {
      const payload =
        rating >= 1 && rating <= 5 ? { action: "close", rating } : { action: "close" };
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        toast.error((data && data.error) || "No se pudo cerrar el ticket.");
        return;
      }
      toast.success("Ticket cerrado. ¡Gracias!");
      setCloseOpen(false);
      await loadTicket({ silent: true });
    } catch {
      toast.error("Error de red al cerrar el ticket.");
    } finally {
      setClosing(false);
    }
  }

  // ── Estados de página ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
        <Loader2 size={20} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--text-3)" }} aria-hidden />
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Cargando ticket…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <LifeBuoy size={20} strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Ticket no encontrado</h2>
        <p className="max-w-sm text-sm" style={{ color: "var(--text-3)" }}>
          Puede que el enlace sea incorrecto o que el ticket ya no exista.
        </p>
        <Link href="/dashboard/soporte" className="btn-new btn-new--secondary mt-2">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Volver a Soporte
        </Link>
      </div>
    );
  }

  if (loadError || !ticket) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <LifeBuoy size={20} strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>No se pudo cargar el ticket</h2>
        <p className="max-w-sm text-sm" style={{ color: "var(--text-3)" }}>
          Revisa tu conexión e inténtalo de nuevo.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <ButtonNew variant="primary" onClick={() => loadTicket()}>Reintentar</ButtonNew>
          <Link href="/dashboard/soporte" className="btn-new btn-new--ghost">
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
          </Link>
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === "CERRADO";
  const statusLabel = SUPPORT_STATUS_LABELS_CLINIC[ticket.status] || ticket.status;
  const statusTone = STATUS_TONES[ticket.status] || "neutral";
  const categoryLabel = SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.category;
  const priorityLabel = SUPPORT_PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const priorityTone = PRIORITY_TONES[ticket.priority] || "neutral";
  const canAttachMore = pendingFiles.length < SUPPORT_MAX_FILES_PER_MESSAGE;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-3 pb-4 pt-4 sm:px-6 sm:pt-6">
      {/* Volver */}
      <Link
        href="/dashboard/soporte"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-[13px] hover:underline"
        style={{ color: "var(--text-3)" }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
      </Link>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4" style={{ borderBottom: "1px solid var(--border-soft)" }}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{ticket.folioLabel}</span>
            <BadgeNew tone={statusTone} dot>{statusLabel}</BadgeNew>
          </div>
          <h1 className="mt-1 break-words text-lg font-semibold sm:text-xl" style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}>
            {ticket.subject}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BadgeNew tone="neutral">{categoryLabel}</BadgeNew>
            <BadgeNew tone={priorityTone} dot>Prioridad: {priorityLabel}</BadgeNew>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>
              Creado el {formatDateLong(ticket.createdAt)}
            </span>
          </div>
        </div>
        {!isClosed && (
          <ButtonNew variant="secondary" onClick={() => setCloseOpen(true)}>
            Cerrar ticket
          </ButtonNew>
        )}
      </div>

      {/* Hilo */}
      <div className="flex flex-1 flex-col gap-3 py-4">
        {visibleMessages.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>
            Aún no hay mensajes en este ticket.
          </p>
        ) : (
          visibleMessages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* Banner de resuelto */}
      {ticket.status === "RESUELTO" && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
          style={{ background: "var(--success-soft)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "var(--radius)" }}
        >
          <div className="flex min-w-0 items-center gap-2 text-sm" style={{ color: "var(--success-strong)" }}>
            <CheckCircle2 size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <span>Marcamos tu ticket como resuelto. Si todo quedó bien, ciérralo y califica la atención.</span>
          </div>
          <ButtonNew variant="secondary" onClick={() => setCloseOpen(true)}>
            Cerrar y calificar
          </ButtonNew>
        </div>
      )}

      {/* Composer / aviso de cerrado */}
      {isClosed ? (
        <div className="px-4 py-5 text-center" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Este ticket está cerrado.</p>
          {typeof ticket.rating === "number" && ticket.rating >= 1 && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
              Tu calificación: <span style={{ color: "var(--warning-strong)" }}>{"★".repeat(Math.min(5, ticket.rating))}</span> ({ticket.rating}/5)
            </p>
          )}
          <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
            Si necesitas algo más, crea un ticket nuevo y te atendemos.
          </p>
          <Link href="/dashboard/soporte" className="btn-new btn-new--primary mt-3">
            Crear ticket nuevo
          </Link>
        </div>
      ) : (
        <div className="sticky bottom-0 z-10 pb-1 pt-1" style={{ background: "var(--bg)" }}>
          {/* Chips de adjuntos pendientes */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {pendingFiles.map((f, i) => (
                <span
                  key={`${f.path}-${i}`}
                  className="tag-new"
                  style={{ background: "var(--bg-elev)" }}
                >
                  {f.type && f.type.startsWith("image/")
                    ? <ImageIcon size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} aria-hidden />
                    : <FileText size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} aria-hidden />}
                  <span className="max-w-[140px] truncate" style={{ color: "var(--text-1)" }}>{f.name}</span>
                  {formatBytes(f.size) && (
                    <span style={{ color: "var(--text-3)" }}>{formatBytes(f.size)}</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Quitar ${f.name}`}
                    onClick={() => removePending(i)}
                    className="text-[color:var(--text-3)] hover:text-[color:var(--text-1)]"
                  >
                    <X size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="p-2 sm:p-3" style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, SUPPORT_MAX_BODY_CHARS))}
              onKeyDown={onComposerKeyDown}
              placeholder="Escribe tu mensaje…"
              rows={2}
              maxLength={SUPPORT_MAX_BODY_CHARS}
              disabled={sending}
              className="w-full resize-none bg-transparent px-1.5 pt-1 text-sm placeholder:text-muted-foreground focus:outline-none"
              style={{ color: "var(--text-1)" }}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                />
                <button
                  type="button"
                  onClick={() => { if (fileRef.current) fileRef.current.click(); }}
                  disabled={uploading || sending || !canAttachMore}
                  className="btn-new btn-new--ghost"
                  aria-label="Adjuntar archivo (imagen o PDF, máximo 5MB)"
                  title="Imágenes o PDF · máx. 5MB · hasta 5 por mensaje"
                >
                  {uploading
                    ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden />
                    : <Paperclip size={16} strokeWidth={1.75} aria-hidden />}
                  <span className="hidden sm:inline">{uploading ? "Subiendo…" : "Adjuntar"}</span>
                </button>
                <span className="hidden sm:inline" style={{ fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {pendingFiles.length}/{SUPPORT_MAX_FILES_PER_MESSAGE}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {body.length > SUPPORT_MAX_BODY_CHARS - 500 && (
                  <span style={{ fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                    {body.length}/{SUPPORT_MAX_BODY_CHARS}
                  </span>
                )}
                <ButtonNew
                  variant="primary"
                  onClick={handleSend}
                  disabled={sending || uploading || !body.trim()}
                  icon={sending
                    ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden />
                    : <Send size={16} strokeWidth={1.75} aria-hidden />}
                >
                  {sending ? "Enviando…" : "Enviar"}
                </ButtonNew>
              </div>
            </div>
          </div>
          <p className="mt-1.5 hidden text-center sm:block" style={{ fontSize: 11, color: "var(--text-3)" }}>
            Enter para enviar · Shift+Enter para salto de línea
          </p>
        </div>
      )}

      {/* Diálogo de cierre */}
      {closeOpen && (
        <CloseDialog
          closing={closing}
          onCancel={() => setCloseOpen(false)}
          onConfirm={handleCloseTicket}
        />
      )}
    </div>
  );
}
