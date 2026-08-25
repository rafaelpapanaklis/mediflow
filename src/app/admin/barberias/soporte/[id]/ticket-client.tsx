"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias/soporte/[id] — hilo completo de un ticket de barbería.
//
// Muestra el hilo con sus adjuntos (URLs firmadas con TTL corto contra el
// bucket privado barber-files), permite RESPONDER COMO ADMIN —el mensaje se
// guarda con authorType = "ADMIN", que es la etiqueta que lee el lado de la
// barbería— y cambiar estado / prioridad.
//
// API: GET/PATCH /api/admin/barberias/soporte/[id]
//      POST      /api/admin/barberias/soporte/[id]/messages
//      POST      /api/admin/barberias/soporte/[id]/attachments
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, FileText, Paperclip, Send, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  BARBER_TICKET_CATEGORY_LABELS,
  type BarberSupportAttachment,
  type BarberTicketCategory,
  type BarberTicketPriority,
  type BarberTicketStatus,
} from "@/lib/barber/types";
import type { AdminBarberMessageDTO, AdminBarberTicketDetail } from "@/lib/barber/admin";
import {
  BARBER_SUPPORT_ACCEPT,
  BARBER_SUPPORT_ALLOWED_MIME,
  BARBER_SUPPORT_MAX_FILES,
  BARBER_SUPPORT_MAX_FILE_BYTES,
  PLAN_TONES,
  TICKET_PRIORITY_FACE,
  TICKET_STATUS_FACE,
  formatBytes,
  fullDate,
  subscriptionFace,
} from "@/components/admin/barberias/shared";
import "@/components/admin/barberias/barberias.css";

const STATUSES: BarberTicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_REPLY", "CLOSED"];
const PRIORITIES: BarberTicketPriority[] = ["LOW", "NORMAL", "HIGH"];
const MAX_BODY = 5000;

