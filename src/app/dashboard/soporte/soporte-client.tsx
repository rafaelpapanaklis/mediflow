"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /dashboard/soporte — lista de tickets de la clínica + modal de creación.
// API: GET/POST /api/support/tickets · POST /api/support/attachments
// Contrato: src/lib/support/types.ts (SupportTicketSummary, labels, topes).
// Textos en español neutro hardcodeados (este módulo aún no entra al i18n).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LifeBuoy, Loader2, Paperclip, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPORT_ALLOWED_MIME,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SUPPORT_MAX_SUBJECT_CHARS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS_CLINIC,
} from "@/lib/support/types";
import type { SupportAttachment, SupportTicketSummary } from "@/lib/support/types";

// Tono visual del badge de estado: ABIERTO azul/info, EN_PROGRESO violeta/brand,
// ESPERANDO_RESPUESTA ámbar, RESUELTO verde, CERRADO gris.
// MISMO mapa en soporte/[id]/ticket-client.tsx — mantener en sincronía.
type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";
const STATUS_TONES: Record<string, BadgeTone> = {
  ABIERTO: "info",
  EN_PROGRESO: "brand",
  ESPERANDO_RESPUESTA: "warning",
  RESUELTO: "success",
  CERRADO: "neutral",
};

// Prioridad → tono semántico (URGENTE rojo, ALTA ámbar, NORMAL/BAJA gris).
const PRIORITY_TONES: Record<string, BadgeTone> = {
  URGENTE: "danger",
  ALTA: "warning",
  NORMAL: "neutral",
  BAJA: "neutral",
};

