"use client";

// Inicio del panel del paciente. Implementa A5.
// Datos: usePacienteData<PacienteSummaryResponse>("/api/paciente/summary").
// Secciones:
//   · Saludo "Hola, {primer nombre}" + subtítulo.
//   · Próximas citas (máx 5) con fecha/hora local, doctor, clínica (si 2+
//     clínicas, etiquetar con clinicName), StatusBadge.
//   · Saldo pendiente: pendingTotal grande (formatMxn) + desglose por clínica
//     si hay varias. Si 0 → mensaje positivo "No tienes saldo pendiente".
//   · Accesos rápidos (cards/links): Citas, Historial, Pagos, Perfil.
//   · Skeleton/loading sutil mientras isLoading; estados vacíos amables.
// Layout responsive: grid que colapsa a 1 columna en móvil, sin anchos fijos.
// Español neutro con tú. Estilo dark consistente (PacienteCard).
import Link from "next/link";
import { CalendarDays, FileText, CreditCard, User } from "lucide-react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteSummaryResponse } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  StatusBadge,
  clinicName,
  formatMxn,
  formatFechaHora,
} from "@/components/paciente/ui";

const QUICK_LINKS = [
  { href: "/paciente/citas", label: "Citas", Icon: CalendarDays },
  { href: "/paciente/historial", label: "Historial", Icon: FileText },
  { href: "/paciente/pagos", label: "Pagos", Icon: CreditCard },
  { href: "/paciente/perfil", label: "Perfil", Icon: User },
];

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
  gap: "clamp(12px, 2vw, 20px)",
};

const PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "clamp(16px, 2.5vw, 24px)",
};

function SkeletonBar({ width, height = 12 }: { width: string; height?: number }) {
  return (
    <div
      style={{
        height,
        width,
        maxWidth: "100%",
        borderRadius: 6,
        background: "rgba(255,255,255,0.08)",
        animation: "pacientePulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

export default function PacienteInicioPage() {
  const { data, error, isLoading, mutate } =
    usePacienteData<PacienteSummaryResponse>("/api/paciente/summary");

  if (isLoading) {
    return (
      <div style={PAGE_STYLE}>
        <style>{`@keyframes pacientePulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.9; } }`}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBar width="min(100%, 220px)" height={26} />
          <SkeletonBar width="min(100%, 280px)" />
        </div>
        <div style={GRID_STYLE}>
          {[0, 1, 2].map((i) => (
            <PacienteCard key={i}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 0" }}>
                <SkeletonBar width="40%" height={16} />
                <SkeletonBar width="90%" />
                <SkeletonBar width="75%" />
                <SkeletonBar width="60%" />
              </div>
            </PacienteCard>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <PacienteCard>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "clamp(20px, 4vw, 36px) clamp(12px, 2vw, 20px)",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, opacity: 0.8, fontSize: "clamp(14px, 1.6vw, 15px)" }}>
            No pudimos cargar tu resumen. Inténtalo de nuevo.
          </p>
          <button
            onClick={() => mutate()}
            style={{
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontWeight: 600,
              fontSize: "clamp(13px, 1.5vw, 14px)",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </PacienteCard>
    );
  }

  const { me, clinics, upcoming, pendingByClinic, pendingTotal } = data;
  const firstName = (me.name || "").trim().split(/\s+/)[0] || "paciente";
  const multiClinic = clinics.length > 1;

  return (
    <div style={PAGE_STYLE}>
      <header>
        <h1 style={{ margin: 0, fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700 }}>
          Hola, {firstName}
        </h1>
        <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: "clamp(13px, 1.5vw, 15px)" }}>
          Este es el resumen de tu salud
        </p>
      </header>

      <div style={GRID_STYLE}>
        <PacienteCard title="Próximas citas">
          {upcoming.length === 0 ? (
            <PacienteEmptyState message="No tienes citas próximas. Reserva desde la página de tu clínica." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {upcoming.map((cita) => (
                <div
                  key={cita.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "clamp(8px, 1.2vw, 12px)",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "clamp(13px, 1.4vw, 15px)" }}>
                      {formatFechaHora(cita.startsAt)}
                    </div>
                    <div
                      style={{
                        fontSize: "clamp(12px, 1.3vw, 13px)",
                        opacity: 0.75,
                        marginTop: 2,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cita.doctorName} · {cita.type}
                      {multiClinic ? ` · ${clinicName(clinics, cita.clinicId)}` : ""}
                    </div>
                  </div>
                  <StatusBadge kind="cita" value={cita.status} />
                </div>
              ))}
            </div>
          )}
        </PacienteCard>

        <PacienteCard title="Saldo pendiente">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, lineHeight: 1.1 }}>
              {formatMxn(pendingTotal)}
            </div>
            {pendingTotal > 0 ? (
              multiClinic && pendingByClinic.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pendingByClinic.map((p) => (
                    <div
                      key={p.clinicId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        fontSize: "clamp(12px, 1.3vw, 13px)",
                        opacity: 0.8,
                      }}
                    >
                      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        {clinicName(clinics, p.clinicId)}
                      </span>
                      <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {formatMxn(p.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null
            ) : (
              <p style={{ margin: 0, opacity: 0.75, fontSize: "clamp(13px, 1.4vw, 14px)" }}>
                No tienes saldo pendiente 🎉
              </p>
            )}
          </div>
        </PacienteCard>

        <PacienteCard title="Accesos rápidos">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
              gap: 10,
            }}
          >
            {QUICK_LINKS.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "clamp(14px, 2vw, 18px) 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "inherit",
                  textDecoration: "none",
                  fontSize: "clamp(13px, 1.4vw, 14px)",
                  fontWeight: 600,
                }}
              >
                <Icon size={22} style={{ color: "#a78bfa" }} />
                {label}
              </Link>
            ))}
          </div>
        </PacienteCard>
      </div>
    </div>
  );
}
