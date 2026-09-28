// Ortodoncia — Alertas (L1-L5, ws1-t2, Ola 1): mensualidad vencida, falta de
// control, no-show, próximo a terminar, pasado de fecha. Solo alertas EN EL
// PANEL — sin WhatsApp nuevo (eso es de "Paciente y WhatsApp", ws1-t8). La
// guarda de módulo ya corrió en el layout.
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarX, Clock, Hourglass, UserX } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { loadOrthoAlerts } from "@/lib/orthodontics/alerts-data";
import type {
  DurationAlertEntry,
  MissingNextControlEntry,
  OverduePatientEntry,
} from "@/lib/orthodontics/specialty-kpis";
import type { NoShowEntry } from "@/lib/orthodontics/alerts-data";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function OrthodonticsAlertasPage() {
  const user = await getCurrentUser();
  const alerts = await loadOrthoAlerts(user.clinicId, user.clinic.timezone);

  const totalAlerts =
    alerts.overduePayments.length +
    alerts.missingNextControl.length +
    alerts.noShows.length +
    alerts.finishingSoon.length +
    alerts.pastDue.length;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>Alertas</h1>
        <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
          {totalAlerts === 0 ? "Sin alertas pendientes." : `${totalAlerts} caso${totalAlerts === 1 ? "" : "s"} que revisar.`}
        </p>
      </header>

      <AlertSection
        icon={<AlertTriangle size={16} aria-hidden />}
        title="Mensualidad vencida"
        empty="Sin mensualidades vencidas."
      >
        {alerts.overduePayments.map((p: OverduePatientEntry) => (
          <PatientRow key={p.patientId} patientId={p.patientId} patientName={p.patientName}>
            <span style={{ fontWeight: 600, color: "var(--danger, #ef4444)" }}>{fmtMoney(p.amountMxn)}</span>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>vence desde {fmtDate(p.oldestDueDate)}</span>
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection icon={<Clock size={16} aria-hidden />} title="Falta de control" empty="Todos los casos activos tienen su próximo control agendado.">
        {alerts.missingNextControl.map((p: MissingNextControlEntry) => (
          <PatientRow key={p.patientId} patientId={p.patientId} patientName={p.patientName}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sin cita de control agendada</span>
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection icon={<UserX size={16} aria-hidden />} title="No se presentó a su control" empty="Sin faltas en los últimos 30 días.">
        {alerts.noShows.map((n: NoShowEntry, i) => (
          <PatientRow key={`${n.patientId}-${i}`} patientId={n.patientId} patientName={n.patientName}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Faltó el {fmtDate(n.scheduledAt)}</span>
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection icon={<Hourglass size={16} aria-hidden />} title="Tratamiento próximo a terminar" empty="Sin tratamientos por terminar en el corto plazo.">
        {alerts.finishingSoon.map((e: DurationAlertEntry) => (
          <PatientRow key={e.patientId} patientId={e.patientId} patientName={e.patientName}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              Mes {e.monthInTreatment} de {e.estimatedDurationMonths}
            </span>
          </PatientRow>
        ))}
      </AlertSection>

      <AlertSection icon={<CalendarX size={16} aria-hidden />} title="Tratamiento pasado de su fecha" empty="Ningún tratamiento rebasó su duración estimada.">
        {alerts.pastDue.map((e: DurationAlertEntry) => (
          <PatientRow key={e.patientId} patientId={e.patientId} patientName={e.patientName}>
            <span style={{ fontSize: 12, color: "var(--danger, #ef4444)" }}>
              {Math.abs(e.remainingMonths)} mes{Math.abs(e.remainingMonths) === 1 ? "" : "es"} de retraso
            </span>
          </PatientRow>
        ))}
      </AlertSection>
    </div>
  );
}

function AlertSection({
  icon,
  title,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  children: ReactNode[];
}) {
  const hasItems = children.length > 0;
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-1)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: hasItems ? "1px solid var(--border)" : "none",
        }}
      >
        {icon}
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{title}</h2>
        {hasItems && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-1)",
              background: "var(--surface-2)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {children.length}
          </span>
        )}
      </header>
      {hasItems ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul>
      ) : (
        <p style={{ margin: 0, padding: "12px 16px", fontSize: 12, color: "var(--text-3)" }}>{empty}</p>
      )}
    </section>
  );
}

function PatientRow({
  patientId,
  patientName,
  children,
}: {
  patientId: string;
  patientName: string;
  children: ReactNode;
}) {
  return (
    <li style={{ borderTop: "1px solid var(--border-soft, var(--border))" }}>
      <Link
        href={`/dashboard/patients/${patientId}?tab=ortodoncia`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 16px",
          textDecoration: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{patientName}</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>{children}</div>
      </Link>
    </li>
  );
}