function Attachments({ items }: { items: Array<BarberSupportAttachment & { signedUrl?: string }> }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="dcba-atts">
      {items.map((a, i) => {
        const key = `${a.path || a.name}-${i}`;
        const isImage = typeof a.type === "string" && a.type.startsWith("image/");
        if (a.signedUrl && isImage) {
          return (
            <a key={key} href={a.signedUrl} target="_blank" rel="noopener noreferrer" title={a.name} style={{ lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="dcba-thumb" src={a.signedUrl} alt={a.name || "Adjunto"} loading="lazy" />
            </a>
          );
        }
        if (a.signedUrl) {
          return (
            <a key={key} className="dcba-chip" href={a.signedUrl} target="_blank" rel="noopener noreferrer" title={a.name}>
              <FileText size={12} style={{ flexShrink: 0 }} />
              <span className="dcba-chip__name">{a.name || "Documento"}</span>
            </a>
          );
        }
        return (
          <span key={key} className="dcba-chip" style={{ opacity: 0.7 }} title="Adjunto no disponible">
            <Paperclip size={12} style={{ flexShrink: 0 }} />
            <span className="dcba-chip__name">{a.name || "Adjunto"}</span>
          </span>
        );
      })}
    </div>
  );
}

function Message({ message }: { message: AdminBarberMessageDTO }) {
  const isAdmin = message.authorType === "ADMIN";
  return (
    <div className={`dcba-bubble ${isAdmin ? "dcba-bubble--admin" : ""}`}>
      <div className="dcba-bubble__head">
        <span className="dcba-bubble__who">
          {message.authorName || (isAdmin ? "Soporte DaleControl" : "Barbería")}
        </span>
        {isAdmin && <BadgeNew tone="brand">DaleControl</BadgeNew>}
        <span className="dcba-bubble__when">{fullDate(message.createdAt)}</span>
      </div>
      <div className="dcba-bubble__body">{message.body}</div>
      <Attachments items={message.attachments} />
    </div>
  );
}

export function AdminBarberTicketClient({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<AdminBarberTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState<"status" | "priority" | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<BarberSupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const hasData = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/barberias/soporte/${ticketId}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AdminBarberTicketDetail;
      setData(json);
      hasData.current = true;
      setLoadError(false);
    } catch {
      if (!hasData.current) setLoadError(true);
      else toast.error("No se pudo actualizar el ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  async function patch(field: "status" | "priority", value: string) {
    setSaving(field);
    try {
      const res = await fetch(`/api/admin/barberias/soporte/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || "No se pudo actualizar");
        return;
      }
      toast.success(field === "status" ? "Estado actualizado" : "Prioridad actualizada");
      await load();
    } catch {
      toast.error("Error de red");
    } finally {
      setSaving(null);
    }
  }

  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = BARBER_SUPPORT_MAX_FILES - pending.length;
    if (room <= 0) {
      toast.error(`Máximo ${BARBER_SUPPORT_MAX_FILES} archivos por mensaje`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (!(BARBER_SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
          toast.error(`${file.name}: tipo no permitido`);
          continue;
        }
        if (file.size > BARBER_SUPPORT_MAX_FILE_BYTES) {
          toast.error(`${file.name}: pasa de 5 MB`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/admin/barberias/soporte/${ticketId}/attachments`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(json?.error || `No se pudo subir ${file.name}`);
          continue;
        }
        setPending((prev) => [...prev, json as BarberSupportAttachment]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/barberias/soporte/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, attachments: pending }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || "No se pudo enviar la respuesta");
        return;
      }
      setBody("");
      setPending([]);
      toast.success("Respuesta enviada a la barbería");
      await load();
    } catch {
      toast.error("Error de red al enviar");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="dcba">
        <CardNew>
          <span className="skel-new" style={{ width: 220, height: 14, display: "block" }} />
        </CardNew>
      </div>
    );
  }

  if (notFound || loadError || !data) {
    return (
      <div className="dcba">
        <Link href="/admin/barberias/soporte" className="dcba-backlink">
          <ArrowLeft size={14} />
          Soporte de barberías
        </Link>
        <CardNew>
          <div className="dcba-empty">
            <div className="dcba-empty__title">
              {notFound ? "Ese ticket no existe" : "No se pudo cargar el ticket"}
            </div>
            <div className="dcba-empty__body">
              {notFound
                ? "Puede que se haya borrado junto con su barbería."
                : "Revisa tu conexión o tu sesión de admin."}
            </div>
          </div>
        </CardNew>
      </div>
    );
  }

  const { ticket, messages } = data;
  const shopFace = subscriptionFace(ticket.barbershopStatus);

  return (
    <div className="dcba">
      <Link href="/admin/barberias/soporte" className="dcba-backlink">
        <ArrowLeft size={14} />
        Soporte de barberías
      </Link>

      <div className="dcba-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="dcba-title">{ticket.subject}</h1>
          <p className="dcba-sub">
            <Link href={`/admin/barberias/${ticket.barbershopId}`} style={{ color: "var(--text-2)" }}>
              {ticket.barbershopName}
            </Link>
            {ticket.createdByName ? ` · abierto por ${ticket.createdByName}` : ""}
            {ticket.createdByEmail ? ` (${ticket.createdByEmail})` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <BadgeNew tone={PLAN_TONES[ticket.barbershopPlan] ?? "neutral"}>
            {ticket.barbershopPlan}
          </BadgeNew>
          <BadgeNew tone={shopFace.tone} dot>
            {shopFace.label}
          </BadgeNew>
        </div>
      </div>

      {/* ── Meta + controles de estado ─────────────────────────────── */}
      <div className="dcba-section">
        <CardNew>
          <div className="dcba-grid3" style={{ gap: 14 }}>
            <div>
              <div className="dcba-label">Categoría</div>
              <div className="dcba-value">
                {BARBER_TICKET_CATEGORY_LABELS[ticket.category as BarberTicketCategory] ?? ticket.category}
              </div>
            </div>
            <div>
              <div className="dcba-label">Abierto</div>
              <div className="dcba-value">{fullDate(ticket.createdAt)}</div>
            </div>
            <div>
              <div className="dcba-label">Espera</div>
              <div className="dcba-value">
                {ticket.needsReply && ticket.waitingHours != null ? (
                  <BadgeNew tone={ticket.waitingHours > 24 ? "danger" : "warning"}>
                    {Math.round(ticket.waitingHours)} h sin respuesta nuestra
                  </BadgeNew>
                ) : (
                  <BadgeNew tone="success" dot>
                    Ya respondimos
                  </BadgeNew>
                )}
              </div>
            </div>
            <div>
              <div className="dcba-label">Estado</div>
              <select
                className="input-new"
                value={ticket.status}
                disabled={saving === "status"}
                onChange={(e) => patch("status", e.target.value)}
                aria-label="Cambiar estado del ticket"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_FACE[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="dcba-label">Prioridad</div>
              <select
                className="input-new"
                value={ticket.priority}
                disabled={saving === "priority"}
                onChange={(e) => patch("priority", e.target.value)}
                aria-label="Cambiar prioridad del ticket"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TICKET_PRIORITY_FACE[p].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="dcba-label">Cerrado</div>
              <div className="dcba-value">{ticket.closedAt ? fullDate(ticket.closedAt) : "—"}</div>
            </div>
          </div>
        </CardNew>
      </div>

      {/* ── Hilo ───────────────────────────────────────────────────── */}
      <div className="dcba-section">
        <CardNew>
          <div className="dcba-thread">
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {messages.length === 0 && (
              <p className="dcba-note">El ticket no tiene mensajes todavía.</p>
            )}
            <div ref={threadEnd} />
          </div>
        </CardNew>
      </div>

      {/* ── Responder como ADMIN ───────────────────────────────────── */}
      <CardNew>
        <div className="dcba-cardtitle">
          <Send size={14} />
          Responder como DaleControl
        </div>
        <div className="dcba-composer">
          <textarea
            className="dcba-textarea"
            value={body}
            maxLength={MAX_BODY}
            placeholder="Escribe la respuesta que verá la barbería…"
            onChange={(e) => setBody(e.target.value)}
            disabled={sending}
          />

          {pending.length > 0 && (
            <div className="dcba-atts">
              {pending.map((a) => (
                <span key={a.path} className="dcba-chip">
                  <Paperclip size={12} style={{ flexShrink: 0 }} />
                  <span className="dcba-chip__name">{a.name}</span>
                  <span style={{ opacity: 0.65 }}>{formatBytes(a.size)}</span>
                  <button
                    type="button"
                    aria-label={`Quitar ${a.name}`}
                    onClick={() => setPending((prev) => prev.filter((x) => x.path !== a.path))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="dcba-composer__foot">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={BARBER_SUPPORT_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => pickFiles(e.target.files)}
            />
            <ButtonNew
              size="sm"
              variant="secondary"
              icon={<Paperclip size={14} />}
              onClick={() => fileRef.current?.click()}
              disabled={uploading || sending || pending.length >= BARBER_SUPPORT_MAX_FILES}
            >
              {uploading ? "Subiendo…" : "Adjuntar"}
            </ButtonNew>
            <span className="dcba-note">
              Imágenes o PDF, máx 5 MB · {pending.length}/{BARBER_SUPPORT_MAX_FILES}
            </span>
            <span className="dcba-composer__spacer" />
            <span className="dcba-note">
              {body.trim().length}/{MAX_BODY}
            </span>
            <ButtonNew
              size="sm"
              variant="primary"
              icon={<Send size={14} />}
              onClick={send}
              disabled={sending || uploading || body.trim().length === 0}
            >
              {sending ? "Enviando…" : "Enviar respuesta"}
            </ButtonNew>
          </div>
          <p className="dcba-note">
            Se guarda con la etiqueta <span className="mono">ADMIN</span> y deja el ticket en
            &quot;esperando a la barbería&quot;.
          </p>
        </div>
      </CardNew>
    </div>
  );
}
