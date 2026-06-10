"use client";

// Historial clínico del paciente. Implementa A7.
// Datos: usePacienteData<PacienteHistorialResponse>("/api/paciente/history").
// · ClinicFilterChips si hay 2+ clínicas.
// · Sección "Consultas": lista por fecha desc — fecha + "Te atendió {doctorName}"
//   + clínica. SOLO eso (las consultas NO son SOAP; el paciente no ve notas).
// · Sección "Tratamientos": nombre, StatusBadge kind="tratamiento", progreso
//   "X de Y sesiones" (barra de progreso simple), fechas.
// · Sección "Odontograma": por clínica con datos — "N hallazgos en M dientes"
//   + última actualización (formatFecha). Si no hay datos, ocultar sección.
// · Estados vacíos amables. Responsive (cards apiladas en móvil).
import { useState } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteHistorialResponse } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  ClinicFilterChips,
  StatusBadge,
  clinicName,
  formatFecha,
} from "@/components/paciente/ui";

export default function PacienteHistorialPage() {
  const { data, error, isLoading, mutate } = usePacienteData<PacienteHistorialResponse>(
    "/api/paciente/history"
  );
  const [clinicFilter, setClinicFilter] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tu historial</h1>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              height: i === 0 ? 110 : 170,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
            }}
          />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tu historial</h1>
        <PacienteCard>
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <p style={{ margin: "0 0 14px", opacity: 0.8 }}>
              No pudimos cargar tu historial. Inténtalo de nuevo.
            </p>
            <button
              type="button"
              onClick={() => mutate()}
              style={{
                padding: "9px 20px",
                borderRadius: 10,
                border: "1px solid rgba(139,92,246,0.5)",
                background: "rgba(139,92,246,0.15)",
                color: "#c4b5fd",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reintentar
            </button>
          </div>
        </PacienteCard>
      </div>
    );
  }

  const clinics = data.clinics;
  const multiClinic = clinics.length > 1;
  const consultas = clinicFilter
    ? data.consultas.filter((c) => c.clinicId === clinicFilter)
    : data.consultas;
  const tratamientos = clinicFilter
    ? data.tratamientos.filter((t) => t.clinicId === clinicFilter)
    : data.tratamientos;
  const odontograma = clinicFilter
    ? data.odontograma.filter((o) => o.clinicId === clinicFilter)
    : data.odontograma;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Tu historial</h1>

      {multiClinic && (
        <ClinicFilterChips clinics={clinics} value={clinicFilter} onChange={setClinicFilter} />
      )}

      <PacienteCard title="Consultas">
        {consultas.length === 0 ? (
          <PacienteEmptyState message="Aún no tienes consultas registradas" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {consultas.map((c, idx) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "4px 12px",
                  padding: "10px 0",
                  borderTop: idx === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {formatFecha(c.visitDate)}
                </span>
                <span style={{ opacity: 0.85 }}>Te atendió {c.doctorName}</span>
                {multiClinic && (
                  <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.6 }}>
                    {clinicName(clinics, c.clinicId)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </PacienteCard>

      <PacienteCard title="Tratamientos">
        {tratamientos.length === 0 ? (
          <PacienteEmptyState message="No tienes tratamientos registrados" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {tratamientos.map((t) => {
              const pct =
                t.totalSessions > 0
                  ? Math.min(100, Math.round((t.sessionsDone / t.totalSessions) * 100))
                  : 0;
              return (
                <div
                  key={t.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <StatusBadge kind="tratamiento" value={t.status} />
                    {multiClinic && (
                      <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.6 }}>
                        {clinicName(clinics, t.clinicId)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    {t.sessionsDone} de {t.totalSessions}{" "}
                    {t.totalSessions === 1 ? "sesión" : "sesiones"}
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    Inicio: {formatFecha(t.startDate)}
                    {t.endDate ? ` · Fin: ${formatFecha(t.endDate)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PacienteCard>

      {odontograma.length > 0 && (
        <PacienteCard title="Odontograma">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {odontograma.map((o) => (
              <div key={o.clinicId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {multiClinic && (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    {clinicName(clinics, o.clinicId)}
                  </span>
                )}
                <span>
                  {o.totalFindings}{" "}
                  {o.totalFindings === 1 ? "hallazgo registrado" : "hallazgos registrados"} en{" "}
                  {o.teethWithFindings} {o.teethWithFindings === 1 ? "diente" : "dientes"}
                </span>
                {o.updatedAt && (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    Actualizado el {formatFecha(o.updatedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </PacienteCard>
      )}
    </div>
  );
}