const FILE_ACCEPT = SUPPORT_ALLOWED_MIME.join(",");
const MAX_FILE_MB = Math.round(SUPPORT_MAX_FILE_BYTES / (1024 * 1024));

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function SoporteClient() {
  const router = useRouter();

  // ── Lista ──────────────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Modal "Nuevo ticket" ───────────────────────────────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("DUDA");
  const [priority, setPriority] = useState("NORMAL");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchTickets(withSpinner: boolean) {
    if (withSpinner) setLoading(true);
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((json && json.error) || "No se pudieron cargar tus tickets");
        return;
      }
      const list: SupportTicketSummary[] = Array.isArray(json && json.tickets) ? json.tickets : [];
      list.sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || "")));
      setTickets(list);
    } catch {
      toast.error("Error de red al cargar tus tickets");
    } finally {
      if (withSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    fetchTickets(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setSubject("");
    setCategory("DUDA");
    setPriority("NORMAL");
    setBody("");
    setAttachments([]);
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (selected.length === 0) return;

    if (attachments.length + selected.length > SUPPORT_MAX_FILES_PER_MESSAGE) {
      toast.error(`Máximo ${SUPPORT_MAX_FILES_PER_MESSAGE} archivos por ticket`);
      return;
    }

    // Validación client-side de tipo y tamaño (el server vuelve a validar).
    const valid: File[] = [];
    for (const f of selected) {
      if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(f.type)) {
        toast.error(`"${f.name}": tipo no permitido (solo imágenes o PDF)`);
        continue;
      }
      if (f.size > SUPPORT_MAX_FILE_BYTES) {
        toast.error(`"${f.name}" supera el límite de ${MAX_FILE_MB}MB`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) return;

    // Subida SECUENCIAL (uno por uno), nunca Promise.all masivo.
    setUploading(true);
    try {
      for (const f of valid) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/support/attachments", { method: "POST", body: fd });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.path) {
          toast.error((json && json.error) || `No se pudo subir "${f.name}"`);
          continue;
        }
        setAttachments(prev => [...prev, { path: json.path, name: json.name, size: json.size, type: json.type }]);
      }
    } finally {
      setUploading(false);
    }
  }

  async function submitTicket() {
    const subj = subject.trim();
    const desc = body.trim();
    if (!subj) { toast.error("Escribe un asunto"); return; }
    if (!desc) { toast.error("Describe tu problema o duda"); return; }
    if (uploading) { toast.error("Espera a que terminen de subir los adjuntos"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subj,
          category,
          priority,
          body: desc,
          attachments: attachments.map(a => ({ path: a.path, name: a.name, size: a.size, type: a.type })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((json && json.error) || "No se pudo crear el ticket");
        return;
      }
      toast.success("Ticket creado");
      setShowNew(false);
      resetForm();
      fetchTickets(false);
      const created = json && json.ticket;
      if (created && created.id) router.push(`/dashboard/soporte/${created.id}`);
    } catch {
      toast.error("Error de red al crear el ticket");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Soporte Técnico
          </h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--text-3)" }}>
            ¿Necesitas ayuda? Levanta un ticket y te respondemos por aquí y por correo.
          </p>
        </div>
        <ButtonNew variant="primary" type="button" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setShowNew(true)}>
          Nuevo ticket
        </ButtonNew>
      </div>

      {/* Lista de tickets / skeleton / estado vacío */}
      {loading ? (
        <div className="card" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="list-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10, padding: "14px 18px" }}>
              <span className="skel-new" style={{ height: 10, width: 96 }} />
              <span className="skel-new" style={{ height: 14, width: "60%", maxWidth: 320 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <span className="skel-new" style={{ height: 20, width: 80, borderRadius: 20 }} />
                <span className="skel-new" style={{ height: 20, width: 112, borderRadius: 20 }} />
              </div>
            </div>
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="card">
          <div className="flex flex-col items-center justify-center text-center px-6 py-16">
            <LifeBuoy size={32} className="mb-4" strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
            <div className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>Aún no tienes tickets</div>
            <p className="text-sm mt-1.5 max-w-sm" style={{ color: "var(--text-3)" }}>
              Si encuentras un error, tienes una duda o quieres sugerir algo, levanta un ticket
              y el equipo de DaleControl te responderá lo antes posible.
            </p>
            <ButtonNew variant="primary" type="button" className="mt-5" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setShowNew(true)}>
              Crear mi primer ticket
            </ButtonNew>
          </div>
        </div>
      ) : (
        <div className="card">
          {tickets.map(tk => {
            const statusLabel = SUPPORT_STATUS_LABELS_CLINIC[tk.status] || tk.status;
            const tone = STATUS_TONES[tk.status] || "neutral";
            const catLabel = SUPPORT_CATEGORY_LABELS[tk.category] || tk.category;
            const prioLabel = SUPPORT_PRIORITY_LABELS[tk.priority] || tk.priority;
            return (
              <button
                key={tk.id}
                type="button"
                onClick={() => router.push(`/dashboard/soporte/${tk.id}`)}
                className="list-row w-full text-left"
                style={{ display: "block", padding: "14px 18px" }}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{tk.folioLabel}</span>
                      {tk.clinicUnread === true && (
                        <BadgeNew tone="brand" dot>Respuesta nueva</BadgeNew>
                      )}
                    </div>
                    <div className="truncate mt-1" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                      {tk.subject}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <BadgeNew tone="neutral">{catLabel}</BadgeNew>
                      <BadgeNew tone={tone} dot>{statusLabel}</BadgeNew>
                      <BadgeNew tone={PRIORITY_TONES[tk.priority] || "neutral"} dot>{prioLabel}</BadgeNew>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-1.5 flex-shrink-0">
                    <span className="whitespace-nowrap" style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{formatShortDate(tk.lastActivityAt)}</span>
                    {tk.rating != null && (
                      <span className="whitespace-nowrap" style={{ fontSize: 12, color: "var(--warning-strong)", fontVariantNumeric: "tabular-nums" }}>★ {tk.rating}/5</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal: nuevo ticket */}
      {showNew && (
        <div className="modal-overlay" onClick={() => { if (!submitting && !uploading) setShowNew(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nuevo ticket</div>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar"
                onClick={() => { if (!submitting) setShowNew(false); }}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div className="modal__body">
              <div className="field-new" style={{ marginBottom: 14 }}>
                <label className="field-new__label">Asunto <span className="req">*</span></label>
                <input
                  className="input-new"
                  maxLength={SUPPORT_MAX_SUBJECT_CHARS}
                  placeholder="Resumen breve de tu problema o duda"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
                <div className="field-new">
                  <label className="field-new__label">Categoría</label>
                  <select className="input-new" value={category} onChange={e => setCategory(e.target.value)}>
                    {SUPPORT_CATEGORIES.map(c => (
                      <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c] || c}</option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Prioridad</label>
                  <select className="input-new" value={priority} onChange={e => setPriority(e.target.value)}>
                    {SUPPORT_PRIORITIES.map(p => (
                      <option key={p} value={p}>{SUPPORT_PRIORITY_LABELS[p] || p}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-new" style={{ marginBottom: 14 }}>
                <label className="field-new__label">Descripción <span className="req">*</span></label>
                <textarea
                  className="input-new"
                  style={{ height: 120, paddingTop: 10, resize: "vertical" }}
                  maxLength={SUPPORT_MAX_BODY_CHARS}
                  placeholder="Cuéntanos qué pasa con el mayor detalle posible: dónde ocurre, desde cuándo, qué esperabas que pasara…"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                />
                <div className="mono text-right text-xs mt-1" style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {body.length}/{SUPPORT_MAX_BODY_CHARS}
                </div>
              </div>

              <div className="field-new">
                <label className="field-new__label">
                  Adjuntos (opcional · máx. {SUPPORT_MAX_FILES_PER_MESSAGE} · {MAX_FILE_MB}MB c/u · imágenes o PDF)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  className="hidden"
                  onChange={handleFilesSelected}
                />
                <div className="flex flex-col gap-2">
                  {attachments.map((f, i) => (
                    <div key={`${f.path}-${i}`} className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-sm)" }}>
                      <FileText size={16} strokeWidth={1.75} className="flex-shrink-0" style={{ color: "var(--text-3)" }} aria-hidden />
                      <span className="text-sm truncate flex-1 min-w-0" style={{ color: "var(--text-1)" }}>{f.name}</span>
                      <span className="mono text-xs flex-shrink-0" style={{ color: "var(--text-3)" }}>{formatBytes(f.size)}</span>
                      <button
                        type="button"
                        className="flex-shrink-0 transition-colors text-[color:var(--text-3)] hover:text-[color:var(--danger)]"
                        aria-label={`Quitar ${f.name}`}
                        onClick={() => removeAttachment(i)}
                        disabled={submitting}
                      >
                        <X size={16} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                  {uploading && (
                    <div className="flex items-center gap-2 text-sm px-1" style={{ color: "var(--text-3)" }}>
                      <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden /> Subiendo…
                    </div>
                  )}
                  <div>
                    <ButtonNew
                      variant="secondary"
                      size="sm"
                      type="button"
                      icon={<Paperclip size={16} strokeWidth={1.75} />}
                      onClick={() => { if (fileInputRef.current) fileInputRef.current.click(); }}
                      disabled={uploading || submitting || attachments.length >= SUPPORT_MAX_FILES_PER_MESSAGE}
                    >
                      {uploading ? "Subiendo…" : "Adjuntar archivos"}
                    </ButtonNew>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setShowNew(false)} disabled={submitting}>
                Cancelar
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={submitTicket} disabled={submitting || uploading}>
                {submitting ? "Creando…" : "Crear ticket"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
