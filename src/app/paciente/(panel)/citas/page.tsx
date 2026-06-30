"use client";

// Citas del paciente. Implementa A6.
// Datos: usePacienteData<PacienteCitasResponse>("/api/paciente/appointments").
// · Dos secciones: "Próximas" y "Anteriores" (tabs o bloques apilados).
// · ClinicFilterChips si hay 2+ clínicas (filtra ambas listas por clinicId).
// · Cada cita: fecha/hora local (formatFechaHora), motivo (type), doctor,
//   clínica (si 2+), StatusBadge kind="cita".
// · Estados vacíos: "No tienes citas próximas" / "Aún no tienes citas pasadas".
// · Responsive: lista de cards en móvil; en desktop puede ser tabla fluida
//   (width 100%, sin min-width que corte).
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteCita, PacienteCitasResponse } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  ClinicFilterChips,
  StatusBadge,
  clinicName,
  formatFechaHora,
} from "@/components/paciente/ui";
import { ReagendarModal } from "@/components/paciente/reagendar-modal";
import { CancelarModal } from "@/components/paciente/cancelar-modal";
import { ConfirmarAsistencia } from "@/components/paciente/confirmar-asistencia-button";

const GAP = "clamp(12px, 2vw, 20px)";
const GRID_COLS = "repeat(auto-fit, minmax(min(100%, 340px), 1fr))";
const H2_STYLE = { margin: 0, fontSize: "clamp(15px, 1.8vw, 17px)", fontWeight: 600, opacity: 0.9 };
const MUTED = "rgba(255,255,255,0.65)";
const FAINT = "rgba(255,255,255,0.5)";
/** Estados de cita que el paciente puede reagendar/cancelar. */
const CHANGEABLE_STATUSES = ["PENDING", "SCHEDULED", "CONFIRMED"];

