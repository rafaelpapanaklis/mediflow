"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /afiliados/soporte — tarjeta del manager + lista de tickets + alta.
// API: GET/POST /api/afiliados/soporte
// Contrato: src/lib/affiliate-support/types.ts.
//
// Estilo del panel de afiliados: inline styles con variables CSS y las clases
// globales (card/list-row/modal/field-new/input-new/btn-new). Sin Tailwind
// arbitrario: la raíz de este panel mide 13px y los rem no cuadran.
//
// ⚠️ Sin adjuntos en esta ola: el bucket `affiliate-support` todavía no existe
// en Supabase, así que el formulario no ofrece subir archivos (ver la nota en
// src/lib/affiliate-support/service.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  AFFILIATE_SUPPORT_CATEGORIES,
  AFFILIATE_SUPPORT_CATEGORY_LABELS,
  AFFILIATE_SUPPORT_MAX_BODY_CHARS,
  AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS,
  AFFILIATE_SUPPORT_PRIORITIES,
  AFFILIATE_SUPPORT_PRIORITY_LABELS,
  AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE,
} from "@/lib/affiliate-support/types";
import type { AffiliateTicketSummary } from "@/lib/affiliate-support/types";
import type { AccountManagerDTO } from "@/lib/account-manager/types";
import { AffiliateManagerCard } from "@/components/afiliados/affiliate-manager-card";

// Tono del badge de estado. MISMO mapa en soporte/[id]/ticket-client.tsx —
// mantener en sincronía.
type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";
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

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  manager: AccountManagerDTO | null;
  online: boolean;
  scheduleText: string;
  nextAvailable: string;
  affiliateName: string;
  referralCode: string;
}

export function SoporteAfiliadoClient({
  manager,
  online,
  scheduleText,
  nextAvailable,
  affiliateName,
  referralCode,
}: Props) {
  const router = useRouter();

  const [tickets, setTickets] = useState<AffiliateTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Modal "Nuevo ticket" ─────────────────────────────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("DUDA");
  const [priority, setPriority] = useState("NORMAL");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function fetchTickets(withSpinner: boolean) {
    if (withSpinner) setLoading(true);
    try {
      const res = await fetch("/api/afiliados/soporte", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((json && json.error) || "No se pudieron cargar tus tickets");
        return;
      }
      const list: AffiliateTicketSummary[] = Array.isArray(json && json.tickets) ? json.tickets : [];
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
  }

  async function submitTicket() {
    const subj = subject.trim();
    const desc = body.trim();
    if (!subj) { toast.error("Escribe un asunto"); return; }
    if (!desc) { toast.error("Cuéntanos tu duda o problema"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/afiliados/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subj, category, priority, body: desc }),
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
      if (created && created.id) router.push(`/afiliados/soporte/${created.id}`);
    } catch {
      toast.error("Error de red al crear el ticket");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Manager de cuenta — va ARRIBA: el afiliado llegó aquí con una duda, así
          que ve su canal directo antes de ponerse a escribir un ticket. */}
      <AffiliateManagerCard
        manager={manager}
        online={online}
        scheduleText={scheduleText}
        nextAvailable={nextAvailable}
        affiliateName={affiliateName}
        referralCode={referralCode}
        onOpenTicket={() => setShowNew(true)}
      />

      {/* Lista de tickets */}
      <div className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Tus tickets</div>
            <div className="card__sub">Te respondemos en este mismo panel.</div>
          </div>
          <ButtonNew
            variant="primary"
            size="sm"
            type="button"
            icon={<Plus size={14} strokeWidth={1.75} />}
            onClick={() => setShowNew(true)}
          >
            Nuevo ticket
          </ButtonNew>
        </div>

        {loading ? (
          <div aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="list-row"
                style={{ flexDirection: "column", alignItems: "flex-start", gap: 10, padding: "14px 18px" }}
              >
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "56px 24px",
            }}
          >
            <LifeBuoy size={32} strokeWidth={1.75} style={{ color: "var(--text-4)", marginBottom: 14 }} aria-hidden />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>Aún no tienes tickets</div>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 6, marginBottom: 0, maxWidth: "46ch", lineHeight: 1.55 }}>
              ¿Una comisión que no cuadra, un pago que no llegó o material que necesitas?
              Abre un ticket y el equipo de DaleControl te responde lo antes posible.
            </p>
            <div style={{ marginTop: 18 }}>
              <ButtonNew
                variant="primary"
                type="button"
                icon={<Plus size={16} strokeWidth={1.75} />}
                onClick={() => setShowNew(true)}
              >
                Crear mi primer ticket
              </ButtonNew>
            </div>
          </div>
        ) : (
          <div>
            {tickets.map((tk) => {
              const statusLabel = AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE[tk.status] || tk.status;
              const tone = STATUS_TONES[tk.status] || "neutral";
              const catLabel = AFFILIATE_SUPPORT_CATEGORY_LABELS[tk.category] || tk.category;
              const prioLabel = AFFILIATE_SUPPORT_PRIORITY_LABELS[tk.priority] || tk.priority;
              return (
                <button
                  key={tk.id}
                  type="button"
                  onClick={() => router.push(`/afiliados/soporte/${tk.id}`)}
                  className="list-row"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 18px",
                    background: "none",
                    // Solo se quitan 3 bordes: el inferior lo pone .list-row y
                    // su :last-child lo retira en la última fila. Un
                    // `border: none` inline mataría también esa separación.
                    borderTop: "none",
                    borderLeft: "none",
                    borderRight: "none",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{tk.folioLabel}</span>
                        {tk.affiliateUnread === true && <BadgeNew tone="brand" dot>Respuesta nueva</BadgeNew>}
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--text-1)",
                          marginTop: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tk.subject}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        <BadgeNew tone="neutral">{catLabel}</BadgeNew>
                        <BadgeNew tone={tone} dot>{statusLabel}</BadgeNew>
                        <BadgeNew tone={PRIORITY_TONES[tk.priority] || "neutral"} dot>{prioLabel}</BadgeNew>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {formatShortDate(tk.lastActivityAt)}
                      </span>
                      {tk.rating != null && (
                        <span style={{ fontSize: 12, color: "var(--warning-strong)", whiteSpace: "nowrap" }}>
                          ★ {tk.rating}/5
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: nuevo ticket */}
      {showNew && (
        <div className="modal-overlay" onClick={() => { if (!submitting) setShowNew(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                  maxLength={AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS}
                  placeholder="Resumen breve de tu duda o problema"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
                <div className="field-new" style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <label className="field-new__label">Categoría</label>
                  <select className="input-new" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {AFFILIATE_SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{AFFILIATE_SUPPORT_CATEGORY_LABELS[c] || c}</option>
                    ))}
                  </select>
                </div>
                <div className="field-new" style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <label className="field-new__label">Prioridad</label>
                  <select className="input-new" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {AFFILIATE_SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{AFFILIATE_SUPPORT_PRIORITY_LABELS[p] || p}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-new">
                <label className="field-new__label">Descripción <span className="req">*</span></label>
                <textarea
                  className="input-new"
                  style={{ height: 130, paddingTop: 10, resize: "vertical" }}
                  maxLength={AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                  placeholder="Cuéntanos con el mayor detalle posible: qué pasó, desde cuándo y qué esperabas. Si es de una clínica referida, incluye su nombre."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div
                  className="mono"
                  style={{ textAlign: "right", fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}
                >
                  {body.length}/{AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setShowNew(false)} disabled={submitting}>
                Cancelar
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={submitTicket} disabled={submitting}>
                {submitting ? "Creando…" : "Crear ticket"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
