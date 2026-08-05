"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /afiliados/soporte — tarjeta del manager + lista de tickets + alta.
// API: GET/POST /api/afiliados/soporte
// Contrato: src/lib/affiliate-support/types.ts.
//
// Lenguaje visual del panel de afiliados: primitivas de
// components/afiliados/ui/panel-ui + clases `dcafp-*` de
// src/app/afiliados/panel.css. Los detalles de una sola vez van inline con
// tokens var(--dcafp-*). Sin Tailwind arbitrario: la raíz de este panel mide
// 13px y los rem no cuadran.
//
// El modal sigue con las clases .modal* de globals.css (chrome compartido, no
// hay equivalente en panel.css); su INTERIOR sí está en el idioma nuevo.
//
// ⚠️ Sin adjuntos en esta ola: el bucket `affiliate-support` todavía no existe
// en Supabase, así que el formulario no ofrece subir archivos (ver la nota en
// src/lib/affiliate-support/service.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { Chip, EmptyState, PanelCard, type ChipTone } from "@/components/afiliados/ui/panel-ui";
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

// Tono del chip de estado. MISMO mapa en soporte/[id]/ticket-client.tsx —
// mantener en sincronía. Son los CINCO estados del contrato, ni uno más.
// `Chip` no tiene tono "info": ABIERTO y EN_PROGRESO caen los dos en `brand`
// (los distingue el texto, que es lo que el afiliado lee).
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

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Barra gris del esqueleto de carga (no hay clase para esto en panel.css). */
function SkelBar({ w, h = 12 }: { w: number | string; h?: number }) {
  return (
    <span
      aria-hidden
      style={{ display: "block", width: w, height: h, borderRadius: 6, background: "var(--dcafp-line-soft)" }}
    />
  );
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
      <PanelCard
        flush
        title="Tus tickets"
        sub="Te respondemos en este mismo panel."
        action={
          <button
            type="button"
            className="dcafp-btn dcafp-btn--primary dcafp-btn--sm"
            onClick={() => setShowNew(true)}
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
            Nuevo ticket
          </button>
        }
      >
        {loading ? (
          <div aria-busy="true" style={{ padding: "14px 24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <SkelBar w={96} h={10} />
                <SkelBar w="min(320px, 60%)" h={14} />
                <div style={{ display: "flex", gap: 8 }}>
                  <SkelBar w={80} h={20} />
                  <SkelBar w={112} h={20} />
                </div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: "6px 16px 20px" }}>
            <EmptyState
              icon={<LifeBuoy size={22} strokeWidth={1.8} />}
              title="Aún no tienes tickets"
              action={
                <button
                  type="button"
                  className="dcafp-btn dcafp-btn--primary"
                  onClick={() => setShowNew(true)}
                >
                  <Plus size={16} strokeWidth={2} aria-hidden />
                  Crear mi primer ticket
                </button>
              }
            >
              ¿Una comisión que no cuadra, un pago que no llegó o material que necesitas?
              Abre un ticket y el equipo de DaleControl te responde lo antes posible.
            </EmptyState>
          </div>
        ) : (
          <div className="dcafp-scrollx" style={{ padding: "0 10px 4px" }}>
            {/* Esos 10px alinean la primera columna (th/td traen 14px propios)
                con el título de la tarjeta, que va a 24px. */}
            <table className="dcafp-table">
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Prioridad</th>
                  <th scope="col">Última actividad</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((tk) => {
                  const statusLabel = AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE[tk.status] || tk.status;
                  const tone = STATUS_TONES[tk.status] || "neutral";
                  const catLabel = AFFILIATE_SUPPORT_CATEGORY_LABELS[tk.category] || tk.category;
                  const prioLabel = AFFILIATE_SUPPORT_PRIORITY_LABELS[tk.priority] || tk.priority;
                  const href = `/afiliados/soporte/${tk.id}`;
                  return (
                    <tr
                      key={tk.id}
                      style={{ cursor: "pointer" }}
                      // La fila entera navega (comodidad con el ratón), pero el
                      // enlace real del asunto es lo que hace el teclado y el
                      // lector de pantalla: si el clic salió de él, no se
                      // duplica el push.
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        router.push(href);
                      }}
                    >
                      <td style={{ minWidth: 230 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="dcafp-mono" style={{ fontSize: 11, color: "var(--dcafp-ink-3)" }}>
                            {tk.folioLabel}
                          </span>
                          <span style={{ fontSize: 11.5, color: "var(--dcafp-ink-3)" }}>{catLabel}</span>
                          {tk.affiliateUnread === true && <Chip tone="brand" dot sm>Respuesta nueva</Chip>}
                        </div>
                        <Link
                          href={href}
                          style={{
                            display: "inline-block",
                            marginTop: 3,
                            fontSize: 14,
                            fontWeight: 700,
                            color: "var(--dcafp-ink)",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {tk.subject}
                        </Link>
                      </td>
                      <td>
                        <Chip tone={tone} dot sm>{statusLabel}</Chip>
                      </td>
                      <td>
                        <Chip tone={PRIORITY_TONES[tk.priority] || "neutral"} dot sm>{prioLabel}</Chip>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="dcafp-nums" style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)" }}>
                          {formatShortDate(tk.lastActivityAt)}
                        </span>
                        {tk.rating != null && (
                          <div className="dcafp-nums" style={{ fontSize: 12, fontWeight: 700, color: "var(--dcafp-amber)", marginTop: 2 }}>
                            ★ {tk.rating}/5
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {/* Modal: nuevo ticket */}
      {showNew && (
        <div className="modal-overlay" onClick={() => { if (!submitting) setShowNew(false); }}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="af-ticket-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <div className="dcafp-h2" id="af-ticket-modal-title">Nuevo ticket</div>
              <button
                type="button"
                className="dcafp-iconbtn dcafp-iconbtn--bare"
                aria-label="Cerrar"
                onClick={() => { if (!submitting) setShowNew(false); }}
              >
                <X size={18} strokeWidth={1.9} aria-hidden />
              </button>
            </div>

            <div className="modal__body">
              <div style={{ marginBottom: 14 }}>
                <label className="dcafp-label" htmlFor="af-ticket-subject">
                  Asunto <span style={{ color: "var(--dcafp-danger)" }}>*</span>
                </label>
                <input
                  id="af-ticket-subject"
                  className="dcafp-input"
                  maxLength={AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS}
                  placeholder="Resumen breve de tu duda o problema"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <label className="dcafp-label" htmlFor="af-ticket-category">Categoría</label>
                  <select
                    id="af-ticket-category"
                    className="dcafp-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {AFFILIATE_SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{AFFILIATE_SUPPORT_CATEGORY_LABELS[c] || c}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <label className="dcafp-label" htmlFor="af-ticket-priority">Prioridad</label>
                  <select
                    id="af-ticket-priority"
                    className="dcafp-select"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {AFFILIATE_SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{AFFILIATE_SUPPORT_PRIORITY_LABELS[p] || p}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="dcafp-label" htmlFor="af-ticket-body">
                  Descripción <span style={{ color: "var(--dcafp-danger)" }}>*</span>
                </label>
                <textarea
                  id="af-ticket-body"
                  className="dcafp-textarea"
                  style={{ minHeight: 130 }}
                  maxLength={AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                  placeholder="Cuéntanos con el mayor detalle posible: qué pasó, desde cuándo y qué esperabas. Si es de una clínica referida, incluye su nombre."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div
                  className="dcafp-nums"
                  style={{ textAlign: "right", fontSize: 11.5, color: "var(--dcafp-ink-3)", marginTop: 6 }}
                >
                  {body.length}/{AFFILIATE_SUPPORT_MAX_BODY_CHARS}
                </div>
              </div>
            </div>

            <div className="modal__footer">
              <button
                type="button"
                className="dcafp-btn dcafp-btn--ghost"
                onClick={() => setShowNew(false)}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="dcafp-btn dcafp-btn--primary"
                onClick={submitTicket}
                disabled={submitting}
              >
                {submitting ? "Creando…" : "Crear ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
