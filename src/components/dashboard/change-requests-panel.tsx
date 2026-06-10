"use client";

// Panel de solicitudes de cambio de cita (pedidas por pacientes desde el portal)
// para la agenda del dashboard (WS1-T5). Lo monta agenda-page-client.tsx DENTRO
// de <AgendaProvider> (usa useAgenda() para la timezone de la clínica, igual que
// AgendaValidateBanner).
//
// CONTRATO:
//   export function ChangeRequestsPanel(props: { onResolved?: () => void }): JSX.Element | null
//
// - SWR: GET /api/appointment-change-requests?status=PENDING (30s + focus).
// - 0 pendientes → null.
// - POST /api/appointment-change-requests/{id}/resolve { action, note }.
//   409 slot_taken → toast + mutate() (quedó REJECTED y desaparece).
// - Tras resolver: mutate() + onResolved?.() (la agenda refresca citas).

import { useState } from "react";
import useSWR from "swr";
import toast from "react-hot-toast";
import { CalendarClock, Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";

interface ChangeRequestDTO {
  id: string;
  type: "RESCHEDULE" | "CANCEL";
  status: string;
  reason?: string | null;
  proposedStartsAt?: string | null;
  proposedEndsAt?: string | null;
  autoApproved?: boolean;
  createdAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  resolvedByName?: string | null;
  patient: { id: string; firstName: string; lastName: string; phone?: string | null };
  appointment: {
    id: string;
    startsAt: string;
    endsAt?: string | null;
    type?: string | null;
    status?: string;
    doctorId?: string | null;
    doctorName?: string | null;
  };
}

interface ChangeRequestsResponse {
  requests: ChangeRequestDTO[];
}

const ENDPOINT = "/api/appointment-change-requests?status=PENDING";

async function fetcher(url: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

/** "hace X min/h/días" relativo simple para createdAt. */
function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** Fecha corta es-MX en la timezone de la clínica: "mié 12 jun". */
function formatDayShort(iso: string, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  try {
    return new Intl.DateTimeFormat("es-MX", { ...opts, timeZone: timezone || "America/Mexico_City" }).format(new Date(iso));
  } catch {
    // Timezone inválida en datos → fallback a la tz del navegador.
    return new Intl.DateTimeFormat("es-MX", opts).format(new Date(iso));
  }
}

/** "mié 12 jun · 09:30" (+ "–10:00" si hay fin). */
function formatDayTimeRange(startIso: string, endIso: string | null | undefined, timezone: string): string {
  const base = `${formatDayShort(startIso, timezone)} · ${formatTimeInTz(startIso, timezone)}`;
  if (!endIso) return base;
  return `${base}–${formatTimeInTz(endIso, timezone)}`;
}

export function ChangeRequestsPanel(props: { onResolved?: () => void }): JSX.Element | null {
  const { onResolved } = props;
  const { state } = useAgenda();
  const timezone = state.timezone;
  const confirmWithReason = useConfirmWithReason();
  const [expanded, setExpanded] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const { data, mutate } = useSWR<ChangeRequestsResponse>(ENDPOINT, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  // Defensivo: el endpoint ya filtra PENDING, pero re-filtramos por si el
  // shape trae estados mezclados tras un mutate optimista.
  const requests = (data?.requests ?? []).filter((r) => r.status === "PENDING");
  if (requests.length === 0) return null;

  function markResolving(id: string, on: boolean) {
    setResolvingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function resolve(req: ChangeRequestDTO, action: "APPROVE" | "REJECT", note?: string) {
    if (resolvingIds.has(req.id)) return;
    markResolving(req.id, true);
    try {
      const body: { action: "APPROVE" | "REJECT"; note?: string } = { action };
      if (note && note.trim().length > 0) body.note = note.trim();
      const res = await fetch(`/api/appointment-change-requests/${req.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        const err = await res.json().catch(() => null);
        if (err?.error === "slot_taken") {
          toast.error("El horario propuesto ya está ocupado; la solicitud se rechazó automáticamente");
          void mutate(); // quedó REJECTED en el server → desaparece del panel
        } else {
          toast.error("Esta solicitud ya fue resuelta");
          void mutate();
          onResolved?.();
        }
        return;
      }
      if (!res.ok) throw new Error(`resolve_failed_${res.status}`);

      toast.success(
        action === "APPROVE"
          ? req.type === "CANCEL" ? "Cancelación aprobada" : "Cambio de horario aprobado"
          : "Solicitud rechazada",
      );
      void mutate();
      onResolved?.();
    } catch {
      toast.error("No se pudo resolver la solicitud. Intenta de nuevo.");
    } finally {
      markResolving(req.id, false);
    }
  }

  async function handleReject(req: ChangeRequestDTO) {
    const patientName = `${req.patient.firstName} ${req.patient.lastName}`.trim();
    const result = await confirmWithReason({
      title: req.type === "CANCEL" ? "¿Rechazar la cancelación?" : "¿Rechazar el cambio de horario?",
      description: `La cita de ${patientName} se queda como está y el paciente verá tu respuesta en su portal.`,
      confirmText: "Rechazar solicitud",
      cancelText: "Volver",
      variant: "danger",
      withReason: true,
      reasonLabel: "Motivo (opcional)",
      reasonPlaceholder: "Ej. no tenemos espacio en ese horario…",
    });
    if (!result.confirmed) return;
    void resolve(req, "REJECT", result.reason);
  }

  return (
    <section className="mfcr-banner" aria-label="Solicitudes de cambio de cita de pacientes">
      <div className="mfcr-head">
        <div className="mfcr-title">
          <CalendarClock size={14} aria-hidden />
          <span>
            <strong>{requests.length}</strong>{" "}
            {requests.length === 1
              ? "solicitud de cambio de paciente"
              : "solicitudes de cambio de pacientes"}
          </span>
        </div>
        <button
          type="button"
          className="mfcr-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Colapsar solicitudes" : "Expandir solicitudes"}
          title={expanded ? "Colapsar" : "Expandir"}
        >
          {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      </div>

      {expanded && (
        <ul className="mfcr-list" role="list">
          {requests.map((req) => {
            const busy = resolvingIds.has(req.id);
            const isCancel = req.type === "CANCEL";
            return (
              <li key={req.id} className="mfcr-row">
                <div className="mfcr-main">
                  <div className="mfcr-line">
                    <span className={`mfcr-badge ${isCancel ? "mfcr-badge-cancel" : "mfcr-badge-resched"}`}>
                      {isCancel ? "Cancelación" : "Reagendar"}
                    </span>
                    <span className="mfcr-patient">
                      {req.patient.firstName} {req.patient.lastName}
                    </span>
                    {req.patient.phone && <span className="mfcr-muted">· {req.patient.phone}</span>}
                    <span className="mfcr-ago">{timeAgo(req.createdAt)}</span>
                  </div>
                  <div className="mfcr-line">
                    <span className="mfcr-current">
                      Cita: {formatDayTimeRange(req.appointment.startsAt, req.appointment.endsAt, timezone)}
                    </span>
                    {req.appointment.doctorName && (
                      <span className="mfcr-muted">· {req.appointment.doctorName}</span>
                    )}
                    {req.appointment.type && <span className="mfcr-muted">· {req.appointment.type}</span>}
                  </div>
                  {!isCancel && req.proposedStartsAt && (
                    <div className="mfcr-line">
                      <span className="mfcr-proposed">
                        Propone: {formatDayTimeRange(req.proposedStartsAt, req.proposedEndsAt, timezone)}
                      </span>
                    </div>
                  )}
                  {req.reason && <div className="mfcr-reason">«{req.reason}»</div>}
                </div>
                <div className="mfcr-actions">
                  <button
                    type="button"
                    className="mfcr-btn mfcr-btn-reject"
                    onClick={() => void handleReject(req)}
                    disabled={busy}
                  >
                    <X size={12} aria-hidden /> Rechazar
                  </button>
                  <button
                    type="button"
                    className="mfcr-btn mfcr-btn-approve"
                    onClick={() => void resolve(req, "APPROVE")}
                    disabled={busy}
                  >
                    <Check size={12} aria-hidden /> {busy ? "Resolviendo…" : "Aprobar"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Prefijo mfcr- para no chocar con clases globales. Media query para
          filas apiladas en mobile (inline styles no soportan breakpoints). */}
      <style jsx global>{`
        .mfcr-banner {
          margin: 0;
          background: color-mix(in srgb, var(--brand, #7c3aed) 7%, var(--bg-elev));
          border-bottom: 1px solid color-mix(in srgb, var(--brand, #7c3aed) 28%, transparent);
          padding: 10px 16px 12px;
          font-family: var(--font-sans, system-ui, sans-serif);
          flex-shrink: 0;
        }
        .mfcr-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .mfcr-title {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 12px; color: var(--brand, #7c3aed);
          font-weight: 500;
        }
        .mfcr-title strong {
          font-weight: 700;
          font-family: var(--font-mono, monospace);
          font-size: 13px;
        }
        .mfcr-toggle {
          width: 24px; height: 24px;
          display: grid; place-items: center;
          background: var(--bg-elev);
          border: 1px solid var(--border-soft);
          border-radius: 5px;
          color: var(--text-2);
          cursor: pointer;
        }
        .mfcr-toggle:hover { color: var(--text-1); }
        .mfcr-list {
          list-style: none; margin: 8px 0 0; padding: 0;
          display: flex; flex-direction: column; gap: 4px;
        }
        .mfcr-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          background: var(--bg-elev);
          border: 1px solid var(--border-soft);
          border-radius: 7px;
        }
        .mfcr-main {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; gap: 3px;
          font-size: 12px;
        }
        .mfcr-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .mfcr-badge {
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
          padding: 2px 7px; border-radius: 999px;
          flex-shrink: 0;
        }
        .mfcr-badge-resched {
          background: rgba(124, 58, 237, 0.12);
          color: var(--brand, #7c3aed);
          border: 1px solid rgba(124, 58, 237, 0.3);
        }
        .mfcr-badge-cancel {
          background: rgba(220, 38, 38, 0.1);
          color: #dc2626;
          border: 1px solid rgba(220, 38, 38, 0.3);
        }
        .mfcr-patient { font-weight: 600; color: var(--text-1); }
        .mfcr-muted { color: var(--text-3); font-size: 11px; }
        .mfcr-ago { margin-left: auto; color: var(--text-3); font-size: 11px; }
        .mfcr-current {
          color: var(--text-2); font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .mfcr-proposed {
          color: var(--brand, #7c3aed); font-weight: 600; font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .mfcr-reason {
          color: var(--text-3); font-size: 11px; font-style: italic;
          overflow: hidden; text-overflow: ellipsis;
        }
        .mfcr-actions { display: inline-flex; gap: 6px; flex-shrink: 0; }
        .mfcr-btn {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 11px;
          font-size: 11px; font-weight: 700;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 0.15s ease;
        }
        .mfcr-btn:disabled { opacity: 0.55; cursor: default; }
        .mfcr-btn-approve {
          background: var(--brand, #7c3aed);
          border: 1px solid var(--brand, #7c3aed);
          color: #fff;
        }
        .mfcr-btn-approve:hover:not(:disabled) { filter: brightness(1.08); }
        .mfcr-btn-reject {
          background: transparent;
          border: 1px solid rgba(220, 38, 38, 0.45);
          color: #dc2626;
        }
        .mfcr-btn-reject:hover:not(:disabled) { background: rgba(220, 38, 38, 0.08); }
        @media (max-width: 640px) {
          .mfcr-row { flex-direction: column; align-items: stretch; }
          .mfcr-actions { justify-content: flex-end; }
        }
      `}</style>
    </section>
  );
}