export default function PacienteCitasPage() {
  const { data, error, isLoading, mutate } = usePacienteData<PacienteCitasResponse>(
    "/api/paciente/appointments"
  );
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [sel, setSel] = useState<{ cita: PacienteCita; kind: "reagendar" | "cancelar" } | null>(
    null
  );
  const [solicitada, setSolicitada] = useState(false);

  // Aviso one-shot tras agendar desde /paciente/citas/nueva (?solicitada=1).
  // Client-only (window) → sin useSearchParams, no requiere Suspense boundary.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("solicitada") === "1") {
      setSolicitada(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const clinics = data ? data.clinics : [];
  const multiClinic = clinics.length > 1;
  const upcoming = (data ? data.upcoming : []).filter(
    (c) => !clinicId || c.clinicId === clinicId
  );
  const past = (data ? data.past : []).filter((c) => !clinicId || c.clinicId === clinicId);

  // Política de la clínica de la cita seleccionada (para los modales).
  const selPol =
    sel && data ? data.policies?.find((p) => p.clinicId === sel.cita.clinicId) : undefined;
  const selAutoApprove = selPol?.autoApprove ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: GAP, width: "100%", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "clamp(20px, 2.4vw, 26px)", fontWeight: 700 }}>
          Tus citas
        </h1>
        <Link
          href="/paciente/citas/nueva"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 16px",
            borderRadius: 10,
            background: "#7c3aed",
            color: "#fff",
            border: "1px solid #8b5cf6",
            fontSize: 13.5,
            fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          + Agendar cita
        </Link>
      </div>

      {solicitada && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            background: "rgba(52,211,153,0.12)",
            border: "1px solid rgba(52,211,153,0.4)",
            color: "#6ee7b7",
            borderRadius: 12,
            padding: "11px 14px",
            fontSize: 13.5,
            lineHeight: 1.45,
          }}
        >
          <span>Tu cita fue solicitada. La clínica la confirmará pronto.</span>
          <button
            type="button"
            onClick={() => setSolicitada(false)}
            aria-label="Cerrar aviso"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: "inherit",
              fontSize: 14,
              cursor: "pointer",
              lineHeight: 1,
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {!data && error ? (
        <PacienteCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, color: MUTED }}>
              No pudimos cargar tus citas. Revisa tu conexión e inténtalo de nuevo.
            </span>
            <button
              type="button"
              onClick={() => mutate()}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: "1px solid rgba(139,92,246,0.5)",
                background: "rgba(139,92,246,0.15)",
                color: "#c4b5fd",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reintentar
            </button>
          </div>
        </PacienteCard>
      ) : !data || isLoading ? (
        <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: GAP }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: GAP }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 112,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            ))}
          </div>
          <div
            style={{
              height: 180,
              borderRadius: 14,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
        </div>
      ) : (
        <>
          {multiClinic && (
            <ClinicFilterChips clinics={clinics} value={clinicId} onChange={setClinicId} />
          )}

          <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <h2 style={H2_STYLE}>Próximas</h2>
            {upcoming.length === 0 ? (
              <PacienteEmptyState message="No tienes citas próximas" />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: GAP }}>
                {upcoming.map((cita) => {
                  const pol = data.policies?.find((p) => p.clinicId === cita.clinicId);
                  const minHours = pol?.minHours ?? 24;
                  const changeable = CHANGEABLE_STATUSES.includes(cita.status);
                  const inWindow =
                    new Date(cita.startsAt).getTime() - Date.now() > minHours * 3600000;

                  return (
                    <PacienteCard key={cita.id} style={{ width: "100%" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "clamp(16px, 2vw, 20px)",
                              fontWeight: 700,
                              lineHeight: 1.25,
                            }}
                          >
                            {formatFechaHora(cita.startsAt)}
                          </span>
                          <StatusBadge kind="cita" value={cita.status} />
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{cita.type}</span>
                        <span style={{ fontSize: 13, color: MUTED }}>Con {cita.doctorName}</span>
                        {multiClinic && (
                          <span style={{ fontSize: 12, color: FAINT }}>
                            {clinicName(clinics, cita.clinicId)}
                          </span>
                        )}
                        {/* WS1-T3: confirmar asistencia (solo PENDING/SCHEDULED sin cambio en curso). */}
                        {!cita.pendingChange &&
                          (cita.status === "PENDING" || cita.status === "SCHEDULED") && (
                            <ConfirmarAsistencia citaId={cita.id} onConfirmed={() => mutate()} />
                          )}
                        {cita.pendingChange ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 4,
                              marginTop: 4,
                            }}
                          >
                            <span
                              style={{
                                display: "inline-block",
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "3px 10px",
                                borderRadius: 999,
                                whiteSpace: "nowrap",
                                color: "#fbbf24",
                                background: "rgba(251,191,36,0.12)",
                              }}
                            >
                              Cambio solicitado
                            </span>
                            <span style={{ fontSize: 12, color: MUTED }}>
                              {cita.pendingChange.type === "RESCHEDULE"
                                ? `Propusiste: ${
                                    cita.pendingChange.proposedStartsAt
                                      ? formatFechaHora(cita.pendingChange.proposedStartsAt)
                                      : "nueva fecha"
                                  }`
                                : "Pediste cancelarla"}
                            </span>
                            <span style={{ fontSize: 12, color: FAINT }}>
                              En revisión por la clínica
                            </span>
                          </div>
                        ) : changeable && inWindow ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() => setSel({ cita, kind: "reagendar" })}
                              style={{
                                padding: "6px 14px",
                                borderRadius: 10,
                                fontSize: 12.5,
                                fontWeight: 600,
                                fontFamily: "inherit",
                                cursor: "pointer",
                                background: "transparent",
                                border: "1px solid #8b5cf6",
                                color: "#c4b5fd",
                              }}
                            >
                              Reagendar
                            </button>
                            <button
                              type="button"
                              onClick={() => setSel({ cita, kind: "cancelar" })}
                              style={{
                                padding: "6px 14px",
                                borderRadius: 10,
                                fontSize: 12.5,
                                fontWeight: 600,
                                fontFamily: "inherit",
                                cursor: "pointer",
                                background: "transparent",
                                border: "1px solid transparent",
                                color: "#f87171",
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : changeable ? (
                          <span style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>
                            Para cambios a menos de {minHours} h, contacta a la clínica.
                          </span>
                        ) : null}
                      </div>
                    </PacienteCard>
                  );
                })}
              </div>
            )}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <h2 style={H2_STYLE}>Anteriores</h2>
            {past.length === 0 ? (
              <PacienteEmptyState message="Aún no tienes citas pasadas" />
            ) : (
              <PacienteCard style={{ width: "100%" }}>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {past.map((cita, i) => (
                    <div
                      key={cita.id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "6px 12px",
                        padding: "10px 0",
                        borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)",
                        minWidth: 0,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        {formatFechaHora(cita.startsAt)}
                      </span>
                      <span style={{ fontSize: 13, color: MUTED }}>{cita.type}</span>
                      <span style={{ fontSize: 13, color: FAINT }}>Con {cita.doctorName}</span>
                      {multiClinic && (
                        <span style={{ fontSize: 12, color: FAINT }}>
                          {clinicName(clinics, cita.clinicId)}
                        </span>
                      )}
                      <span style={{ marginLeft: "auto" }}>
                        <StatusBadge kind="cita" value={cita.status} />
                      </span>
                    </div>
                  ))}
                </div>
              </PacienteCard>
            )}
          </section>
        </>
      )}

      {sel && (
        <>
          <ReagendarModal
            cita={sel.cita}
            clinicNombre={clinicName(clinics, sel.cita.clinicId)}
            autoApprove={selAutoApprove}
            open={sel.kind === "reagendar"}
            onClose={() => setSel(null)}
            onDone={() => mutate()}
          />
          <CancelarModal
            cita={sel.cita}
            clinicNombre={clinicName(clinics, sel.cita.clinicId)}
            autoApprove={selAutoApprove}
            open={sel.kind === "cancelar"}
            onClose={() => setSel(null)}
            onDone={() => mutate()}
          />
        </>
      )}
    </div>
  );
}
