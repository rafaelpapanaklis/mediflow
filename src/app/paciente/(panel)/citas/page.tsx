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
import { useState } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteCitasResponse } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  ClinicFilterChips,
  StatusBadge,
  clinicName,
  formatFechaHora,
} from "@/components/paciente/ui";

const GAP = "clamp(12px, 2vw, 20px)";
const GRID_COLS = "repeat(auto-fit, minmax(min(100%, 340px), 1fr))";
const H2_STYLE = { margin: 0, fontSize: "clamp(15px, 1.8vw, 17px)", fontWeight: 600, opacity: 0.9 };
const MUTED = "rgba(255,255,255,0.65)";
const FAINT = "rgba(255,255,255,0.5)";

export default function PacienteCitasPage() {
  const { data, error, isLoading, mutate } = usePacienteData<PacienteCitasResponse>(
    "/api/paciente/appointments"
  );
  const [clinicId, setClinicId] = useState<string | null>(null);

  const clinics = data ? data.clinics : [];
  const multiClinic = clinics.length > 1;
  const upcoming = (data ? data.upcoming : []).filter(
    (c) => !clinicId || c.clinicId === clinicId
  );
  const past = (data ? data.past : []).filter((c) => !clinicId || c.clinicId === clinicId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: GAP, width: "100%", minWidth: 0 }}>
      <h1 style={{ margin: 0, fontSize: "clamp(20px, 2.4vw, 26px)", fontWeight: 700 }}>
        Tus citas
      </h1>

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
                {upcoming.map((cita) => (
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
                    </div>
                  </PacienteCard>
                ))}
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
    </div>
  );
}
